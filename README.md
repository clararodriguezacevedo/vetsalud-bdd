# VetSalud — Sistema de Gestión de Clínica Veterinaria

Trabajo Práctico de Base de Datos II. Arquitectura de persistencia políglota
con dos motores NoSQL de paradigmas distintos:

- **MongoDB** (documental) → dominio principal: `propietarios`, `pacientes`,
  `veterinarios`, `consultas`, `vacunaciones`.
- **Redis** (clave-valor) → stock farmacéutico.

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
- **Redis** se usa para stock porque requiere lecturas rápidas y decrementos
  atómicos sobre cantidades, algo que encaja mejor que un documento mutable.
- La colección `consultas` agrupa consultas y cirugías porque comparten casi
  toda la estructura. El discriminador `tipo` evita duplicación y simplifica
  los reportes clínicos.

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

