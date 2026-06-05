import { MongoClient } from 'mongodb';
import { createClient } from 'redis';
import 'dotenv/config';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DB_NAME = process.env.DB_NAME || 'vetsalud';

let mongoClient;
let redisClient;
let db;

export async function connect() {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(DB_NAME);
    console.log('MongoDB conectado');
  }
  if (!redisClient) {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (e) => console.error('Redis error:', e.message));
    await redisClient.connect();
    console.log('Redis conectado');
  }
  return { db, redis: redisClient };
}

export async function close() {
  if (mongoClient) await mongoClient.close();
  if (redisClient) await redisClient.quit();
  mongoClient = redisClient = db = undefined;
}
