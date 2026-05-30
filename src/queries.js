import { connect } from './db.js';

// =====================================================================
//  CONSULTAS / SERVICIOS
//  Hay 4 implementadas como ejemplo (1, 7, 8, 15) que muestran los dos
//  patrones: aggregation pipeline en Mongo y operaciones sobre Redis.
//  Las 11 restantes están como stubs con la pista de cómo encararlas.
// =====================================================================

// --- 1 · Pacientes activos con todos sus datos de propietario (Mongo) ---
export async function pacientesActivosConPropietario() {
  const { db } = await connect();
  return db
    .collection('pacientes')
    .aggregate([
      { $match: { activo: true } },
      {
        $lookup: {
          from: 'propietarios',
          localField: 'id_propietario',
          foreignField: '_id',
          as: 'propietario',
        },
      },
      { $unwind: '$propietario' },
    ])
    .toArray();
}

// --- 7 · Top 5 diagnósticos más frecuentes (Mongo) ---
export async function topDiagnosticos() {
  const { db } = await connect();
  return db
    .collection('consultas')
    .aggregate([
      { $group: { _id: '$diagnostico', total: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 5 },
    ])
    .toArray();
}

// --- 8 · Stock con menos de N unidades y su proveedor (Redis) ---
export async function stockBajo(umbral = 50) {
  const { redis } = await connect();
  // Sorted Set: traemos los ids con score (unidades) por debajo del umbral
  const ids = await redis.zRangeByScore('stock:unidades', '-inf', umbral - 1);
  const productos = [];
  for (const id of ids) {
    const p = await redis.hGetAll(`producto:${id}`);
    productos.push({ id_producto: id, ...p, unidades: Number(p.unidades) });
  }
  return productos;
}

// --- 15 · Decrementar unidades de un producto tras una consulta (Redis) ---
export async function decrementarStock(idProducto, cantidad) {
  const { redis } = await connect();
  const key = `producto:${idProducto}`;
  if (!(await redis.exists(key))) {
    throw new Error(`El producto ${idProducto} no existe`);
  }
  // HINCRBY es atómico: evita condiciones de carrera al descontar stock
  const unidades = await redis.hIncrBy(key, 'unidades', -Math.abs(cantidad));
  await redis.zAdd('stock:unidades', { score: unidades, value: idProducto }); // mantener índice
  return { id_producto: idProducto, unidades };
}

// =====================================================================
//  TODO — implementar siguiendo los patrones de arriba:
//
//  2  Consultas en 'Seguimiento' con veterinario y costo
//        Mongo: $match { estado: 'Seguimiento' } + $lookup a veterinarios
//  3  Historial de un paciente: consultas + vacunaciones ordenadas por fecha
//        Mongo: dos queries y mergear en JS, o $unionWith
//  4  Propietarios con más de un paciente
//        Mongo: $group por id_propietario + $match { count: { $gt: 1 } }
//  5  Veterinarios activos y nº de consultas en los últimos 60 días
//        Mongo: $match fecha >= hoy-60d + $group por id_vet
//  6  Pacientes con vacunas vencidas (proxima_dosis < hoy)
//        Mongo: $match { proxima_dosis: { $lt: new Date() } }
//  9  Consultas tipo 'Control' con costo < 5000
//        Mongo: $match { motivo: /Control/, costo: { $lt: 5000 } }
//  10 Pacientes de una sucursal (vía veterinario)
//        Mongo: veterinarios de la sucursal -> sus consultas -> pacientes
//  11 Ingresos totales por veterinario en el mes actual
//        Mongo: $match fecha en mes actual + $group $sum costo
//  12 Propietarios sin consultas en el último año
//        Mongo: $lookup pacientes->consultas + $match sin resultados
//  13 ABM de propietarios (alta / modificación / baja lógica activo=false)
//        Mongo: insertOne / updateOne / updateOne { activo: false }
//  14 Alta de consulta validando paciente y veterinario existentes
//        Mongo: verificar _id en pacientes y veterinarios, luego insertOne
//        (opcional: encadenar decrementarStock del producto usado)
// =====================================================================
