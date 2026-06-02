# VetSalud — Sistema de Gestión de Clínica Veterinaria

Trabajo Práctico de Base de Datos II. Arquitectura de persistencia políglota
con dos motores NoSQL de paradigmas distintos:

- **MongoDB** (documental) → dominio principal: `propietarios`, `pacientes`,
  `veterinarios`, `consultas`, `vacunaciones`, `productos` (master data del
  catálogo farmacéutico).
- **Redis** (clave-valor) → **únicamente el contador de unidades** de cada
  producto, en un único Sorted Set `stock:unidades`.

## Modelo de atenciones médicas

Las atenciones médicas se guardan en una sola colección `consultas` con un
campo discriminador `tipo`:

- `tipo: 'Consulta'` → atención clínica general. **Los controles se modelan
  como consultas: en este proyecto control y consulta son sinónimos**, y se
  diferencian por el campo `motivo` (ej: "Control anual", "Control post-vacuna").
- `tipo: 'Cirugia'` → intervención quirúrgica.

Ambos tipos comparten estructura (paciente, vet, fecha, costo, estado), por
lo que viven en la misma colección aprovechando el schema flexible de
MongoDB — más simple que duplicar colecciones con la misma forma.

Las **vacunaciones** quedan en su propia colección porque su estructura es
diferente (sin `costo`, con `proxima_dosis`).

## Justificación técnica

- **MongoDB** se usa para las entidades clínicas y administrativas porque el
  modelo es flexible y las consultas del trabajo dependen de agregaciones,
  filtros por fecha y cruces entre documentos relacionados.
- **Redis** se usa específicamente para la cantidad de unidades en stock,
  porque ese dato cambia constantemente y necesita decrementos atómicos.
- La colección `consultas` agrupa consultas y cirugías porque comparten casi
  toda la estructura. El discriminador `tipo` evita duplicación y simplifica
  los reportes clínicos.

## Modelo de stock farmacéutico

El stock es el caso de uso más interesante de la persistencia políglota.
Está partido entre los dos motores según la naturaleza del dato:

### Mongo — `productos` (master data, casi estático)

```js
{ _id: "PRD001",
  nombre: "Amoxicilina 250mg",
  categoria: "Antibiótico",
  precio_unit: 850,
  vencimiento: ISODate("2026-06-30"),
  proveedor: "VetFarma SA" }
```

Acá viven los atributos que cambian poco (precio, proveedor, vencimiento) y
sobre los que tiene sentido hacer queries relacionales: "productos del
proveedor X", "productos que vencen antes de Y", joins futuros con consultas
para historial de consumo, etc. Indexado por `proveedor` y `vencimiento`.

### Redis — `stock:unidades` (contador, alta volatilidad)

Una sola estructura: un **Sorted Set** donde `score = unidades` y `value = id_producto`.

```
stock:unidades  (Sorted Set)
   PRD017  score=15
   PRD015  score=20
   ...
   PRD005  score=200
```

Esta única estructura cubre las tres operaciones que necesitamos:

| Operación | Comando | Complejidad |
|-----------|---------|-------------|
| Leer unidades de un producto | `ZSCORE stock:unidades PRD001` | O(1) |
| Listar productos con stock < N | `ZRANGEBYSCORE stock:unidades -inf N-1` | O(log n + k) |
| Decrementar atómicamente | `ZINCRBY stock:unidades -3 PRD001` | O(log n) |

El decremento de Q15 además se ejecuta dentro de un **script Lua** que en
una sola operación atómica chequea existencia, valida stock suficiente y
aplica el `ZINCRBY`. Esto elimina la ventana de race condition entre el
check y el update.

### ¿Por qué Lua y no `MULTI/EXEC` con transacciones?

Las transacciones de Redis (`MULTI/EXEC`) garantizan que los comandos
encolados se ejecuten de corrido sin interrupción, pero tienen un límite
clave: **dentro de `MULTI/EXEC` no se puede leer un valor y decidir basado
en él**. Todos los comandos se encolan antes del `EXEC`. Eso no nos
alcanza: necesitamos leer el stock, validar que sea suficiente y recién
ahí decidir si decrementamos.

