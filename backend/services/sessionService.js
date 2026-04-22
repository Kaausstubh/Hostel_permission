/**
 * Session Service
 * Redis-backed session state for WhatsApp chatbot.
 * Falls back to in-memory storage if REDIS_URL is not configured.
 */

const { getRedis } = require('./redisClient');

const fallbackSessions = new Map();
const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL_SECONDS || '600', 10);
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const sessionKey = (phone) => `session:${phone}`;

/**
 * Get an existing session or create a new one.
 * @param {string} phone - Normalized phone number (e.g., "+919876543210")
 */
const getSession = async (phone) => {
  const redis = await getRedis();
  if (redis) {
    const raw = await redis.get(sessionKey(phone));
    if (raw) return JSON.parse(raw);
    return createSession(phone);
  }

  if (fallbackSessions.has(phone)) {
    const session = fallbackSessions.get(phone);
    if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
      fallbackSessions.delete(phone);
      return createSession(phone);
    }
    return session;
  }
  return createSession(phone);
};

const createSession = async (phone) => {
  const session = { step: 'IDLE', data: {}, updatedAt: Date.now() };
  const redis = await getRedis();
  if (redis) {
    await redis.set(sessionKey(phone), JSON.stringify(session), { EX: SESSION_TTL_SECONDS });
    return session;
  }
  fallbackSessions.set(phone, session);
  return session;
};

/**
 * Update a session's step and/or data.
 * @param {string} phone
 * @param {string} step - New state key
 * @param {object} data - Partial data to merge
 */
const updateSession = async (phone, step, data = {}) => {
  const session = await getSession(phone);
  session.step = step;
  session.data = { ...session.data, ...data };
  session.updatedAt = Date.now();
  const redis = await getRedis();
  if (redis) {
    await redis.set(sessionKey(phone), JSON.stringify(session), { EX: SESSION_TTL_SECONDS });
    return session;
  }
  fallbackSessions.set(phone, session);
  return session;
};

/**
 * Clear/reset a session.
 * @param {string} phone
 */
const clearSession = async (phone) => {
  const redis = await getRedis();
  if (redis) {
    await redis.del(sessionKey(phone));
    return;
  }
  fallbackSessions.delete(phone);
};

module.exports = { getSession, updateSession, clearSession };
