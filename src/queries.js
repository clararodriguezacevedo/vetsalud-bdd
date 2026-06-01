import { connect } from './db.js';

// Las atenciones médicas estan en una sola colección 'consultas'
// con un campo 'tipo':
//   - 'Consulta', atención clínica general/controles
//   - 'Cirugia'
// Las vacunaciones quedan en su propia colección porque su estructura
// difiere (sin costo, con proxima_dosis).

// 1 - Pacientes activos con todos sus datos de propietario (Mongo)
// Incluye el estado (activo / baja lógica) del propietario.
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

// 9 - Consultas tipo 'Control' con costo menor a $5.000 (Mongo)
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

// 10 - Pacientes de una sucursal, a través del veterinario (Mongo)
// Considera tanto consultas como vacunaciones: un paciente está
// asociado a una sucursal si algún vet de esa sucursal lo atendió
// (clínicamente o aplicándole una vacuna).
export async function pacientesPorSucursal(sucursal) {
  const { db } = await connect();
  return db
    .collection('veterinarios')
    .aggregate([
      { $match: { sucursal } },
      // Consultas de cada vet
      {
        $lookup: {
          from: 'consultas',
          localField: '_id',
          foreignField: 'id_vet',
          as: 'consultas',
        },
      },
      // Vacunaciones aplicadas por cada vet
      {
        $lookup: {
          from: 'vacunaciones',
          localField: '_id',
          foreignField: 'id_vet',
          as: 'vacunaciones',
        },
      },
      // Unimos sin duplicar
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
// Considera solo propietarios activos (los dados de baja ya no son clientes).
// Incluye 'cantidad_mascotas' en el resultado para distinguir entre
// propietarios sin pacientes y propietarios cuyos pacientes simplemente
// no fueron atendidos en el período.
export async function propietariosSinConsultasUltimoAnio() {
  const { db } = await connect();
  const haceUnAnio = new Date();
  haceUnAnio.setFullYear(haceUnAnio.getFullYear() - 1);
  return db
    .collection('propietarios')
    .aggregate([
      { $match: { activo: true } },
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
      {
        $project: {
          nombre: 1, apellido: 1, email: 1, ciudad: 1, provincia: 1,
          cantidad_mascotas: { $size: '$pacientes' },
        },
      },
      { $sort: { cantidad_mascotas: -1, _id: 1 } },
    ])
    .toArray();
}

// 13 - ABM de propietarios, baja lógica (Mongo)  
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

// 14 - Alta de consulta Mongo + Redis
// Valida que paciente y veterinario existan y estén activos.
// Opcionalmente acepta 'productos_usados': [{id_producto, cantidad}, ...]
// y descuenta el stock correspondiente en Redis (consulta 15).
// La pre-validación de stock se hace antes de insertar para minimizar
// la chance de quedar con una consulta huérfana si el stock no alcanza.
export async function altaConsulta(consulta) {
  const { db, redis } = await connect();
  const { id_paciente, id_vet, productos_usados } = consulta;

  // Validaciones contra Mongo
  const paciente = await db.collection('pacientes').findOne({ _id: id_paciente });
  if (!paciente) throw new Error(`El paciente ${id_paciente} no existe`);
  if (!paciente.activo) throw new Error(`El paciente ${id_paciente} está dado de baja`);

  const vet = await db.collection('veterinarios').findOne({ _id: id_vet });
  if (!vet) throw new Error(`El veterinario ${id_vet} no existe`);
  if (!vet.activo) throw new Error(`El veterinario ${id_vet} no está activo`);

  // Validación del stock en Redis
  const productos = Array.isArray(productos_usados) ? productos_usados : [];
  for (const p of productos) {
    const key = `producto:${p.id_producto}`;
    if (!(await redis.exists(key))) {
      throw new Error(`El producto ${p.id_producto} no existe`);
    }
    const actual = Number(await redis.hGet(key, 'unidades'));
    const requerido = Math.abs(Number(p.cantidad));
    if (actual < requerido) {
      throw new Error(`Stock insuficiente para ${p.id_producto}: ${actual} disponibles, ${requerido} solicitadas`);
    }
  }

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
    tipo: consulta.tipo || 'Consulta',
    motivo: consulta.motivo || '',
    diagnostico: consulta.diagnostico || '',
    costo: Number(consulta.costo) || 0,
    estado: consulta.estado || 'Cerrada',
  };
  await db.collection('consultas').insertOne(doc);

  // Decremento de stock 
  const stockResultado = [];
  for (const p of productos) {
    stockResultado.push(await decrementarStock(p.id_producto, Number(p.cantidad)));
  }

  return {
    ok: true,
    consulta: doc,
    ...(stockResultado.length ? { stock: stockResultado } : {}),
  };
}

// 15 - Decrementar unidades de un producto tras una consulta (Redis)
// Verifica que el stock actual sea suficiente, si no, lanza error
export async function decrementarStock(idProducto, cantidad) {
  const { redis } = await connect();
  const key = `producto:${idProducto}`;
  if (!(await redis.exists(key))) {
    throw new Error(`El producto ${idProducto} no existe`);
  }
  const cant = Math.abs(Number(cantidad));
  const actual = Number(await redis.hGet(key, 'unidades'));
  if (actual < cant) {
    throw new Error(`Stock insuficiente para ${idProducto}: ${actual} disponibles, ${cant} solicitadas`);
  }
  // HINCRBY es atómico: evita condiciones de carrera al descontar stock
  const unidades = await redis.hIncrBy(key, 'unidades', -cant);
  await redis.zAdd('stock:unidades', { score: unidades, value: idProducto }); // mantener índice
  return { id_producto: idProducto, unidades };
}
