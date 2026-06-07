# VetSalud — Sistema de Gestión de Clínica Veterinaria

TP Obligatorio · Base de Datos II · 1° cuatrimestre 2026.

Arquitectura de persistencia políglota con **MongoDB** (dominio clínico) +
**Redis** (stock atómico + caché de queries).

> Para la justificación técnica completa (decisiones de diseño, modelo de
> datos, concurrencia, CAP/BASE/atomicidad, código y explicación de cada
> consulta) ver **[INFORME.md](INFORME.md)**.

## Cómo correrlo

```bash
docker compose up -d        # Mongo + Redis
cp .env.example .env
npm install
npm run seed                # popular ambas bases desde data/*.csv
npm start                   # API en http://localhost:3000
```

Dashboard interactivo en `http://localhost:3000`. Tab **Queries** para
ejecutar cada endpoint parametrizable.

## Estructura

```
vetsalud/
├── INFORME.md              # Informe técnico completo
├── docker-compose.yml      # Mongo + Redis
├── data/                   # CSV de seed
├── public/index.html       # Dashboard + tab Queries
└── src/
    ├── db.js               # Conexión a Mongo y Redis
    ├── seed.js             # Carga CSV → Mongo + Redis
    ├── queries/            # Una consulta por módulo
    │   ├── index.js        # Exporta las 15 consultas
    │   ├── cache.js        # Helpers de caché en Redis
    │   └── q01-...q15.js   # Implementación documentada de cada query
    └── server.js           # API Express
```

## Consultas

| # | Consulta | Motor | Endpoint |
|---|----------|-------|----------|
| 1 | Pacientes activos + propietario | Mongo | `GET /api/pacientes-activos` |
| 2 | Consultas en seguimiento | Mongo | `GET /api/consultas-seguimiento` |
| 3 | Historial de paciente | Mongo | `GET /api/historial-paciente/:id` |
| 4 | Propietarios con múltiples pacientes | Mongo | `GET /api/propietarios-multiples-pacientes` |
| 5 | Vets activos con consultas 60d | Mongo (cache) | `GET /api/vets-activos-consultas-60d` |
| 6 | Pacientes con vacunas vencidas | Mongo | `GET /api/pacientes-vacunas-vencidas` |
| 7 | Top 5 diagnósticos | Mongo (cache) | `GET /api/top-diagnosticos` |
| 8 | Stock bajo (políglota) | Redis + Mongo | `GET /api/stock-bajo?umbral=50` |
| 9 | Controles con costo < N | Mongo | `GET /api/controles-baratos?max=5000` |
| 10 | Pacientes por sucursal | Mongo | `GET /api/pacientes-sucursal?sucursal=Palermo` |
| 11 | Ingresos por vet del mes actual | Mongo (cache) | `GET /api/ingresos-vet-mes` |
| 12 | Propietarios a revisar | Mongo | `GET /api/propietarios-inactivos` |
| 13 | ABM de propietarios | Mongo | `POST` / `PUT` / `DELETE /api/propietarios[/:id]` |
| 14 | Alta de consulta + descuento de stock | Mongo + Redis | `POST /api/consultas` |
| 15 | Decrementar stock (atómico) | Redis (Lua) | `POST /api/decrementar-stock` |

Caché administrable vía `POST /api/cache/flush`.

## Probar escrituras

```bash
# Alta de propietario
curl -X POST http://localhost:3000/api/propietarios \
  -H "Content-Type: application/json" \
  -d '{"_id":"C100","nombre":"Lucía","apellido":"Vega","ciudad":"CABA"}'

# Modificar (cualquier campo)
curl -X PUT http://localhost:3000/api/propietarios/C100 \
  -H "Content-Type: application/json" -d '{"ciudad":"Rosario"}'

# Baja lógica
curl -X DELETE http://localhost:3000/api/propietarios/C100

# Alta de consulta con descuento de stock
curl -X POST http://localhost:3000/api/consultas \
  -H "Content-Type: application/json" \
  -d '{"id_paciente":"P002","id_vet":"V003","motivo":"Control","costo":3000,
       "productos_usados":[{"id_producto":"PRD001","cantidad":2}]}'
```
