import { connect } from '../db.js';

/**
 * Consulta 6 - Pacientes con vacunas vencidas.
 *
 * Requisito de la consigna:
 * listar pacientes con vacunas cuya proxima dosis sea anterior a hoy.
 *
 * Motor: MongoDB.
 * Colecciones: vacunaciones, pacientes.
 * Endpoint: GET /api/pacientes-vacunas-vencidas.
 */
export async function pacientesConVacunasVencidas() {
  const { db } = await connect();
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return db
    .collection('vacunaciones')
    .aggregate([
      { $match: { proxima_dosis: { $lt: hoy } } },
      {
        $group: {
          _id: '$id_paciente',
          cantidad_vacunas_vencidas: { $sum: 1 },
          vacunas_vencidas: {
            $push: {
              id_vacuna: '$_id',
              nombre_vacuna: '$nombre_vacuna',
              fecha_aplicacion: '$fecha_aplicacion',
              proxima_dosis: '$proxima_dosis',
              id_vet: '$id_vet',
            },
          },
          proxima_dosis_mas_antigua: { $min: '$proxima_dosis' },
        },
      },
      {
        $lookup: {
          from: 'pacientes',
          localField: '_id',
          foreignField: '_id',
          as: 'paciente',
        },
      },
      { $unwind: '$paciente' },
      {
        $project: {
          _id: 0,
          paciente: {
            _id: '$paciente._id',
            nombre: '$paciente.nombre',
            especie: '$paciente.especie',
            raza: '$paciente.raza',
            activo: '$paciente.activo',
          },
          cantidad_vacunas_vencidas: 1,
          proxima_dosis_mas_antigua: 1,
          vacunas_vencidas: 1,
        },
      },
      { $sort: { proxima_dosis_mas_antigua: 1, 'paciente._id': 1 } },
    ])
    .toArray();
}
