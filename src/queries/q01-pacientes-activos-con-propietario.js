import { connect } from '../db.js';

/**
 * Consulta 1 - Pacientes activos con todos sus datos de propietario.
 *
 * Requisito de la consigna:
 * listar los pacientes activos y adjuntar los datos completos del propietario.
 *
 * Motor: MongoDB.
 * Colecciones: pacientes, propietarios.
 * Endpoint: GET /api/pacientes-activos.
 */
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
      {
        $project: {
          nombre: 1, especie: 1, raza: 1, fecha_nac: 1, activo: 1,
          'propietario._id': 1,
          'propietario.nombre': 1,
          'propietario.apellido': 1,
          'propietario.dni': 1,
          'propietario.email': 1,
          'propietario.telefono': 1,
          'propietario.ciudad': 1,
          'propietario.provincia': 1,
          'propietario.activo': 1,
        },
      },
    ])
    .toArray();
}
