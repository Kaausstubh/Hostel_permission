/**
 * Redis Client Service
 * Centralized Redis connection (with graceful fallback when unavailable).
 */

const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL || '';

let client = null;
let connectPromise = null;

const hasRedis = () => Boolean(REDIS_URL);

const getRedis = async () => {
  if (!hasRedis()) return null;

  if (client?.isOpen) return client;
  if (connectPromise) {
    await connectPromise;
    return client?.isOpen ? client : null;
  }

  client = createClient({ url: REDIS_URL, socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 2000) } });

  client.on('error', (err) => {
    console.error('Redis client error:', err.message);
  });

  connectPromise = client.connect()
    .then(() => {
      console.log('Redis connected');
    })
    .catch((err) => {
      console.error('Redis connection failed:', err.message);
      client = null;
    })
    .finally(() => {
      connectPromise = null;
    });

  await connectPromise;
  return client?.isOpen ? client : null;
};

module.exports = { getRedis, hasRedis };
