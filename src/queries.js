import { AsyncLocalStorage } from 'async_hooks';
import { connect } from './db.js';

export const cacheCtx = new AsyncLocalStorage();

async function cached(key, ttlSeconds, fn) {
  const { redis } = await connect();
  const hit = await redis.get(key);
  const ctx = cacheCtx.getStore();
  if (hit !== null) {
    const ttlRemaining = await redis.ttl(key);
    if (ctx) ctx.events.push({ status: 'HIT', key, ttl: ttlRemaining });
    return JSON.parse(hit);
  }
  if (ctx) ctx.events.push({ status: 'MISS', key, ttl: ttlSeconds });
  const value = await fn();
  await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
  return value;
}

async function invalidate(...keys) {
  if (!keys.length) return;
  const { redis } = await connect();
  await redis.del(keys);
}

export async function flushCache() {
  const { redis } = await connect();
  const keys = await redis.keys('cache:*');
  if (keys.length) await redis.del(keys);
  return { ok: true, eliminadas: keys.length };
}

// 1 - Pacientes activos con propietario
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

// 2 - Consultas en seguimiento
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

// 3 - Historial de paciente (consultas + vacunaciones unificados)
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

// 4 - Propietarios con más de un paciente
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

// 5 - Veterinarios activos con consultas en últimos 60 días (cacheado)
export async function veterinariosActivosConConsultas60d() {
  return cached('cache:vets-consultas-60d', 300, async () => {
    const { db } = await connect();
    const desde = new Date();
    desde.setDate(desde.getDate() - 60);
    return db
      .collection('veterinarios')
      .aggregate([
        { $match: { activo: true } },
        {
          $lookup: {
            from: 'consultas',
            let: { vetId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id_vet', '$$vetId'] },
                      { $gte: ['$fecha', desde] },
                    ],
                  },
                },
              },
            ],
            as: 'consultas_60d',
          },
        },
        {
          $project: {
            _id: 0,
            id_vet: '$_id',
            nombre: 1,
            apellido: 1,
            matricula: 1,
            especialidad: 1,
            sucursal: 1,
            activo: 1,
            cantidad_consultas_60d: { $size: '$consultas_60d' },
          },
        },
        { $sort: { cantidad_consultas_60d: -1, apellido: 1, nombre: 1 } },
      ])
      .toArray();
  });
}

