# VetSalud — Sistema de Gestión de Clínica Veterinaria

Trabajo Práctico de Base de Datos II. Arquitectura de **persistencia políglota**
con dos motores NoSQL de paradigmas distintos:

- **MongoDB** (documental) → dominio principal: `propietarios`, `pacientes`,
  `veterinarios`, `consultas`, `vacunaciones`. Resuelve filtros y agregaciones
  (la mayoría de las 15 consultas) con el aggregation pipeline y `$lookup`.
- **Redis** (clave-valor) → stock farmacéutico. Hash por producto + un Sorted Set
  (`stock:unidades`) que permite detectar bajo stock por rango y descontar unidades
  de forma **atómica** con `HINCRBY`.

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
├── data/                   # CSV de ejemplo (reemplazar por los oficiales de la cátedra)
├── public/index.html       # Frontend simple
└── src/
    ├── db.js               # Conexión a ambos motores
    ├── seed.js             # Carga de CSV → Mongo + Redis
    ├── queries.js          # Las 15 consultas (4 implementadas, 11 como TODO)
    └── server.js           # API Express
```

## Estado de las consultas

Implementadas como ejemplo: **1** (pacientes activos + propietario), **7** (top
diagnósticos), **8** (stock bajo), **15** (decremento de stock). Las **11
restantes** están como stubs comentados en `src/queries.js` con la pista de cómo
resolverlas; cada una debe agregar su endpoint en `src/server.js` y, si se quiere,
un botón en el frontend.

## Pendientes del enunciado

- Agregar **10+ registros propios** por colección/tabla.
- Modelar **cirugías** (no hay CSV ni consultas): misma estructura que `consultas`.
- Redactar en el informe la **justificación técnica** de por qué cada motor.
