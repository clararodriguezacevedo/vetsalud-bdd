# Plan de ejecución del TPO VetSalud

## Estado actual del proyecto

El proyecto ya tiene una base funcional de persistencia poliglota con:

- MongoDB para `propietarios`, `pacientes`, `veterinarios`, `consultas` y `vacunaciones`.
- Redis para `stock_farmaceutico`.
- Seed inicial desde los CSV en `data/`.
- API Express y frontend simple para ejecutar consultas desde el navegador.

Según el código actual, las 15 consultas y servicios quedaron implementados y expuestos en la API y el frontend.

## Brechas detectadas

1. Las consultas 2, 3, 4, 5 y 6 ya fueron implementadas.
2. El conjunto de datos ya supera el mínimo de 10 registros propios adicionales por colección requerida.
3. El informe técnico quedó documentado en el README con justificación de MongoDB y Redis, más ejemplos de salida.
4. La semántica de negocio quedó alineada con el enunciado para seguimiento, historial, propietarios múltiples y vacunas vencidas.
5. Se validó el seed completo y las rutas nuevas con pruebas de extremo a extremo sobre la API.

## Prioridad de trabajo

### Fase 1: Completar consultas faltantes

Objetivo: implementar los servicios 2 a 6 en `src/queries.js`, exponerlos en `src/server.js` y agregarlos al frontend en `public/index.html`.

#### Q2 - Consultas médicas abiertas con veterinario asignado y costo

- Definir una consulta de Mongo sobre `consultas` con `estado: 'Seguimiento'`.
- Hacer `lookup` contra `veterinarios` para traer nombre, apellido, matrícula, especialidad y sucursal.
- Incluir `costo`, `fecha`, `motivo`, `diagnostico`, `id_paciente` e información mínima del paciente si hace falta para el informe.
- Exponer endpoint `GET /api/consultas-seguimiento` o nombre equivalente.
- Agregar botón y bloque de resultados en la vista de consultas o reportes.

#### Q3 - Historial completo de un paciente: consultas y vacunaciones ordenadas por fecha

- Recibir `id_paciente` como parámetro.
- Consultar ambas colecciones: `consultas` y `vacunaciones`.
- Unificar el historial en una sola salida ordenada por fecha descendente o ascendente, pero documentar cuál se usa.
- Normalizar el esquema de salida para que ambas fuentes tengan un campo `tipo_evento` o equivalente.
- Incluir endpoint `GET /api/historial-paciente/:id`.
- Agregar un ejemplo de paciente con consultas y vacunas en la interfaz o al menos en el README/informe.

#### Q4 - Propietarios con más de un paciente registrado

- Hacer agregación sobre `pacientes` agrupando por `id_propietario`.
- Filtrar grupos con conteo mayor a 1.
- Hacer `lookup` a `propietarios` para devolver datos del dueño y cantidad de pacientes.
- Exponer endpoint `GET /api/propietarios-multiples-pacientes`.

#### Q5 - Veterinarios activos y cantidad de consultas realizadas en los últimos 60 días

- Filtrar veterinarios con `activo: true`.
- Contar consultas en `consultas` cuya `fecha` esté dentro de los últimos 60 días.
- Hacer `lookup` por `id_vet` y devolver el contador por veterinario.
- Ordenar de mayor a menor cantidad de consultas.
- Exponer endpoint `GET /api/vets-activos-consultas-60d`.

#### Q6 - Pacientes con vacunas vencidas

- Consultar `vacunaciones` filtrando `proxima_dosis < hoy`.
- Hacer `lookup` con `pacientes` y, si sirve para el informe, con `propietarios`.
- Agrupar o deduplicar por paciente si un mismo animal tiene varias vacunas vencidas.
- Exponer endpoint `GET /api/pacientes-vacunas-vencidas`.

### Fase 2: Integrar las nuevas consultas en la app

- Agregar funciones cliente para consumir los nuevos endpoints.
- Añadir botones y secciones en `public/index.html` para Q2 a Q6.
- Mantener el mismo patrón visual y de renderizado ya usado en la app.
- Verificar que el modo tabla/JSON siga funcionando con las nuevas respuestas.

### Fase 3: Completar la carga de datos extra

Objetivo: cumplir el requisito de enriquecer cada colección con al menos 10 registros propios adicionales.

- Agregar al menos 10 propietarios nuevos.
- Agregar al menos 10 pacientes nuevos.
- Agregar al menos 10 veterinarios nuevos si el enunciado y el modelo de negocio lo permiten sin romper la lógica.
- Agregar al menos 10 consultas nuevas, incluyendo ejemplos de `Seguimiento`, consultas cerradas y, si aplica, cirugías.
- Agregar al menos 10 vacunaciones nuevas.
- Agregar al menos 10 productos nuevos en stock.
- Mantener consistencia entre referencias: pacientes deben apuntar a propietarios existentes, consultas y vacunaciones deben apuntar a pacientes y veterinarios válidos.
- Reejecutar el seed luego de ampliar los CSV o, preferentemente, generar un seed determinístico con los registros base más los extra.

### Fase 4: Cerrar el informe de entrega

- Explicar por qué MongoDB se usa para entidades relacionales flexibles y consultas con agregaciones.
- Explicar por qué Redis se usa para stock y decrementos atómicos.
- Incluir el modelo de datos elegido y la razón de agrupar consultas clínicas en una sola colección.
- Mostrar al menos un ejemplo de salida por consulta/servicio.
- Documentar cómo correr el proyecto y cómo se carga la base.
- Incluir capturas o salidas representativas de las consultas faltantes.

### Fase 5: Validación final

- Probar el seed completo desde cero.
- Ejecutar cada endpoint manualmente y verificar datos esperados.
- Validar que las consultas 2 a 6 no rompan el frontend.
- Confirmar que la baja lógica de propietarios y la alta de consulta respetan las validaciones.
- Revisar que el stock nunca quede negativo.

## Orden recomendado de implementación

1. Implementar Q2 a Q6 en `src/queries.js`.
2. Exponer los endpoints en `src/server.js`.
3. Agregar botones y formularios mínimos en `public/index.html`.
4. Completar los CSV con datos nuevos y re-seed.
5. Redactar el informe final con justificación técnica y ejemplos.
6. Ejecutar validación manual final y corregir inconsistencias.

## Criterios de finalización

Se considera listo para entregar cuando:

- Las 15 consultas/servicios están implementados y accesibles.
- El frontend permite probar todas las consultas.
- Los datasets tienen al menos 10 registros adicionales propios por colección/tabla requerida.
- El informe explica la elección de motores NoSQL y muestra ejemplos reales.
- El proyecto se puede levantar desde cero con `docker compose up -d`, `npm install`, `npm run seed` y `npm start`.
