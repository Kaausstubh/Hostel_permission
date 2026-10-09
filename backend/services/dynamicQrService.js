/**
 * Dynamic QR Service — Anti-QR-Sharing & Anti-Replay Security System
 *
 * Provides:
 * 1. Short-lived (configurable, default 20s) cryptographically signed tokens (JWT HS256).
 * 2. Automatic refresh helper for active gate passes.
 * 3. Server-side validation with zero trust in client claims.
 * 4. Atomic Redis-first single-use consumption (anti-replay) with idempotency caching.
 * 5. Process-level fallback to ensure replay protection is NEVER silently bypassed.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getRedis, hasRedis } = require('./redisClient');
const { renderQRValue } = require('./qrService');
const logger = require('../utils/logger');

// ── Configuration ─────────────────────────────────────────────────────────────
const QR_DYNAMIC_EXPIRY_SECONDS = parseInt(
  process.env.QR_DYNAMIC_EXPIRY_SECONDS || '20',
  10
);
const QR_DYNAMIC_REFRESH_INTERVAL_SECONDS = parseInt(
  process.env.QR_DYNAMIC_REFRESH_INTERVAL_SECONDS || '15',
  10
);

// Fallback in-memory replay cache (when Redis is temporarily unreachable in dev/test)
const fallbackUsedTokens = new Map(); // jti -> timestamp
const fallbackIdempotentResults = new Map(); // jti -> { body, expiresAt }
const REPLAY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Clean up stale in-memory items periodically
setInterval(() => {
  const now = Date.now();
  for (const [jti, ts] of fallbackUsedTokens.entries()) {
    if (now - ts > REPLAY_CACHE_TTL_MS) fallbackUsedTokens.delete(jti);
  }
  for (const [jti, entry] of fallbackIdempotentResults.entries()) {
    if (now > entry.expiresAt) fallbackIdempotentResults.delete(jti);
  }
}, 60000).unref();

const getQrSecret = () => {
  return process.env.QR_SECRET || '__DEV_ONLY_FALLBACK_QR_SECRET_DO_NOT_USE_IN_PROD__';
};

/**
 * Issue a cryptographically secure, short-lived server-verifiable token for an active gate pass.
 *
 * @param {Object} student - User document or lean object
 * @param {Object} passInfo - { passKind, passId, masterToken, scanType, place, reason }
 * @param {Object} options - Override defaults (e.g. expiresInSeconds for testing)
 */
const issueDynamicPassToken = async (student, passInfo, options = {}) => {
  if (!student || !student._id) {
    throw new Error('Valid student object is required to issue dynamic QR token');
  }

  const sId = student._id.toString();
  const jti = crypto.randomUUID();
  const secret = getQrSecret();
  const expirySec = options.expiresInSeconds || QR_DYNAMIC_EXPIRY_SECONDS;
  const nowSec = Math.floor(Date.now() / 1000);

  const payload = {
    sub: sId,
    student_id: sId,
    name: student.name || '',
    rollNo: student.rollNo || '',
    hostel: student.hostel || 'N/A',
    pass_kind: passInfo.passKind || 'inout',
    pass_id: String(passInfo.passId || passInfo.pass?._id || passInfo.homeVisit?._id || ''),
    master_token: passInfo.masterToken || passInfo.token || '',
    scan_type: passInfo.scanType || 'OUT',
    jti,
    type: 'dynamic_gate_pass',
    iat: nowSec,
  };

  const token = jwt.sign(payload, secret, { expiresIn: expirySec });

  // Render high-contrast QR code for instant phone-to-scanner detection
  const { qrDataUrl, qrPublicUrl } = await renderQRValue(
    token,
    `dyn_${sId}_${Date.now()}`,
    {
      errorCorrectionLevel: 'H',
      width: 512,
      margin: 4,
    }
  );

  return {
    token,
    qrDataUrl,
    qrPublicUrl,
    expiresAt: new Date((nowSec + expirySec) * 1000).toISOString(),
    expiresInSeconds: expirySec,
    refreshIntervalSeconds: QR_DYNAMIC_REFRESH_INTERVAL_SECONDS,
    jti,
    scanType: payload.scan_type,
    passKind: payload.pass_kind,
  };
};

/**
 * Verify a token's cryptographic integrity, expiration, and payload structure.
 * Returns standard verification codes: VALID, EXPIRED, INVALID.
 */
