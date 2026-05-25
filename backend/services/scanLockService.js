/**
 * Short-lived per-token lock so the same QR cannot be processed twice concurrently.
 */
const { getRedis } = require('./redisClient');

const LOCK_PREFIX = 'gatescan:lock:';
const LOCK_TTL_SECONDS = 3;
const SLOW_LOCK_WARN_MS = 2000;
const fallbackLocks = new Map();

const lockKeyFor = (token) => `${LOCK_PREFIX}${String(token).slice(0, 200)}`;

const withScanLock = async (token, fn) => {
  const lockKey = lockKeyFor(token);
  const redis = await getRedis();

  if (redis) {
    const acquired = await redis.set(lockKey, '1', { NX: true, EX: LOCK_TTL_SECONDS });
    if (!acquired) {
      const err = new Error('This QR is already being processed — hold on');
      err.statusCode = 409;
      throw err;
    }
    const lockStart = Date.now();
    try {
      return await fn();
    } finally {
      const held = Date.now() - lockStart;
      if (held > SLOW_LOCK_WARN_MS) {
        console.warn(`[ScanLock] Slow scan detected — lock held for ${held}ms on key ${lockKey.slice(-20)}`);
      }
      await redis.del(lockKey);
    }
  }

  if (fallbackLocks.has(lockKey)) {
    const err = new Error('This QR is already being processed — hold on');
    err.statusCode = 409;
    throw err;
  }

  const lockStart = Date.now();
  fallbackLocks.set(lockKey, lockStart);
  try {
    return await fn();
  } finally {
    const held = Date.now() - lockStart;
    if (held > SLOW_LOCK_WARN_MS) {
      console.warn(`[ScanLock] Slow scan detected — lock held for ${held}ms (in-memory fallback)`);
    }
    fallbackLocks.delete(lockKey);
  }
};

module.exports = { withScanLock };
