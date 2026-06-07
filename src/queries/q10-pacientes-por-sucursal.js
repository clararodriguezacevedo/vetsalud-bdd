import { connect } from '../db.js';

/**
 * Consulta 10 - Pacientes de una sucursal determinada.
 *
 * Requisito de la consigna:
 * listar todos los pacientes de una sucursal determinada, a traves del
 * veterinario.
 *
 * Motor: MongoDB.
 * Colecciones: veterinarios, consultas, vacunaciones, pacientes.
 * Endpoint: GET /api/pacientes-sucursal?sucursal=Palermo.
 */
export async function pacientesPorSucursal(sucursal) {
  const { db } = await connect();
  return db
    .collection('veterinarios')
    .aggregate([
      { $match: { sucursal } },
      {
        $lookup: {
          from: 'consultas',
          localField: '_id',
          foreignField: 'id_vet',
          as: 'consultas',
        },
      },
      {
        $lookup: {
          from: 'vacunaciones',
          localField: '_id',
          foreignField: 'id_vet',
          as: 'vacunaciones',
        },
      },
      {
        $project: {
          ids: { $setUnion: ['$consultas.id_paciente', '$vacunaciones.id_paciente'] },
        },
      },
      { $unwind: '$ids' },
      { $group: { _id: '$ids' } },
      {
        $lookup: {
          from: 'pacientes',
          localField: '_id',
          foreignField: '_id',
          as: 'paciente',
        },
      },
      { $unwind: '$paciente' },
      { $replaceRoot: { newRoot: '$paciente' } },
      { $sort: { _id: 1 } },
    ])
    .toArray();
}
