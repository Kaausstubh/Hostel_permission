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

const renderQRValue = async (value, filename, options = {}) => {
  const stem = filename || `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const qrFilename = `${stem}.png`;
  const qrFilePath = path.join(QR_DIR, qrFilename);

  if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });

  const qrOptions = {
    errorCorrectionLevel: options.errorCorrectionLevel || 'H',
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
const registerActiveQR = async (token, meta) => {
  const entry = { ...meta, createdAt: new Date().toISOString() };
  const redis = await getRedis();
  if (redis) {
    await redis.set(activeQrKey(token), JSON.stringify(entry), { EX: QR_EXPIRY });
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
const getActiveQRs = async () => {
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
        jwt.verify(token, QR_SECRET);
        results.push({ token, ...JSON.parse(raw) });
      } catch {
        await redis.del(activeQrKey(token));
        await redis.sRem(ACTIVE_QR_INDEX, token);
      }
    }
    return results;
  }

  const results = [];
  for (const [token, meta] of fallbackActiveQRStore.entries()) {
    try {
      jwt.verify(token, QR_SECRET);
      results.push({ token, ...meta });
    } catch {
      fallbackActiveQRStore.delete(token);
    }
  }
  return results;
};

/**
 * Generate a QR code image (base64 data URL + PNG file on disk) with a signed token payload.
 * @param {object} payload   - Data to embed: { type, student_id, scan_type, ... }
 * @param {string} [filename] - Optional filename stem (without extension). Auto-generated if omitted.
 * @returns {Promise<{ token: string, qrDataUrl: string, qrPublicUrl: string, qrFilename: string }>}
 */
const generateQR = async (payload, filename) => {
  // Sign the payload with an expiry
  const token = jwt.sign(payload, QR_SECRET, { expiresIn: QR_EXPIRY });
  return renderQRValue(token, filename);
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
      return { valid: false, error: 'QR code has expired' };
    }
    return { valid: false, error: 'Invalid QR code' };
  }
};

module.exports = {
  generateQR,
  renderQRFromToken,
  renderQRValue,
  validateQR,
  registerActiveQR,
  removeActiveQR,
  getActiveQRs,
};
