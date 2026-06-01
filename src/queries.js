import { connect } from './db.js';

// 1 - Pacientes activos con todos sus datos de propietario (Mongo)
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
    ])
    .toArray();
}

// 7 - Top 5 diagnósticos más frecuentes (Mongo)
export async function topDiagnosticos() {
  const { db } = await connect();
  return db
    .collection('consultas')
    .aggregate([
      { $group: { _id: '$diagnostico', total: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 5 },
    ])
    .toArray();
}

// 8 - Stock con menos de N unidades y su proveedor (Redis)
export async function stockBajo(umbral = 50) {
  const { redis } = await connect();
  // Sorted Set: traemos los ids con score (unidades) por debajo del umbral
  const ids = await redis.zRangeByScore('stock:unidades', '-inf', umbral - 1);
  const productos = [];
  for (const id of ids) {
    const p = await redis.hGetAll(`producto:${id}`);
    productos.push({ id_producto: id, ...p, unidades: Number(p.unidades) });
  }
  return productos;
}

// 9 - Consultas de tipo Control con costo menor a 5000 (Mongo)
export async function controlesBaratos(maxCosto = 5000) {
  const { db } = await connect();
  return db
    .collection('consultas')
    .aggregate([
      { $match: { motivo: { $regex: /control/i }, costo: { $lt: maxCosto } } },
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

// 10 - Pacientes de una sucursal, a través del veterinario (Mongo)
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
      { $unwind: '$consultas' },
      { $group: { _id: '$consultas.id_paciente' } },
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

// 11 - Ingresos totales por veterinario en el mes actual (Mongo)
export async function ingresosPorVetMesActual() {
  const { db } = await connect();
  const ahora = new Date();
  const desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const hasta = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
  return db
    .collection('consultas')
    .aggregate([
      { $match: { fecha: { $gte: desde, $lt: hasta } } },
      { $group: { _id: '$id_vet', ingresos: { $sum: '$costo' }, cantidad: { $sum: 1 } } },
      {
        $lookup: {
          from: 'veterinarios',
          localField: '_id',
          foreignField: '_id',
          as: 'vet',
        },
      },
      { $unwind: '$vet' },
      {
        $project: {
          _id: 0, id_vet: '$_id',
          veterinario: { $concat: ['$vet.nombre', ' ', '$vet.apellido'] },
          sucursal: '$vet.sucursal', ingresos: 1, cantidad: 1,
        },
      },
      { $sort: { ingresos: -1 } },
    ])
    .toArray();
}

// 12 - Propietarios sin consultas registradas en el último año (Mongo)
export async function propietariosSinConsultasUltimoAnio() {
  const { db } = await connect();
  const haceUnAnio = new Date();
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
      { $match: { consultasRecientes: { $size: 0 } } },
      { $project: { nombre: 1, apellido: 1, email: 1, ciudad: 1, provincia: 1 } },
    ])
    .toArray();
}

// 13 - ABM de propietarios
// Alta, modificación, baja lógica (Mongo)
export async function altaPropietario(propietario) {
  const { db } = await connect();
  if (!propietario._id) throw new Error('Falta el _id del propietario');
  const existe = await db.collection('propietarios').findOne({ _id: propietario._id });
  if (existe) throw new Error(`El propietario ${propietario._id} ya existe`);
  await db.collection('propietarios').insertOne({ activo: true, ...propietario });
  return { ok: true, _id: propietario._id };
}

export async function modificarPropietario(id, cambios) {
  const { db } = await connect();
  delete cambios._id;
  const r = await db.collection('propietarios').updateOne({ _id: id }, { $set: cambios });
  if (r.matchedCount === 0) throw new Error(`El propietario ${id} no existe`);
  return { ok: true, modificados: r.modifiedCount };
}

export async function bajaPropietario(id) {
  const { db } = await connect();
  const r = await db.collection('propietarios').updateOne({ _id: id }, { $set: { activo: false } });
  if (r.matchedCount === 0) throw new Error(`El propietario ${id} no existe`);
  return { ok: true, baja_logica: id };
}

// 14 - Alta de consulta validando paciente y veterinario existentes (Mongo)
export async function altaConsulta(consulta) {
  const { db } = await connect();
  const { id_paciente, id_vet } = consulta;
  const paciente = await db.collection('pacientes').findOne({ _id: id_paciente });
  if (!paciente) throw new Error(`El paciente ${id_paciente} no existe`);
  const vet = await db.collection('veterinarios').findOne({ _id: id_vet });
  if (!vet) throw new Error(`El veterinario ${id_vet} no existe`);
  let _id = consulta._id;
  if (!_id) {
    const ult = await db.collection('consultas').find().sort({ _id: -1 }).limit(1).next();
    const n = ult ? Number(String(ult._id).replace(/\D/g, '')) + 1 : 1;
    _id = 'CON' + String(n).padStart(3, '0');
  }
  const doc = {
    _id,
    id_paciente,
    id_vet,
    fecha: consulta.fecha ? new Date(consulta.fecha) : new Date(),
    motivo: consulta.motivo || '',
    diagnostico: consulta.diagnostico || '',
    costo: Number(consulta.costo) || 0,
    estado: consulta.estado || 'Cerrada',
  };
  await db.collection('consultas').insertOne(doc);
  return { ok: true, consulta: doc };
}

// 15 - Decrementar unidades de un producto tras una consulta (Redis)
export async function decrementarStock(idProducto, cantidad) {
  const { redis } = await connect();
  const key = `producto:${idProducto}`;
  if (!(await redis.exists(key))) {
    throw new Error(`El producto ${idProducto} no existe`);
  }
  // HINCRBY es atómico
  // Evita race conditions al descontar stock
  const unidades = await redis.hIncrBy(key, 'unidades', -Math.abs(cantidad));
  await redis.zAdd('stock:unidades', { score: unidades, value: idProducto }); // mantener índice
  return { id_producto: idProducto, unidades };
}
