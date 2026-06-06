import { AsyncLocalStorage } from 'async_hooks';
import { connect } from '../db.js';

export const cacheCtx = new AsyncLocalStorage();

export async function cached(key, ttlSeconds, fn) {
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

export async function invalidate(...keys) {
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
