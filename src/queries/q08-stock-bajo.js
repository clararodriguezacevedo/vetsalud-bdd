import { connect } from '../db.js';

/**
 * Consulta 8 - Stock de productos con menos de un umbral de unidades.
 *
 * Requisito de la consigna:
 * listar productos con menos de 50 unidades y su proveedor.
 *
 * Motores: Redis y MongoDB.
 * Clave Redis: stock:unidades.
 * Coleccion MongoDB: productos.
 * Endpoint: GET /api/stock-bajo?umbral=50.
 */
export async function stockBajo(umbral = 50) {
  const { db, redis } = await connect();
  const entries = await redis.zRangeByScoreWithScores('stock:unidades', '-inf', `(${Number(umbral)}`);
  if (entries.length === 0) return [];
  const ids = entries.map((e) => e.value);
  const meta = await db.collection('productos').find({ _id: { $in: ids } }).toArray();
  const metaMap = new Map(meta.map((p) => [p._id, p]));
  return entries.map((e) => ({
    ...(metaMap.get(e.value) || { _id: e.value }),
    unidades: Number(e.score),
  }));
}
