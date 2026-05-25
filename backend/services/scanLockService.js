/**
 * Distributed Scan Lock Service — Redis-first with process-level fallback
 *
 * Uses a Lua-script-based atomic SET NX to guarantee exactly-once lock
 * acquisition across multiple backend instances (horizontal scaling).
 *
 * Lock key structure:  gatescan:lock:<sha256(token, 40 chars)>
 * TTL:                 LOCK_TTL_SECONDS (default 3s)
 * Retry:               3 attempts, 50ms apart
 *
 * In production with Redis:
 *   - Multiple instances cannot double-process the same QR scan
 *   - Lock is released immediately after scan completes
 *   - TTL ensures lock is always released even if process crashes
 *
 * Without Redis (dev only):
 *   - Falls back to in-memory Map — single-instance only
 *   - Prints a startup warning
 */

const crypto = require('crypto');
const { getRedis, hasRedis } = require('./redisClient');
const logger = require('../utils/logger');

const LOCK_PREFIX = 'gatescan:lock:';
const LOCK_TTL_SECONDS = parseInt(process.env.SCAN_LOCK_TTL_SECONDS || '3', 10);
const SLOW_LOCK_WARN_MS = 2000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 50;

const fallbackLocks = new Map();

/**
 * Derive a short, fixed-length key from an arbitrary token string.
 * Prevents Redis key bloat from long JWT strings.
 */
const lockKeyFor = (token) => {
  const hash = crypto
    .createHash('sha256')
    .update(String(token))
    .digest('hex')
    .slice(0, 40);
  return `${LOCK_PREFIX}${hash}`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lua script for atomic lock acquisition:
 *   SET key value NX EX ttl
 * Returns 1 on success, 0 if already locked.
 */
const ACQUIRE_LOCK_LUA = `
  local key = KEYS[1]
  local value = ARGV[1]
  local ttl = tonumber(ARGV[2])
  if redis.call("SET", key, value, "NX", "EX", ttl) then
    return 1
  end
  return 0
`;

/**
 * Lua script for safe lock release:
 * Only deletes the lock if the value matches (prevents releasing someone else's lock).
 */
const RELEASE_LOCK_LUA = `
  local key = KEYS[1]
  local value = ARGV[1]
  if redis.call("GET", key) == value then
    redis.call("DEL", key)
    return 1
  end
  return 0
`;

/**
 * Attempt to acquire a Redis distributed lock.
 * @returns {string|null} lock value (GUID) on success, null on failure
 */
const acquireRedisLock = async (redis, lockKey) => {
  const lockValue = crypto.randomUUID();
  for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
    const acquired = await redis.eval(
      ACQUIRE_LOCK_LUA,
      { keys: [lockKey], arguments: [lockValue, String(LOCK_TTL_SECONDS)] }
    );
    if (acquired === 1) return lockValue;
    if (i < MAX_RETRY_ATTEMPTS - 1) await sleep(RETRY_DELAY_MS);
  }
  return null;
};

/**
 * Release a Redis distributed lock safely.
 */
const releaseRedisLock = async (redis, lockKey, lockValue) => {
  try {
    await redis.eval(RELEASE_LOCK_LUA, { keys: [lockKey], arguments: [lockValue] });
  } catch (err) {
    logger.warn('[ScanLock] Failed to release Redis lock', { lockKey, error: err.message });
  }
};

/**
 * Execute fn() while holding the distributed lock for the given token.
 * Throws 409 if lock cannot be acquired (scan already in progress).
 */
const withScanLock = async (token, fn) => {
  const lockKey = lockKeyFor(token);
  const redis = await getRedis();

  // ── Redis distributed lock (production path) ─────────────────────────────
  if (redis) {
    const lockValue = await acquireRedisLock(redis, lockKey);
    if (!lockValue) {
      const err = new Error('This QR is already being processed — please wait and retry');
      err.statusCode = 409;
      throw err;
    }

    const lockStart = Date.now();
    try {
      return await fn();
    } finally {
      const held = Date.now() - lockStart;
      if (held > SLOW_LOCK_WARN_MS) {
        logger.warn('[ScanLock] Slow scan detected', { held_ms: held, key_suffix: lockKey.slice(-12) });
      }
      await releaseRedisLock(redis, lockKey, lockValue);
    }
  }

  // ── In-memory fallback (development / single-instance only) ──────────────
  if (process.env.NODE_ENV === 'production') {
    // In production without Redis, reject rather than risk double-processing
    const err = new Error('Scan lock service unavailable — Redis is required in production');
    err.statusCode = 503;
    throw err;
  }

  if (fallbackLocks.has(lockKey)) {
    const err = new Error('This QR is already being processed — please wait and retry');
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
      logger.warn('[ScanLock] Slow scan detected (in-memory fallback)', { held_ms: held });
    }
    fallbackLocks.delete(lockKey);
    // Auto-evict stale locks from memory (cleanup)
    if (fallbackLocks.size > 1000) {
      const now = Date.now();
      for (const [k, start] of fallbackLocks.entries()) {
        if (now - start > LOCK_TTL_SECONDS * 1000 * 2) fallbackLocks.delete(k);
      }
    }
  }
};

if (!hasRedis() && process.env.NODE_ENV === 'production') {
  logger.error('[ScanLock] ❌ REDIS_URL not set — distributed scan locking DISABLED. This is unsafe in production!');
}

module.exports = { withScanLock };
