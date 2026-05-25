/**
 * Dashboard Cache Service
 * Caches the warden dashboard summary in Redis for 30 seconds.
 * Dramatically reduces MongoDB load during rush hours when the dashboard
 * auto-refreshes every few seconds across multiple warden/guard sessions.
 *
 * Cache invalidation: on every gate scan via Socket.IO + explicit invalidation.
 */

const { getRedis } = require('./redisClient');
const logger = require('../utils/logger');

const CACHE_KEY = 'dashboard:summary';
const CACHE_TTL_SECONDS = 30;

// In-memory fallback when Redis is unavailable
let memCache = null;
let memCacheExpiry = 0;

const getDashboardCache = async () => {
  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      logger.warn('[DashboardCache] Redis get error', { error: err.message });
      return null;
    }
  }

  // In-memory fallback
  if (memCache && Date.now() < memCacheExpiry) return memCache;
  return null;
};

const setDashboardCache = async (data) => {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(CACHE_KEY, JSON.stringify(data), { EX: CACHE_TTL_SECONDS });
    } catch (err) {
      logger.warn('[DashboardCache] Redis set error', { error: err.message });
    }
    return;
  }

  // In-memory fallback
  memCache = data;
  memCacheExpiry = Date.now() + CACHE_TTL_SECONDS * 1000;
};

const invalidateDashboardCache = async () => {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(CACHE_KEY);
    } catch (err) {
      logger.warn('[DashboardCache] Redis del error', { error: err.message });
    }
    return;
  }
  memCache = null;
  memCacheExpiry = 0;
};

module.exports = { getDashboardCache, setDashboardCache, invalidateDashboardCache };