La forma de hacerlo con transacciones es agregar `WATCH` (concurrencia
optimista): se vigila la clave, se lee el valor, se encola la escritura,
y si la clave cambió entre el `WATCH` y el `EXEC` la transacción se aborta
y hay que reintentar. 

Funciona, pero comparado con Lua hay una falsa contención sobre el Sorted Set único. `WATCH` vigila la clave entera. Como `stock:unidades` contiene todos los productos en una sola
clave, **cualquier decremento sobre cualquier producto aborta tu
transacción aunque no tenga nada que ver con el producto que te
interesa**. Cinco vets descontando productos distintos en paralelo
terminan en loops de reintento peleando contra cambios irrelevantes.

### Patrón políglota: Q8 (stock bajo + proveedor)

Q8 muestra explícitamente el patrón cross-motor:

1. **Redis** (`ZRANGEBYSCORE`) devuelve los IDs con bajo stock, ya ordenados por unidades ascendente.
2. **Mongo** (`find({_id: {$in: ids}})`) trae el master data de esos productos.
3. Se combinan en el resultado final.

Cada motor hace lo que mejor hace: Redis el ranking instantáneo, Mongo la
metadata estructurada.

### ¿Por qué no usamos un Bloom filter?

Un Bloom filter responde "¿pertenece X al conjunto?" con falsos positivos
posibles, falsos negativos imposibles, y espacio constante. Es tentador
para chequeos del estilo "¿hay stock?", pero no encaja en este dominio
por tres razones:

1. **Necesitamos cantidad, no presencia.** Un Bloom filter te dice
   "probablemente sí" o "definitivamente no", pero no cuántas unidades hay.
   Para validar `unidades >= cantidad_pedida` necesitamos el número exacto,
   que es lo que el Sorted Set ya nos da en O(1) vía `ZSCORE`.

2. **El "conjunto" cambia con cada decremento.** Los Bloom filters clásicos
   no soportan borrado: si quisiéramos mantener un set "productos con
   stock > 0" no podríamos sacar un producto cuando se agota sin perder
   otros bits. Hay variantes (Counting Bloom Filter) que sí, pero ya son
   esencialmente contadores aproximados — perdés el beneficio de espacio.

3. **El catálogo es chico (~20 productos).** Los Bloom filters brillan cuando
   el set es enorme y la mayoría de las consultas son misses (catálogos de
   millones de SKUs, listas de URLs vistas, blacklists de fraude). Para 20
   productos donde igual vamos a leer el contador real, el filtro agrega
   complejidad sin ahorrar nada.

Si en un futuro quisiéramos sumar capacidades avanzadas de Redis al dominio
de stock, opciones más realistas serían **TTL** sobre claves para alertar
productos próximos a vencer, o **Streams** (`XADD`) para emitir eventos
"consulta cerrada" hacia procesos asíncronos.

## Caché de queries (Redis como caché)

Además de usar Redis como fuente de verdad para el stock, lo aprovechamos
también como **caché de resultados** de las queries más caras. Esto suma
otro patrón clásico de Redis (cache-aside con TTL) sin pisar el uso
anterior.

### Qué se cachea y por qué

| Query | Por qué se cachea | TTL | Invalidada por |
|-------|-------------------|-----|----------------|
| **Q5** vets activos con consultas en 60 días | Aggregation con `$lookup` + filter por fecha sobre toda la colección | 300 s | Q14 (alta consulta) |
| **Q7** top 5 diagnósticos | `$group` sobre toda la colección de consultas | 300 s | Q14 |
| **Q11** ingresos por veterinario (mes actual) | Aggregation + lookup, leída con frecuencia | 60 s | Q14 |

