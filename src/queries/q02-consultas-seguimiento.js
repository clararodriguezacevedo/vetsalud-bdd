import { connect } from '../db.js';

/**
 * Consulta 2 - Consultas medicas abiertas en seguimiento.
 *
 * Requisito de la consigna:
 * listar consultas medicas abiertas, con estado Seguimiento, veterinario
 * asignado y costo.
 *
 * Motor: MongoDB.
 * Colecciones: consultas, veterinarios, pacientes.
 * Endpoint: GET /api/consultas-seguimiento.
 */
export async function consultasEnSeguimiento() {
  const { db } = await connect();
  return db
    .collection('consultas')
    .aggregate([
      { $match: { estado: 'Seguimiento' } },
      {
        $lookup: {
          from: 'veterinarios',
          localField: 'id_vet',
          foreignField: '_id',
          as: 'veterinario',
        },
      },
      { $unwind: '$veterinario' },
      {
        $lookup: {
          from: 'pacientes',
          localField: 'id_paciente',
          foreignField: '_id',
          as: 'paciente',
        },
      },
      { $unwind: '$paciente' },
      {
        $project: {
          _id: 1,
          fecha: 1,
          tipo: 1,
          motivo: 1,
          diagnostico: 1,
          costo: 1,
          estado: 1,
          id_paciente: 1,
          paciente: {
            _id: '$paciente._id',
            nombre: '$paciente.nombre',
            especie: '$paciente.especie',
            raza: '$paciente.raza',
          },
          veterinario: {
            _id: '$veterinario._id',
            nombre: '$veterinario.nombre',
            apellido: '$veterinario.apellido',
            matricula: '$veterinario.matricula',
            especialidad: '$veterinario.especialidad',
            sucursal: '$veterinario.sucursal',
          },
        },
      },
      { $sort: { fecha: -1, _id: 1 } },
    ])
    .toArray();
}
