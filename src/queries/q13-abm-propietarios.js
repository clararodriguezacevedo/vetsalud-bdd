import { connect } from '../db.js';

/**
 * Consulta 13 - ABM completo de propietarios.
 *
 * Requisito de la consigna:
 * implementar alta, modificacion de datos y baja logica de propietarios.
 *
 * Motor: MongoDB.
 * Coleccion: propietarios.
 * Endpoints:
 * - POST /api/propietarios
 * - PUT /api/propietarios/:id
 * - DELETE /api/propietarios/:id
 */
export async function altaPropietario(propietario) {
  const { db } = await connect();
  if (!propietario?._id) throw new Error('Falta el _id del propietario');

  const existe = await db.collection('propietarios').findOne({ _id: propietario._id });
  if (existe) throw new Error(`El propietario ${propietario._id} ya existe`);

  await db.collection('propietarios').insertOne({ activo: true, ...propietario });
  return { ok: true, _id: propietario._id };
}

export async function modificarPropietario(id, cambios = {}) {
  const { db } = await connect();
  const cambiosPermitidos = { ...cambios };
  delete cambiosPermitidos._id;

  const r = await db.collection('propietarios').updateOne({ _id: id }, { $set: cambiosPermitidos });
  if (r.matchedCount === 0) throw new Error(`El propietario ${id} no existe`);

  return { ok: true, modificados: r.modifiedCount };
}

export async function bajaPropietario(id) {
  const { db } = await connect();
  const r = await db.collection('propietarios').updateOne({ _id: id }, { $set: { activo: false } });
  if (r.matchedCount === 0) throw new Error(`El propietario ${id} no existe`);

  return { ok: true, baja_logica: id };
}