// 6 - Pacientes con vacunas vencidas
export async function pacientesConVacunasVencidas() {
  const { db } = await connect();
  const hoy = new Date();
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

// 7 - Top 5 diagnósticos (cacheado)
export async function topDiagnosticos() {
  return cached('cache:top-diagnosticos', 300, async () => {
    const { db } = await connect();
    return db
      .collection('consultas')
      .aggregate([
        { $group: { _id: '$diagnostico', total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 5 },
      ])
      .toArray();
  });
}

// 8 - Stock bajo (Redis sorted set + Mongo master data)
export async function stockBajo(umbral = 50) {
  const { db, redis } = await connect();
  const entries = await redis.zRangeByScoreWithScores('stock:unidades', '-inf', umbral - 1);
  if (entries.length === 0) return [];
  const ids = entries.map((e) => e.value);
  const meta = await db.collection('productos').find({ _id: { $in: ids } }).toArray();
  const metaMap = new Map(meta.map((p) => [p._id, p]));
  return entries.map((e) => ({
    ...(metaMap.get(e.value) || { _id: e.value }),
    unidades: Number(e.score),
  }));
}

// 9 - Consultas tipo Control con costo bajo umbral
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

// 10 - Pacientes de una sucursal (vía consultas + vacunaciones)
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

// 11 - Ingresos por veterinario (mes actual, cacheado)
export async function ingresosPorVetMesActual() {
  return cached('cache:ingresos-vet-mes', 60, async () => {
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
  });
}

// 12 - Propietarios a revisar (3 categorías: baja / sin mascotas / sin consultas recientes)
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
      {
        $addFields: {
          cantidad_mascotas: { $size: '$pacientes' },
          cantidad_consultas_recientes: { $size: '$consultasRecientes' },
        },
      },
      {
        $match: {
          $or: [
            { activo: false },
            { cantidad_mascotas: 0 },
            { cantidad_consultas_recientes: 0 },
          ],
        },
      },
      {
        $addFields: {
          categoria: {
            $switch: {
              branches: [
                { case: { $eq: ['$activo', false] }, then: 'Dado de baja' },
                { case: { $eq: ['$cantidad_mascotas', 0] }, then: 'Sin mascotas' },
              ],
              default: 'Sin consultas en el último año',
            },
          },
          _orden_categoria: {
            $switch: {
              branches: [
                { case: { $eq: ['$activo', false] }, then: 1 },
                { case: { $eq: ['$cantidad_mascotas', 0] }, then: 2 },
              ],
              default: 3,
            },
          },
        },
      },
      {
        $project: {
          categoria: 1,
          activo: 1,
          nombre: 1, apellido: 1, email: 1, ciudad: 1, provincia: 1,
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

// 13 - ABM de propietarios (baja lógica)
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

// 14 - Alta de consulta (Mongo + Redis: valida activo, descuenta stock, invalida caché)
export async function altaConsulta(consulta) {
  const { db, redis } = await connect();
  const { id_paciente, id_vet, productos_usados } = consulta;

  const paciente = await db.collection('pacientes').findOne({ _id: id_paciente });
  if (!paciente) throw new Error(`El paciente ${id_paciente} no existe`);
  if (!paciente.activo) throw new Error(`El paciente ${id_paciente} está dado de baja`);

  const vet = await db.collection('veterinarios').findOne({ _id: id_vet });
  if (!vet) throw new Error(`El veterinario ${id_vet} no existe`);
  if (!vet.activo) throw new Error(`El veterinario ${id_vet} no está activo`);

  const consolidado = new Map();
  for (const p of (Array.isArray(productos_usados) ? productos_usados : [])) {
    if (!p?.id_producto) continue;
    const cant = Math.abs(Number(p.cantidad)) || 0;
    if (cant <= 0) continue;
    consolidado.set(p.id_producto, (consolidado.get(p.id_producto) || 0) + cant);
  }
  const productos = [...consolidado].map(([id_producto, cantidad]) => ({ id_producto, cantidad }));

  for (const p of productos) {
    const actual = await redis.zScore('stock:unidades', p.id_producto);
    if (actual === null) {
      throw new Error(`El producto ${p.id_producto} no existe`);
    }
    if (Number(actual) < p.cantidad) {
      throw new Error(`Stock insuficiente para ${p.id_producto}: ${actual} disponibles, ${p.cantidad} solicitadas`);
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

  await invalidate('cache:top-diagnosticos', 'cache:ingresos-vet-mes', 'cache:vets-consultas-60d');

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

// 15 - Decrementar stock (Redis, atómico vía Lua)
// Returns: -1 producto no existe, -2 stock insuficiente, N>=0 unidades resultantes
const STOCK_DECREMENT_LUA = `
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score then return -1 end
local cur = tonumber(score)
local req = tonumber(ARGV[2])
if cur < req then return -2 end
return tonumber(redis.call('ZINCRBY', KEYS[1], -req, ARGV[1]))
`;

export async function decrementarStock(idProducto, cantidad) {
  const { redis } = await connect();
  const req = Math.abs(Number(cantidad));
  const result = await redis.eval(STOCK_DECREMENT_LUA, {
    keys: ['stock:unidades'],
    arguments: [idProducto, String(req)],
  });
  const n = Number(result);
  if (n === -1) throw new Error(`El producto ${idProducto} no existe`);
  if (n === -2) {
    const actual = await redis.zScore('stock:unidades', idProducto);
    throw new Error(`Stock insuficiente para ${idProducto}: ${actual} disponibles, ${req} solicitadas`);
  }
  return { id_producto: idProducto, unidades: n };
}
