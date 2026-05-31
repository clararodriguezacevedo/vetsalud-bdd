# VetSalud — Sistema de Gestión de Clínica Veterinaria

Trabajo Práctico de Base de Datos II. Arquitectura de persistencia políglota
con dos motores NoSQL de paradigmas distintos:

- **MongoDB** (documental) → dominio principal: `propietarios`, `pacientes`,
  `veterinarios`, `consultas`, `vacunaciones`. 
- **Redis** (clave-valor) → stock farmacéutico. 

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
    ├── queries.js          # Las 15 consultas (4 implementadas, 11 como TODO)
    └── server.js           # API Express
```

## Consultas implementadas (MongoDB)

| #  | Consulta | Función | Endpoint |
|----|----------|---------|----------|
| 9  | Controles con costo < $5.000 | `controlesBaratos` | `GET /api/controles-baratos?max=5000` |
| 10 | Pacientes de una sucursal | `pacientesPorSucursal` | `GET /api/pacientes-sucursal?sucursal=Palermo` |
| 11 | Ingresos por veterinario (mes actual) | `ingresosPorVetMesActual` | `GET /api/ingresos-vet-mes` |
| 12 | Propietarios sin consultas (1 año) | `propietariosSinConsultasUltimoAnio` | `GET /api/propietarios-inactivos` |
| 13 | ABM de propietarios | `altaPropietario` / `modificarPropietario` / `bajaPropietario` | `POST` / `PUT` / `DELETE /api/propietarios` |
| 14 | Alta de consulta con validación | `altaConsulta` | `POST /api/consultas` |

### Probar las operaciones de escritura

```bash
# 13 ABM de propietarios
curl -X POST http://localhost:3000/api/propietarios \
  -H "Content-Type: application/json" \
  -d '{"_id":"C007","nombre":"Lucía","apellido":"Vega","dni":"40111222","email":"lu@mail.com","telefono":"1144","ciudad":"CABA","provincia":"Buenos Aires"}'

curl -X PUT http://localhost:3000/api/propietarios/C007 \
  -H "Content-Type: application/json" -d '{"ciudad":"Rosario"}'

curl -X DELETE http://localhost:3000/api/propietarios/C007   # baja lógica: activo=false

# 14 Alta de consulta (valida que paciente y vet existan)
curl -X POST http://localhost:3000/api/consultas \
  -H "Content-Type: application/json" \
  -d '{"id_paciente":"P002","id_vet":"V003","motivo":"Control","diagnostico":"Sano","costo":3000}'
```

