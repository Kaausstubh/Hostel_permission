/**
 * Centralized Rate Limiters
 * All express-rate-limit instances in one place.
 *
 * Strategy:
 *  - Global API limiter: generous (3000/15min) — covers bulk API use
 *  - Auth limiter: strict (10/15min per email) — prevents brute force
 *  - Scan limiter: moderate (120/min per IP) — allows burst scanning
 *  - Register limiter: very strict (5/hour) — prevents fake account spam
 */

const rateLimit = require('express-rate-limit');
const { getRedis } = require('../services/redisClient');

/** IPv6-safe IP key generator for express-rate-limit */
const ipKeyGenerator = (req) => {
  // Uses req.ip which express normalizes from ::ffff:x.x.x.x to x.x.x.x
  return req.ip?.replace(/^::ffff:/, '') || 'unknown';
};

/** Create a key generator that falls back to ipKeyGenerator when no specific key */
const makeKeyGenerator = (keyFn) => (req) => {
  try {
    const key = keyFn(req);
    // If key doesn't embed req.ip, use ipKeyGenerator for the fallback
    return key;
  } catch {
    return ipKeyGenerator(req);
  }
};

// ── Global API Rate Limiter ──────────────────────────────────────────────────
// Applied to all /api/* routes — broad protection against API abuse
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`, 10),
  max:      parseInt(process.env.API_RATE_LIMIT_MAX || '3000', 10),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }, // Render uses a reverse proxy
  message: { success: false, message: 'Too many requests — please try again later.' },
  skip: (req) => req.path === '/api/health', // Never rate-limit health check
});

// ── Login Brute-Force Protection ─────────────────────────────────────────────
// Keyed on email address (cross-IP account protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per 15 min per email
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body?.email || '').toLowerCase().trim();
    // Key on email address for cross-IP brute force protection
    // Use plain string key — does NOT use req.ip, so IPv6 helper not needed
    return email ? `login:${email}` : ipKeyGenerator(req);
  },
  validate: { xForwardedForHeader: false }, // trust Express's req.ip parsing
  message: {
    success: false,
    message: 'Too many login attempts from this account. Try again in 15 minutes.',
  },
  skipSuccessfulRequests: true, // Only count failed attempts
});

// ── QR Scan Rate Limiter ──────────────────────────────────────────────────────
// Per-IP: allows burst scanning at a gate (one guard, many QRs)
// 120 scans/min = 2/sec sustained — more than enough for any gate
const scanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Key on authenticated user ID when available — does NOT use req.ip
    return req.user?._id ? `scan:${req.user._id}` : ipKeyGenerator(req);
  },
  validate: { xForwardedForHeader: false },
  message: {
    success: false,
    message: 'Scan rate limit exceeded — slow down, you\'re scanning too fast.',
  },
});

// ── Registration Rate Limiter ─────────────────────────────────────────────────
// 5 registrations per hour per IP — prevents fake account creation floods
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many registration attempts. Try again in an hour.',
  },
});

// ── API Key / Webhook Limiter (for WhatsApp) ──────────────────────────────────
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300, // Twilio can burst, but not beyond 300/min
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Webhook rate limit exceeded.' },
});

module.exports = {
  apiLimiter,
  loginLimiter,
  scanLimiter,
  registerLimiter,
  webhookLimiter,
};