const verifyDynamicPassToken = (token) => {
  if (!token || typeof token !== 'string') {
    return { valid: false, code: 'INVALID', error: 'Missing or empty QR token' };
  }

  const trimmed = token.trim();

  // Reject static legacy tokens (e.g. raw IO-* or HV-*)
  if (/^IO-/i.test(trimmed) || /^HV-/i.test(trimmed)) {
    return {
      valid: false,
      code: 'EXPIRED_OR_LEGACY',
      error: 'Static QR code rejected. Anti-replay security requires a live dynamic pass from the student dashboard.',
    };
  }

  if (!trimmed.startsWith('eyJ')) {
    return {
      valid: false,
      code: 'INVALID',
      error: 'Unrecognized QR format — verification failed.',
    };
  }

  const secret = getQrSecret();

  try {
    const payload = jwt.verify(trimmed, secret);

    // Validate expected claims
    if (!payload.sub && !payload.student_id) {
      return { valid: false, code: 'INVALID', error: 'QR token missing student identity claims' };
    }

    if (!payload.jti) {
      return { valid: false, code: 'INVALID', error: 'QR token missing unique nonce (jti)' };
    }

    if (payload.type !== 'dynamic_gate_pass' && payload.type !== 'inout_request' && payload.type !== 'inout' && payload.type !== 'home_visit') {
      return { valid: false, code: 'INVALID', error: 'Unknown QR pass type' };
    }

    return { valid: true, code: 'VALID', payload };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return {
        valid: false,
        code: 'EXPIRED',
        expired: true,
        error: 'QR code expired (> 20s old). Screenshots are rejected — student must present a live pass from the dashboard.',
      };
    }
    return {
      valid: false,
      code: 'INVALID',
      error: 'Invalid or forged QR token — verification failed.',
    };
  }
};

/**
 * Atomically check and consume a dynamic token's single-use nonce (jti).
 * Guarantees exactly-once consumption across distributed instances using Redis SET NX.
 * Handles network retries idempotently.
 *
 * @param {string} jti - Unique token nonce
 * @param {Object} payload - Decoded token payload
 * @returns {Promise<{ status: 'OK' | 'ALREADY_USED' | 'IDEMPOTENT_REPLAY', cachedResult?: Object, error?: string }>}
 */
const consumeDynamicTokenAtomic = async (jti, payload) => {
  if (!jti) {
    return { status: 'INVALID', error: 'Missing token nonce' };
  }

  const redis = await getRedis();
  const replayKey = `gatescan:used_token:${jti}`;
  const idempotentKey = `gatescan:idempotent_result:${jti}`;

  // ── Redis atomic path (primary / production) ───────────────────────────────
  if (redis) {
    try {
      // 1. Check if this is an idempotent retry of an already completed scan
      const cached = await redis.get(idempotentKey);
      if (cached) {
        try {
          const cachedResult = JSON.parse(cached);
          return { status: 'IDEMPOTENT_REPLAY', cachedResult };
        } catch {
          // parse failed, continue
        }
      }

      // 2. Atomic SET NX to lock the single-use token (300s TTL is plenty to cover token window + safety margin)
      const lockVal = JSON.stringify({
        sub: payload.sub || payload.student_id,
        timestamp: Date.now(),
      });
      const acquired = await redis.set(replayKey, lockVal, { NX: true, EX: 300 });

      if (!acquired) {
        return {
          status: 'ALREADY_USED',
          error: 'This QR code has already been scanned. Replay of shared or previously used QR is rejected.',
        };
      }

      return { status: 'OK' };
    } catch (redisErr) {
      logger.warn('[DynamicQR] Redis error during token consumption, using safe fallback', { error: redisErr.message });
      // If REQUIRE_REDIS_IN_PRODUCTION is strictly set, fail safe
      if (process.env.NODE_ENV === 'production' && (process.env.REQUIRE_REDIS_IN_PRODUCTION ?? 'true') !== 'false') {
        const err = new Error('Replay protection service temporarily unavailable');
        err.statusCode = 503;
        throw err;
      }
    }
  }

  // ── In-Memory Process-level Fallback (Atomic Map) ─────────────────────────
  const cached = fallbackIdempotentResults.get(jti);
  if (cached && Date.now() < cached.expiresAt) {
    return { status: 'IDEMPOTENT_REPLAY', cachedResult: cached.body };
  }

  if (fallbackUsedTokens.has(jti)) {
    return {
      status: 'ALREADY_USED',
      error: 'This QR code has already been scanned. Replay of shared or previously used QR is rejected.',
    };
  }

  fallbackUsedTokens.set(jti, Date.now());
  return { status: 'OK' };
};

/**
 * Cache successful scan result so idempotent network retries return identical success
 * without creating duplicate database records.
 */
const cacheScanIdempotentResult = async (jti, resultBody) => {
  if (!jti || !resultBody) return;

  const serialized = JSON.stringify(resultBody);
  const redis = await getRedis();
  const idempotentKey = `gatescan:idempotent_result:${jti}`;

  if (redis) {
    try {
      await redis.set(idempotentKey, serialized, { EX: 60 }); // 60s window for network retries
      return;
    } catch (err) {
      logger.warn('[DynamicQR] Failed to cache idempotent result in Redis', { error: err.message });
    }
  }

  fallbackIdempotentResults.set(jti, {
    body: resultBody,
    expiresAt: Date.now() + 60000,
  });
};

module.exports = {
  QR_DYNAMIC_EXPIRY_SECONDS,
  QR_DYNAMIC_REFRESH_INTERVAL_SECONDS,
  issueDynamicPassToken,
  verifyDynamicPassToken,
  consumeDynamicTokenAtomic,
  cacheScanIdempotentResult,
};
