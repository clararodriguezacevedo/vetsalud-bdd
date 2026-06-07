import { connect } from '../db.js';

/**
 * Consulta 9 - Consultas de control con costo bajo umbral.
 *
 * Requisito de la consigna:
 * listar consultas de tipo Control con costo menor a $5.000.
 * En este modelo, Control se interpreta como una consulta medica no quirurgica,
 * representada por tipo = Consulta.
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
