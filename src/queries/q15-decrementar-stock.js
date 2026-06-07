import { connect } from '../db.js';

// Returns: -1 producto no existe, -2 stock insuficiente, N>=0 unidades resultantes.
const STOCK_DECREMENT_LUA = `
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score then return -1 end
local cur = tonumber(score)
local req = tonumber(ARGV[2])
if cur < req then return -2 end
return tonumber(redis.call('ZINCRBY', KEYS[1], -req, ARGV[1]))
`;

/**
 * Consulta 15 - Decremento atomico de stock.
 *
 * Requisito de la consigna:
 * decrementar unidades de un producto despues de una consulta.
 *
 * Motor: Redis.
 * Clave: stock:unidades.
 * Endpoint: POST /api/decrementar-stock.
 */
export async function decrementarStock(idProducto, cantidad) {
  const { redis } = await connect();
  const req = Number(cantidad);

  if (!idProducto) throw new Error('Falta el id_producto');
  if (!Number.isInteger(req) || req <= 0) {
    throw new Error('La cantidad a decrementar debe ser un entero positivo');
  }

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
