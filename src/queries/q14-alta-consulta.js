import { connect } from '../db.js';
import { invalidate } from './cache.js';
import { decrementarStock } from './q15-decrementar-stock.js';

function consolidarProductosUsados(productosUsados) {
  if (productosUsados === undefined || productosUsados === null) return [];
  if (!Array.isArray(productosUsados)) {
    throw new Error('productos_usados debe ser un arreglo');
  }

  const consolidado = new Map();
  for (const p of productosUsados) {
    if (!p?.id_producto) throw new Error('Cada producto usado debe indicar id_producto');

    const cantidad = Number(p.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw new Error(`La cantidad usada de ${p.id_producto} debe ser un entero positivo`);
    }

    consolidado.set(p.id_producto, (consolidado.get(p.id_producto) || 0) + cantidad);
  }

  return [...consolidado].map(([id_producto, cantidad]) => ({ id_producto, cantidad }));
}

/**
 * Consulta 14 - Alta de consulta medica.
 *
 * Requisito de la consigna:
 * registrar una nueva consulta validando que paciente y veterinario existan.
 *
 * Motor: MongoDB, con integracion opcional con Redis para stock.
 * Colecciones: pacientes, veterinarios, consultas.
 * Clave Redis: stock:unidades cuando se informan productos_usados.
 * Endpoint: POST /api/consultas.
 */
export async function altaConsulta(consulta) {
  const { db, redis } = await connect();
  const { id_paciente, id_vet, productos_usados } = consulta;

  const paciente = await db.collection('pacientes').findOne({ _id: id_paciente });
  if (!paciente) throw new Error(`El paciente ${id_paciente} no existe`);
  if (!paciente.activo) throw new Error(`El paciente ${id_paciente} está dado de baja`);

  const vet = await db.collection('veterinarios').findOne({ _id: id_vet });
  if (!vet) throw new Error(`El veterinario ${id_vet} no existe`);
  if (!vet.activo) throw new Error(`El veterinario ${id_vet} no está activo`);

  const productos = consolidarProductosUsados(productos_usados);

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
    stockResultado.push(await decrementarStock(p.id_producto, p.cantidad));
  }

  return {
    ok: true,
    consulta: doc,
    ...(stockResultado.length ? { stock: stockResultado } : {}),
  };
}
