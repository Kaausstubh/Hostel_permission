/**
 * Authentication Middleware
 *
 * protect      — Verifies the short-lived JWT issued after Google OAuth callback.
 *                Attaches the full user object to req.user.
 *                Uses Redis (or in-memory fallback) session cache to avoid a
 *                DB hit on every request (~0.5ms cached vs ~20ms uncached).
 *
 * authorize    — Role-based access guard factory. Use after protect:
 *                  router.get('/admin', protect, authorize('warden'), handler)
 *
 * invalidateUserCache — Removes a user's cached session (called on logout).
 *
 * ⚡ PERFORMANCE: Redis session cache reduces per-request DB lookup from
 *    ~20ms (MongoDB) to ~0.5ms (Redis). Cache TTL is 5 minutes.
 */

const jwt    = require('jsonwebtoken');
const User   = require('../models/User');
const { getRedis } = require('../services/redisClient');
const logger = require('../utils/logger');

// ── Session Cache ─────────────────────────────────────────────────────────────
const SESSION_TTL_SECONDS = 300; // 5 minutes
const SESSION_PREFIX = 'session:uid:';

// In-memory LRU fallback when Redis is unavailable (max 500 entries, 5min TTL)
const memCache = new Map();
const MEM_CACHE_MAX = 500;
const MEM_CACHE_TTL_MS = SESSION_TTL_SECONDS * 1000;

const memGet = (key) => {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memCache.delete(key); return null; }
  return entry.value;
};

const memSet = (key, value) => {
  if (memCache.size >= MEM_CACHE_MAX) {
    const firstKey = memCache.keys().next().value;
    memCache.delete(firstKey);
  }
  memCache.set(key, { value, expiresAt: Date.now() + MEM_CACHE_TTL_MS });
};

const memDel = (key) => memCache.delete(key);

// ── Cache Operations ───────────────────────────────────────────────────────────
const getCachedUser = async (userId) => {
  const cacheKey = `${SESSION_PREFIX}${userId}`;
  try {
    const redis = await getRedis();
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
      return null;
    }
  } catch {
    // Redis error — fall through to in-memory
  }
  return memGet(cacheKey);
};

const setCachedUser = async (userId, userObj) => {
  const cacheKey = `${SESSION_PREFIX}${userId}`;
  const serialized = JSON.stringify(userObj);
  try {
    const redis = await getRedis();
    if (redis) {
      await redis.set(cacheKey, serialized, { EX: SESSION_TTL_SECONDS });
      return;
    }
  } catch {
    // Redis error — fall through to in-memory
  }
  memSet(cacheKey, userObj);
};

const invalidateUserCache = async (userId) => {
  const cacheKey = `${SESSION_PREFIX}${userId}`;
  try {
    const redis = await getRedis();
    if (redis) { await redis.del(cacheKey); return; }
  } catch {}
  memDel(cacheKey);
};

// ── protect middleware ─────────────────────────────────────────────────────────
// Verifies the short-lived JWT issued by the Google OAuth callback.
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    // ⚡ Try cache first — skip DB entirely on hit (~0.5ms vs ~20ms)
    let user = await getCachedUser(userId);

    if (!user) {
      // Cache miss — fetch from DB and populate cache
      user = await User.findById(userId).lean();
      if (!user) {
        return res.status(401).json({ success: false, message: 'User not found' });
      }
      // Store in cache (fire-and-forget — don't await to block the request)
      setCachedUser(userId, user).catch(() => {});
    }

    // Check if account is still active
    if (user.isActive === false) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired — please sign in again' });
    }
    return res.status(401).json({ success: false, message: 'Invalid session token — please sign in again' });
  }
};

// ── authorize factory ─────────────────────────────────────────────────────────
// Role-based access control. Always use after protect.
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      logger.warn('[Auth] Unauthorized role access attempt', {
        userId: req.user._id,
        role: req.user.role,
        required: roles,
        path: req.originalUrl,
        requestId: req.requestId,
      });
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized for this route`,
      });
    }
    next();
  };
};

module.exports = { protect, authorize, invalidateUserCache, setCachedUser };
