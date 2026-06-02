import { connect } from './db.js';

// Las atenciones médicas estan en una sola colección 'consultas'
// con un campo 'tipo':
//   - 'Consulta', atención clínica general/controles
//   - 'Cirugia'
// Las vacunaciones quedan en su propia colección porque su estructura
// difiere (sin costo, con proxima_dosis).

// ---------------------------------------------------------------------
// Caché (cache-aside con TTL sobre Redis)
//   - cached(key, ttl, fn): intenta leer la key; si no está, ejecuta fn,
//     guarda el resultado serializado en Redis y lo devuelve.
//   - invalidate(...keys): borra una o más keys de caché. Se llama desde
//     las operaciones de escritura cuando los datos cacheados quedan
//     obsoletos.
// Las keys de caché empiezan con 'cache:' para no chocar con 'stock:*'.
// ---------------------------------------------------------------------
async function cached(key, ttlSeconds, fn) {
  const { redis } = await connect();
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit);
  const value = await fn();
  await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
  return value;
}

async function invalidate(...keys) {
  if (!keys.length) return;
  const { redis } = await connect();
  await redis.del(keys);
}

// Útil para inspección y para un endpoint admin de "limpiar caché".
export async function flushCache() {
  const { redis } = await connect();
  const keys = await redis.keys('cache:*');
  if (keys.length) await redis.del(keys);
  return { ok: true, eliminadas: keys.length };
}

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

// 2 - Consultas en seguimiento con veterinario asignado y costo (Mongo)
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

// 3 - Historial completo de un paciente: consultas + vacunaciones (Mongo)
// Se devuelve ordenado por fecha descendente para ver lo más reciente primero.
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

// 4 - Propietarios con más de un paciente registrado (Mongo)
export async function propietariosConMultiplesPacientes() {
  const { db } = await connect();
  return db
    .collection('pacientes')
    .aggregate([
      { $group: { _id: '$id_propietario', cantidad_pacientes: { $sum: 1 } } },
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
        },
      },
      { $sort: { cantidad_pacientes: -1, id_propietario: 1 } },
    ])
    .toArray();
}

// 5 - Veterinarios activos y cantidad de consultas en los últimos 60 días (Mongo, cacheado)
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

// 6 - Pacientes con vacunas vencidas (Mongo)
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
        $lookup: {
          from: 'propietarios',
          localField: 'paciente.id_propietario',
          foreignField: '_id',
          as: 'propietario',
        },
      },
      { $unwind: '$propietario' },
      {
        $project: {
          _id: 0,
          id_paciente: '$_id',
          cantidad_vacunas_vencidas: 1,
          proxima_dosis_mas_antigua: 1,
          paciente: {
            _id: '$paciente._id',
            nombre: '$paciente.nombre',
            especie: '$paciente.especie',
            raza: '$paciente.raza',
            activo: '$paciente.activo',
          },
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
          vacunas_vencidas: 1,
        },
      },
      { $sort: { proxima_dosis_mas_antigua: 1, id_paciente: 1 } },
    ])
    .toArray();
}

// 7 - Top 5 diagnósticos más frecuentes (Mongo, cacheado)
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

// 8 - Stock bajo (Redis + Mongo) - patrón políglota explícito
// Redis: índice ordenado por unidades -> trae los IDs con stock < umbral.
// Mongo: master data de los productos (nombre, proveedor, vencimiento, etc).
// Combinamos ambas fuentes para devolver el resultado completo.
export async function stockBajo(umbral = 50) {
  const { db, redis } = await connect();
  // 1. Redis: IDs ordenados por unidades ascendente, con sus scores
  const entries = await redis.zRangeByScoreWithScores('stock:unidades', '-inf', umbral - 1);
  if (entries.length === 0) return [];
  // 2. Mongo: metadata para esos IDs (una sola query, $in)
  const ids = entries.map((e) => e.value);
  const meta = await db.collection('productos').find({ _id: { $in: ids } }).toArray();
  const metaMap = new Map(meta.map((p) => [p._id, p]));
  // 3. Combinar manteniendo el orden por unidades
  return entries.map((e) => ({
    ...(metaMap.get(e.value) || { _id: e.value }),
    unidades: Number(e.score),
  }));
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

// 11 - Ingresos totales por veterinario en el mes actual (Mongo, cacheado)
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

  // Consolidar las filas repetidas
  const consolidado = new Map();
  for (const p of (Array.isArray(productos_usados) ? productos_usados : [])) {
    if (!p?.id_producto) continue;
    const cant = Math.abs(Number(p.cantidad)) || 0;
    if (cant <= 0) continue;
    consolidado.set(p.id_producto, (consolidado.get(p.id_producto) || 0) + cant);
  }
  const productos = [...consolidado].map(([id_producto, cantidad]) => ({ id_producto, cantidad }));

  // Pre-validación del stock contra Redis (Sorted Set 'stock:unidades').
  // ZSCORE devuelve null si el producto no está en el set (no existe).
  // Esto es best-effort: el decremento real (vía Lua en Q15) hace su propia
  // validación atómica, pero pre-validar nos permite fallar antes de insertar
  // la consulta en Mongo.
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

  // Invalidar cachés que dependen de la colección consultas:
  //  - Q7 (top diagnósticos): cambia si suma un diagnóstico
  //  - Q11 (ingresos mes actual): cambia si la nueva consulta es del mes en curso (siempre lo es)
  //  - Q5 (vets con consultas en 60d): cambia siempre que se agregue una consulta reciente
  await invalidate('cache:top-diagnosticos', 'cache:ingresos-vet-mes', 'cache:vets-consultas-60d');

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

// 15 - Decrementar unidades de un producto (Redis, atómico via Lua)
// Usamos un Lua script para que la verificación de existencia, la verificación
// de stock suficiente y el ZINCRBY ocurran como una sola operación atómica.
// Sin Lua tendríamos una ventana entre ZSCORE y ZINCRBY donde otro decremento
// podría dejar el stock en negativo.
// Retornos del script:
//   -1  el producto no existe en el sorted set
//   -2  stock insuficiente
//   N>=0  unidades resultantes después del decremento
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