Las demás queries no se cachean porque:
- Dependen de un parámetro variable (`historialPaciente(id)`, `pacientesPorSucursal(sucursal)`, `controlesBaratos(max)`) y cachear cada combinación tiene poco retorno.
- Son baratas y no se ganaría mucho (`pacientesActivosConPropietario`, `topDiagnosticos` con poca data).
- Devuelven datos sensibles al tiempo exacto (`pacientesConVacunasVencidas` filtra por `< hoy`).

### Cómo funciona — patrón cache-aside

```js
async function cached(key, ttlSeconds, fn) {
  const { redis } = await connect();
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit);  // cache HIT
  const value = await fn();                  // cache MISS -> Mongo
  await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
  return value;
}
```

Cada query cacheada se envuelve así:
```js
export async function topDiagnosticos() {
  return cached('cache:top-diagnosticos', 300, async () => {
    const { db } = await connect();
    return db.collection('consultas').aggregate([...]).toArray();
  });
}
```

### Invalidación

Cuando se inserta una consulta nueva (Q14), las tres claves cacheadas
quedan obsoletas — la nueva consulta podría afectar el ranking de
diagnósticos, los ingresos del mes y el conteo por vet. Se borran
explícitamente con `DEL`:

```js
await invalidate('cache:top-diagnosticos', 'cache:ingresos-vet-mes', 'cache:vets-consultas-60d');
```

La próxima llamada a cualquiera de esas queries será un cache miss
(reconstruye y vuelve a cachear).

### Convención de keys

Todas las claves de caché empiezan con `cache:` para no chocar con las
otras keys de Redis (`stock:unidades`). Esto permite limpiar selectivamente
con `KEYS cache:*` sin tocar el contador de stock.

### Endpoint de admin

`POST /api/cache/flush` borra todas las keys `cache:*` y devuelve cuántas
eliminó. Útil para demos o después de un reseed donde el TTL todavía no
expiró.

```bash
curl -X POST http://localhost:3000/api/cache/flush
# {"ok":true,"eliminadas":3}
```

### Cómo verlo en acción

1. Llamar a `GET /api/top-diagnosticos` — primer hit cae a Mongo y cachea.
2. Repetir la llamada — esta vez sale de Redis (notablemente más rápido).
3. Inspeccionar Redis:
   ```bash
   docker exec -it vetsalud_redis redis-cli
   > KEYS cache:*
   > TTL cache:top-diagnosticos
   > GET cache:top-diagnosticos
   ```
4. Crear una consulta nueva con `POST /api/consultas`.
5. Volver a inspeccionar: las keys `cache:*` ya no están (fueron invalidadas).
6. Volver a llamar a `GET /api/top-diagnosticos` — cache miss, se rearma.

## Cómo correrlo (GitHub Codespaces o local)

Requisitos: Docker y Node.js 18+ (ambos vienen en Codespaces).

```bash
# 1) Levantar las bases de datos
docker compose up -d

# 2) Configurar variables de entorno
cp .env.example .env

# 3) Instalar dependencias
npm install

# 4) Poblar las bases con los CSV de /data
npm run seed

# 5) Arrancar el servidor
npm start
```

Luego abrí `http://localhost:3000` (en Codespaces, la pestaña **Ports** reenvía el
puerto 3000 automáticamente). El panel permite probar las consultas implementadas.

## Estructura

```
vetsalud/
├── docker-compose.yml      # Mongo + Redis
├── data/                   # CSV 
├── public/index.html       # Frontend simple
└── src/
    ├── db.js               # Conexión a ambos motores
    ├── seed.js             # Carga de CSV → Mongo + Redis
  ├── queries.js          # Las 15 consultas implementadas
    └── server.js           # API Express
```

## Consultas implementadas

