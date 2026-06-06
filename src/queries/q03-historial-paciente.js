import { connect } from '../db.js';

/**
 * Consulta 3 - Historial completo de un paciente.
 *
 * Requisito de la consigna:
 * listar consultas y vacunaciones de un paciente, ordenadas por fecha.
 *
 * Motor: MongoDB, con combinacion final en Node.js.
 * Colecciones: pacientes, consultas, vacunaciones, veterinarios.
 * Endpoint: GET /api/historial-paciente/:id.
 */
export async function historialPaciente(idPaciente) {
  const { db } = await connect();
  const paciente = await db.collection('pacientes').findOne({ _id: idPaciente });
  if (!paciente) throw new Error(`El paciente ${idPaciente} no existe`);

  const [consultas, vacunaciones] = await Promise.all([
    db.collection('consultas').aggregate([
      { $match: { id_paciente: idPaciente } },
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
        $project: {
          _id: 0,
          tipo_evento: { $literal: 'Consulta' },
          id_evento: '$_id',
          fecha: 1,
          paciente: { _id: paciente._id, nombre: paciente.nombre, especie: paciente.especie, raza: paciente.raza },
          veterinario: {
            _id: '$veterinario._id',
            nombre: '$veterinario.nombre',
            apellido: '$veterinario.apellido',
            matricula: '$veterinario.matricula',
            sucursal: '$veterinario.sucursal',
          },
          motivo: 1,
          diagnostico: 1,
          costo: 1,
          estado: 1,
          nombre_vacuna: { $literal: null },
          proxima_dosis: { $literal: null },
        },
      },
    ]).toArray(),
    db.collection('vacunaciones').aggregate([
      { $match: { id_paciente: idPaciente } },
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
        $project: {
          _id: 0,
          tipo_evento: { $literal: 'Vacunacion' },
          id_evento: '$_id',
          fecha: '$fecha_aplicacion',
          paciente: { _id: paciente._id, nombre: paciente.nombre, especie: paciente.especie, raza: paciente.raza },
          veterinario: {
            _id: '$veterinario._id',
            nombre: '$veterinario.nombre',
            apellido: '$veterinario.apellido',
            matricula: '$veterinario.matricula',
            sucursal: '$veterinario.sucursal',
          },
          motivo: { $literal: null },
          diagnostico: { $literal: null },
          costo: { $literal: null },
          estado: { $literal: null },
          nombre_vacuna: 1,
          proxima_dosis: 1,
        },
      },
    ]).toArray(),
  ]);

  return [...consultas, ...vacunaciones]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha) || String(a.id_evento).localeCompare(String(b.id_evento)));
}
