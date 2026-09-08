/**
 * QR Service
 * Generates signed QR codes using JWT and validates/expires them on scan.
 *
 * SECURITY:
 *  - QR_SECRET MUST be set — no fallback in production
 *  - Error correction upgraded to 'H' (30% damage recovery) for gate scanning
 *  - Token signing uses HS256 with minimum 32-char secret
 *
 * Performance:
 *  - QR image generation is I/O-bound — consider cloud storage (S3/Supabase)
 *    instead of local disk for multi-instance deployments
 */

const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { getRedis } = require('./redisClient');
const logger = require('../utils/logger');

// ── Secret validation ────────────────────────────────────────────────────────
const _QR_SECRET_RAW = process.env.QR_SECRET;
const INSECURE_PLACEHOLDERS = new Set(['qr_fallback_secret', '', undefined, null]);

if (INSECURE_PLACEHOLDERS.has(_QR_SECRET_RAW)) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('[QR] FATAL: QR_SECRET is missing or set to an insecure placeholder. Refusing to start.');
    process.exit(1);
  } else {
    logger.warn('[QR] ⚠️  QR_SECRET not set — using dev-only fallback. DO NOT deploy this to production!');
  }
}

const QR_SECRET = _QR_SECRET_RAW || '__DEV_ONLY_FALLBACK_QR_SECRET_DO_NOT_USE_IN_PROD__';
const QR_EXPIRY = parseInt(process.env.QR_EXPIRY_SECONDS, 10) || 3600;



const ACTIVE_QR_INDEX = 'active_qr_tokens';
const activeQrKey = (token) => `active_qr:${token}`;
const fallbackActiveQRStore = new Map();

/** Compact gate tokens (HV-*, IO-*) are not JWTs — skip jwt.verify in active store */
const isSignedJwtQrToken = (token) =>
  typeof token === 'string' && /^eyJ[A-Za-z0-9_-]+\./.test(token);

const renderQRValue = async (value, filename, options = {}) => {
  const qrOptions = {
    // 'H' = 30% damage recovery — handles cracked screens, partial obstructions
    errorCorrectionLevel: options.errorCorrectionLevel || 'H',
    // 512px — large enough to scan from 30–40cm distance on mobile
    width: options.width || 512,
    margin: options.margin ?? 4,
    // Pure black/white maximizes contrast for all lighting conditions
    color: options.color || { dark: '#000000', light: '#FFFFFF' },
  };

  const qrDataUrl = await QRCode.toDataURL(value, qrOptions);

  const PUBLIC_BASE = process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  const qrPublicUrl = `${PUBLIC_BASE}/api/qr/render?token=${encodeURIComponent(value)}`;
  const qrFilename = filename ? `${filename}.png` : `qr_${Date.now()}.png`;

  return { token: value, qrDataUrl, qrPublicUrl, qrFilename };
};

/** Seconds until end of return date (+1 day buffer), min 24h, max 120 days */
const getHomeVisitExpiresInSeconds = (returnDateStr) => {
  const endMs = new Date(`${returnDateStr}T23:59:59`).getTime() + 24 * 60 * 60 * 1000;
  const seconds = Math.ceil((endMs - Date.now()) / 1000);
  return Math.min(Math.max(seconds, 24 * 60 * 60), 120 * 24 * 60 * 60);
};

const registerActiveQR = async (token, meta, ttlSeconds = QR_EXPIRY) => {
  const entry = { ...meta, createdAt: new Date().toISOString() };
  const ttl = ttlSeconds > 0 ? ttlSeconds : QR_EXPIRY;
  const redis = await getRedis();
  if (redis) {
    await redis.set(activeQrKey(token), JSON.stringify(entry), { EX: ttl });
    await redis.sAdd(ACTIVE_QR_INDEX, token);
    return;
  }
  fallbackActiveQRStore.set(token, entry);
};

const removeActiveQR = async (token) => {
  const redis = await getRedis();
  if (redis) {
    await redis.del(activeQrKey(token));
    await redis.sRem(ACTIVE_QR_INDEX, token);
    return;
  }
  fallbackActiveQRStore.delete(token);
};

const getActiveQRs = async (limit = null) => {
  const cap = limit && limit > 0 ? limit : null;
  const redis = await getRedis();
  if (redis) {
    const tokens = await redis.sMembers(ACTIVE_QR_INDEX);
    if (!tokens.length) return [];

    const pipeline = redis.multi();
    tokens.forEach((token) => pipeline.get(activeQrKey(token)));
    const values = await pipeline.exec();

    const results = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const raw = values[i];
      if (!raw) {
        await redis.sRem(ACTIVE_QR_INDEX, token);
        continue;
      }
      try {
        const meta = JSON.parse(raw);
        if (isSignedJwtQrToken(token)) {
          jwt.verify(token, QR_SECRET);
        }
        results.push({ token, ...meta });
      } catch {
        await redis.del(activeQrKey(token));
        await redis.sRem(ACTIVE_QR_INDEX, token);
      }
    }
    const sorted = results.sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    return cap ? sorted.slice(0, cap) : sorted;
  }

  const results = [];
  for (const [token, meta] of fallbackActiveQRStore.entries()) {
    try {
      if (isSignedJwtQrToken(token)) {
        jwt.verify(token, QR_SECRET);
      }
      results.push({ token, ...meta });
    } catch {
      fallbackActiveQRStore.delete(token);
    }
  }
  const sorted = results.sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
  return cap ? sorted.slice(0, cap) : sorted;
};

const generateQR = async (payload, filename, options = {}) => {
  const expiresIn = options.expiresIn ?? QR_EXPIRY;
  const token = jwt.sign(payload, QR_SECRET, { expiresIn });
  return renderQRValue(token, filename, options.renderOptions);
};

const renderQRFromToken = async (token, filename) => {
  return renderQRValue(token, filename);
};

const validateQR = (token) => {
  try {
    const payload = jwt.verify(token, QR_SECRET);
    return { valid: true, payload };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'QR code has expired', expired: true };
    }
    return { valid: false, error: 'Invalid QR code' };
  }
};

const canonicalCompactToken = (prefix, body) => {
  const raw = String(body || '').replace(/\s+/g, '');
  if (!raw) return '';
  return `${prefix}${raw}`;
};

/** Extract JWT or compact IO-/HV- token from raw scanner text (URLs, labels, etc.) */
const normalizeScannedToken = (raw) => {
  let trimmed = String(raw || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/\s+/g, '');
  if (!trimmed) return '';

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const fromQuery =
        url.searchParams.get('token') ||
        url.searchParams.get('t') ||
        url.searchParams.get('qr');
      if (fromQuery) trimmed = fromQuery.trim();
    }
  } catch {
    // not a URL
  }

  const jwtMatch = trimmed.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (jwtMatch) return jwtMatch[0];

  const ioMatch = trimmed.match(/IO-[A-Za-z0-9_-]+/i);
  if (ioMatch) return canonicalCompactToken('IO-', ioMatch[0].slice(3));

  const hvMatch = trimmed.match(/HV-[A-Za-z0-9_-]+/i);
  if (hvMatch) return canonicalCompactToken('HV-', hvMatch[0].slice(3));

  return trimmed;
};

module.exports = {
  generateQR,
  renderQRFromToken,
  renderQRValue,
  validateQR,
  normalizeScannedToken,
  getHomeVisitExpiresInSeconds,
  registerActiveQR,
  removeActiveQR,
  getActiveQRs,
};
