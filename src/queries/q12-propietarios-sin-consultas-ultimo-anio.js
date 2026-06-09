import { connect } from '../db.js';

/**
 * Consulta 12 - Propietarios sin consultas en el último año.
 *
 * Lista propietarios que no registran actividad clínica:
 *  - propietarios sin pacientes registrados.
 *  - propietarios con pacientes pero sin consultas en el último año.
 *
 * Motor: MongoDB.
 * Colecciones: propietarios, pacientes, consultas.
 * Endpoint: GET /api/propietarios-sin-consultas.
 */
export async function propietariosSinConsultasUltimoAnio() {
  const { db } = await connect();
  const haceUnAnio = new Date();
  haceUnAnio.setHours(0, 0, 0, 0);
  haceUnAnio.setFullYear(haceUnAnio.getFullYear() - 1);
  return db
    .collection('propietarios')
    .aggregate([
      {
        $lookup: {
          from: 'pacientes',
          localField: '_id',
          foreignField: 'id_propietario',
          as: 'pacientes',
        },
      },
      {
        $lookup: {
          from: 'consultas',
          let: { idsPac: '$pacientes._id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ['$id_paciente', '$$idsPac'] },
                    { $gte: ['$fecha', haceUnAnio] },
                  ],
                },
              },
            },
          ],
          as: 'consultasRecientes',
        },
      },
      {
        $addFields: {
          cantidad_mascotas: { $size: '$pacientes' },
          cantidad_consultas_recientes: { $size: '$consultasRecientes' },
        },
      },
      {
        $match: {
          $or: [
            { cantidad_mascotas: 0 },
            { cantidad_consultas_recientes: 0 },
          ],
        },
      },
      {
        $addFields: {
          categoria: {
            $cond: [
              { $eq: ['$cantidad_mascotas', 0] },
              'Sin mascotas',
              'Sin consultas en el último año',
            ],
          },
          _orden_categoria: {
            $cond: [{ $eq: ['$cantidad_mascotas', 0] }, 1, 2],
          },
        },
      },
      {
        $project: {
          categoria: 1,
          activo: 1,
          nombre: 1,
          apellido: 1,
          email: 1,
          ciudad: 1,
          provincia: 1,
          cantidad_mascotas: 1,
          cantidad_consultas_recientes: 1,
          _orden_categoria: 1,
        },
      },
      { $sort: { _orden_categoria: 1, cantidad_mascotas: -1, _id: 1 } },
      { $project: { _orden_categoria: 0 } },
    ])
    .toArray();
}
