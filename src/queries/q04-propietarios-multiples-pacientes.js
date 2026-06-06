import { connect } from '../db.js';

/**
 * Consulta 4 - Propietarios con mas de un paciente registrado.
 *
 * Requisito de la consigna:
 * listar propietarios que tengan mas de un paciente registrado.
 *
 * Motor: MongoDB.
 * Colecciones: pacientes, propietarios.
 * Endpoint: GET /api/propietarios-multiples-pacientes.
 */
export async function propietariosConMultiplesPacientes() {
  const { db } = await connect();
  return db
    .collection('pacientes')
    .aggregate([
      {
        $group: {
          _id: '$id_propietario',
          cantidad_pacientes: { $sum: 1 },
          pacientes: {
            $push: {
              _id: '$_id',
              nombre: '$nombre',
              especie: '$especie',
              raza: '$raza',
              activo: '$activo',
            },
          },
        },
      },
      { $match: { cantidad_pacientes: { $gt: 1 } } },
      {
        $lookup: {
          from: 'propietarios',
          localField: '_id',
          foreignField: '_id',
          as: 'propietario',
        },
      },
      { $unwind: '$propietario' },
      {
        $project: {
          _id: 0,
          id_propietario: '$_id',
          cantidad_pacientes: 1,
          propietario: {
            _id: '$propietario._id',
            nombre: '$propietario.nombre',
            apellido: '$propietario.apellido',
            email: '$propietario.email',
            telefono: '$propietario.telefono',
            ciudad: '$propietario.ciudad',
            provincia: '$propietario.provincia',
            activo: '$propietario.activo',
          },
          pacientes: 1,
        },
      },
      { $sort: { cantidad_pacientes: -1, id_propietario: 1 } },
    ])
    .toArray();
}
