/**
 * QR Service
 * Generates signed QR codes using JWT and validates/expires them on scan.
 * Each QR code carries a signed payload: type, student_id, request_id, iat/exp.
 *
 * Also maintains an in-memory ActiveQR store so the Security Dashboard
 * can display a live "Pending QRs" panel.
 */

const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { getRedis } = require('./redisClient');

const QR_SECRET = process.env.QR_SECRET || 'qr_fallback_secret';
const QR_EXPIRY = parseInt(process.env.QR_EXPIRY_SECONDS, 10) || 3600;

// Public directory where QR PNG files are saved
const QR_DIR = path.join(__dirname, '..', 'public', 'qr');

const ACTIVE_QR_INDEX = 'active_qr_tokens';
const activeQrKey = (token) => `active_qr:${token}`;
const fallbackActiveQRStore = new Map();

/** Compact gate tokens (HV-*, IO-*) are not JWTs — skip jwt.verify in active store */
const isSignedJwtQrToken = (token) =>
  typeof token === 'string' && /^eyJ[A-Za-z0-9_-]+\./.test(token);

const renderQRValue = async (value, filename, options = {}) => {
  const stem = filename || `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const qrFilename = `${stem}.png`;
  const qrFilePath = path.join(QR_DIR, qrFilename);

  if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });

  const qrOptions = {
    errorCorrectionLevel: options.errorCorrectionLevel || 'M',
    width: options.width || 400,
    margin: options.margin ?? 2,
    color: options.color || { dark: '#1a1a2e', light: '#ffffff' },
  };

  const qrDataUrl = await QRCode.toDataURL(value, qrOptions);
  await QRCode.toFile(qrFilePath, value, qrOptions);

  const PUBLIC_BASE = process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;
  const qrPublicUrl = `${PUBLIC_BASE}/qr/${qrFilename}`;

  return { token: value, qrDataUrl, qrPublicUrl, qrFilename };
};

/**
 * Register a newly-generated QR in the active store.
 * @param {string} token - The signed JWT token
 * @param {object} meta  - { studentId, studentName, hostel, scanType, qrFilename }
 */
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

/**
 * Remove a QR from the active store once it has been scanned.
 * @param {string} token
 */
const removeActiveQR = async (token) => {
  const redis = await getRedis();
  if (redis) {
    await redis.del(activeQrKey(token));
    await redis.sRem(ACTIVE_QR_INDEX, token);
    return;
  }
  fallbackActiveQRStore.delete(token);
};

/**
 * Return all active (non-expired) QR entries.
 * Prunes expired entries as a side-effect.
 * @returns {Array<object>}
 */
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

/**
 * Generate a QR code image (base64 data URL + PNG file on disk) with a signed token payload.
 * @param {object} payload   - Data to embed: { type, student_id, scan_type, ... }
 * @param {string} [filename] - Optional filename stem (without extension). Auto-generated if omitted.
 * @returns {Promise<{ token: string, qrDataUrl: string, qrPublicUrl: string, qrFilename: string }>}
 */
const generateQR = async (payload, filename, options = {}) => {
  const expiresIn = options.expiresIn ?? QR_EXPIRY;
  const token = jwt.sign(payload, QR_SECRET, { expiresIn });
  return renderQRValue(token, filename, options.renderOptions);
};

/**
 * Render an existing token string as a QR (no resigning).
 * Useful when we want to re-issue the same QR to the client.
 */
const renderQRFromToken = async (token, filename) => {
  return renderQRValue(token, filename);
};

/**
 * Validate a scanned QR token.
 * @param {string} token - Raw JWT string scanned from QR
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
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
      else {
        const last = url.pathname.split('/').filter(Boolean).pop() || '';
        if (/^hv_/i.test(last) || /^io_/i.test(last)) {
          // PNG path only — cannot recover token from filename
        }
      }
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
