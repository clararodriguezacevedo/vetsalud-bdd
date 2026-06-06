import { connect } from '../db.js';
import { cached } from './cache.js';

/**
 * Consulta 7 - Top 5 diagnosticos mas frecuentes.
 *
 * Requisito de la consigna:
 * obtener los cinco diagnosticos mas frecuentes.
 *
 * Motor: MongoDB, con cache en Redis.
 * Coleccion: consultas.
 * Endpoint: GET /api/top-diagnosticos.
 */
export async function topDiagnosticos() {
  return cached('cache:top-diagnosticos', 300, async () => {
    const { db } = await connect();
    return db
      .collection('consultas')
      .aggregate([
        { $group: { _id: '$diagnostico', total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 5 },
      ])
      .toArray();
  });
}
