import { connect } from '../db.js';
import { cached } from './cache.js';

export const INGRESOS_VET_MES_VIEW = 'vista_ingresos_vet_mes';

export const INGRESOS_VET_MES_PIPELINE = [
  {
    $match: {
      $expr: {
        $and: [
          {
            $gte: [
              '$fecha',
              { $dateTrunc: { date: '$$NOW', unit: 'month' } },
            ],
          },
          {
            $lt: [
              '$fecha',
              {
                $dateAdd: {
                  startDate: { $dateTrunc: { date: '$$NOW', unit: 'month' } },
                  unit: 'month',
                  amount: 1,
                },
              },
            ],
          },
        ],
      },
    },
  },
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
      _id: 0,
      id_vet: '$_id',
      veterinario: { $concat: ['$vet.nombre', ' ', '$vet.apellido'] },
      sucursal: '$vet.sucursal',
      ingresos: 1,
      cantidad: 1,
    },
  },
  { $sort: { ingresos: -1 } },
];

export async function crearVistaIngresosVetMes(db) {
  await db.createCollection(INGRESOS_VET_MES_VIEW, {
    viewOn: 'consultas',
    pipeline: INGRESOS_VET_MES_PIPELINE,
  });
}

export async function recrearVistaIngresosVetMes(db) {
  try {
    await db.collection(INGRESOS_VET_MES_VIEW).drop();
  } catch (e) {
    if (e.codeName !== 'NamespaceNotFound' && e.code !== 26) throw e;
  }
  await crearVistaIngresosVetMes(db);
}

async function asegurarVistaIngresosVetMes(db) {
  const existente = await db.listCollections({ name: INGRESOS_VET_MES_VIEW }).next();
  if (!existente) await crearVistaIngresosVetMes(db);
}

/**
 * Consulta 11 - Ingresos totales por veterinario en el mes actual.
 *
 * Requisito de la consigna:
 * obtener una vista agregada de ingresos totales por veterinario en el mes
 * actual.
 *
 * Motor: MongoDB, con cache en Redis.
 * Colecciones: consultas, veterinarios.
 * Endpoint: GET /api/ingresos-vet-mes.
 */
export async function ingresosPorVetMesActual() {
  const { db } = await connect();
  await asegurarVistaIngresosVetMes(db);
  return cached('cache:ingresos-vet-mes', 60, async () => {
    return db.collection(INGRESOS_VET_MES_VIEW).find({}).toArray();
  });
}