| #  | Consulta | Motor | Función | Endpoint |
|----|----------|-------|---------|----------|
| 1  | Pacientes activos + propietario | Mongo | `pacientesActivosConPropietario` | `GET /api/pacientes-activos` |
| 2  | Consultas en seguimiento con veterinario y costo | Mongo | `consultasEnSeguimiento` | `GET /api/consultas-seguimiento` |
| 3  | Historial completo de un paciente | Mongo | `historialPaciente` | `GET /api/historial-paciente/:id` |
| 4  | Propietarios con más de un paciente | Mongo | `propietariosConMultiplesPacientes` | `GET /api/propietarios-multiples-pacientes` |
| 5  | Veterinarios activos con consultas en 60 días | Mongo | `veterinariosActivosConConsultas60d` | `GET /api/vets-activos-consultas-60d` |
| 6  | Pacientes con vacunas vencidas | Mongo | `pacientesConVacunasVencidas` | `GET /api/pacientes-vacunas-vencidas` |
| 7  | Top 5 diagnósticos | Mongo | `topDiagnosticos` | `GET /api/top-diagnosticos` |
| 8  | Stock con menos de N unidades | Redis | `stockBajo` | `GET /api/stock-bajo?umbral=50` |
| 9  | Controles con costo < $5.000 | Mongo | `controlesBaratos` | `GET /api/controles-baratos?max=5000` |
| 10 | Pacientes de una sucursal (consultas + vacunas) | Mongo | `pacientesPorSucursal` | `GET /api/pacientes-sucursal?sucursal=Palermo` |
| 11 | Ingresos por veterinario (mes actual) | Mongo | `ingresosPorVetMesActual` | `GET /api/ingresos-vet-mes` |
| 12 | Propietarios sin consultas (1 año) | Mongo | `propietariosSinConsultasUltimoAnio` | `GET /api/propietarios-inactivos` |
| 13 | ABM de propietarios | Mongo | `altaPropietario` / `modificarPropietario` / `bajaPropietario` | `POST` / `PUT` / `DELETE /api/propietarios` |
| 14 | Alta de consulta (valida activo + descuento de stock) | Mongo + Redis | `altaConsulta` | `POST /api/consultas` |
| 15 | Decrementar stock (previene negativos) | Redis | `decrementarStock` | `POST /api/decrementar-stock` |

## Ejemplos de salida

- **Q2** devuelve consultas con `paciente` y `veterinario` embebidos, además de `costo`, `motivo`, `diagnostico` y `estado`.
- **Q3** devuelve un historial unificado con `tipo_evento`, `fecha`, `paciente`, `veterinario` y los campos específicos de consulta o vacunación.
- **Q4** devuelve `propietario` y `cantidad_pacientes` para cada dueño con más de una mascota.
- **Q5** devuelve `cantidad_consultas_60d` por veterinario activo, ordenado de mayor a menor.
- **Q6** devuelve el paciente, su propietario y la lista `vacunas_vencidas` agrupada por animal.

### Probar las operaciones de escritura

```bash
# 13 ABM de propietarios
curl -X POST http://localhost:3000/api/propietarios \
  -H "Content-Type: application/json" \
  -d '{"_id":"C007","nombre":"Lucía","apellido":"Vega","dni":"40111222","email":"lu@mail.com","telefono":"1144","ciudad":"CABA","provincia":"Buenos Aires"}'

curl -X PUT http://localhost:3000/api/propietarios/C007 \
  -H "Content-Type: application/json" -d '{"ciudad":"Rosario"}'

curl -X DELETE http://localhost:3000/api/propietarios/C007   # baja lógica: activo=false

# 14 Alta de consulta (valida que paciente y vet existan y estén activos)
curl -X POST http://localhost:3000/api/consultas \
  -H "Content-Type: application/json" \
  -d '{"id_paciente":"P002","id_vet":"V003","tipo":"Consulta","motivo":"Control","diagnostico":"Sano","costo":3000}'

# 14 + integración Redis: descontar stock de productos usados en la consulta
curl -X POST http://localhost:3000/api/consultas \
  -H "Content-Type: application/json" \
  -d '{"id_paciente":"P002","id_vet":"V003","motivo":"Vómitos","costo":5000,"productos_usados":[{"id_producto":"PRD001","cantidad":2}]}'
```

