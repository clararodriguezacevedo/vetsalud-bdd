import { connect } from '../db.js';

/**
 * Consulta 9 - Consultas de control con costo bajo umbral.
 *
 * Requisito de la consigna:
 * listar consultas de tipo Control con costo menor a $5.000.
 *
 * Motor: MongoDB.
 * Colecciones: consultas, pacientes.
 * Endpoint: GET /api/controles-baratos?max=5000.
 */
export async function controlesBaratos(maxCosto = 5000) {
  const { db } = await connect();
  return db
    .collection('consultas')
    .aggregate([
      {
        $match: {
          tipo: 'Consulta',
          motivo: { $regex: '^Control', $options: 'i' },
          costo: { $lt: maxCosto },
        },
      },
      {
        $lookup: {
          from: 'pacientes',
          localField: 'id_paciente',
          foreignField: '_id',
          as: 'paciente',
        },
      },
      { $unwind: '$paciente' },
      { $sort: { costo: 1 } },
      {
        $project: {
          motivo: 1, diagnostico: 1, costo: 1, fecha: 1,
          'paciente.nombre': 1, 'paciente.especie': 1,
        },
      },
    ])
    .toArray();
}
