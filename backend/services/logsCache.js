/**
 * Fast Logs Cache Service
 * Accelerates Gate Entry Logs and Home Visit Logs with sub-millisecond in-memory / Redis caching.
 * Auto-invalidates immediately whenever any scan, status change, or deletion occurs.
 */
const { getRedis } = require('./redisClient');
const logger = require('../utils/logger');

const CACHE_TTL_SECONDS = 20; // 20s TTL ensures instant snappy loads while keeping data fresh

// In-memory Map fallback
const memCache = new Map();

const getLogsCache = async (key) => {
  try {
    const redis = await getRedis();
    if (redis) {
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
    }
  } catch (err) {}

  const entry = memCache.get(key);
  if (entry) {
    if (Date.now() < entry.expiry) {
      return entry.data;
    }
    memCache.delete(key);
  }
  return null;
};

const setLogsCache = async (key, data, ttlSeconds = CACHE_TTL_SECONDS) => {
  try {
    const redis = await getRedis();
    if (redis) {
      await redis.set(key, JSON.stringify(data), { EX: ttlSeconds });
      return;
    }
  } catch (err) {}

  // Keep memory footprint small
  if (memCache.size > 300) {
    const oldestKey = memCache.keys().next().value;
    memCache.delete(oldestKey);
  }

  memCache.set(key, {
    data,
    expiry: Date.now() + ttlSeconds * 1000,
  });
};

const invalidateLogsCache = async () => {
  try {
    memCache.clear();
    const redis = await getRedis();
    if (redis) {
      const keys = await redis.keys('logs:*');
      if (keys && keys.length > 0) {
        await redis.del(keys);
      }
    }
  } catch (err) {
    logger.warn('[LogsCache] Invalidate error', { error: err.message });
  }
};

module.exports = {
  getLogsCache,
  setLogsCache,
  invalidateLogsCache,
};
