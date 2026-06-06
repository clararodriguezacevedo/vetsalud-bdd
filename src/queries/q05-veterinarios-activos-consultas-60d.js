import { connect } from '../db.js';
import { cached } from './cache.js';

/**
 * Consulta 5 - Veterinarios activos con consultas en los ultimos 60 dias.
 *
 * Requisito de la consigna:
 * listar veterinarios activos y la cantidad de consultas realizadas en los
 * ultimos 60 dias.
 *
 * Motor: MongoDB, con cache en Redis.
 * Colecciones: veterinarios, consultas.
 * Endpoint: GET /api/vets-activos-consultas-60d.
 */
export async function veterinariosActivosConConsultas60d() {
  return cached('cache:vets-consultas-60d', 300, async () => {
    const { db } = await connect();
    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    desde.setDate(desde.getDate() - 60);
    const hasta = new Date();
    hasta.setHours(0, 0, 0, 0);
    hasta.setDate(hasta.getDate() + 1);
    return db
      .collection('veterinarios')
      .aggregate([
        { $match: { activo: true } },
        {
          $lookup: {
            from: 'consultas',
            let: { vetId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id_vet', '$$vetId'] },
                      { $gte: ['$fecha', desde] },
                      { $lt: ['$fecha', hasta] },
                    ],
                  },
                },
              },
            ],
            as: 'consultas_60d',
          },
        },
        {
          $project: {
            _id: 0,
            id_vet: '$_id',
            nombre: 1,
            apellido: 1,
            matricula: 1,
            especialidad: 1,
            sucursal: 1,
            activo: 1,
            cantidad_consultas_60d: { $size: '$consultas_60d' },
          },
        },
        { $sort: { cantidad_consultas_60d: -1, apellido: 1, nombre: 1 } },
      ])
      .toArray();
  });
}
