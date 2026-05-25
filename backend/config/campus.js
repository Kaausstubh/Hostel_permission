/**
 * Campus-scale settings (default tuned for ~3000 students).
 * Override via environment variables in production.
 */
const { getRedis, hasRedis } = require('../services/redisClient');

const CAMPUS_STUDENT_CAPACITY = parseInt(process.env.CAMPUS_STUDENT_CAPACITY || '3000', 10);
const PENDING_QR_LIST_LIMIT = parseInt(process.env.PENDING_QR_LIST_LIMIT || '500', 10);
const INOUT_REQUEST_EXPIRY_SECONDS = parseInt(
  process.env.INOUT_REQUEST_EXPIRY_SECONDS || '900',
  10
);
const QR_PNG_RETENTION_DAYS = parseInt(process.env.QR_PNG_RETENTION_DAYS || '7', 10);
const REQUIRE_REDIS_IN_PRODUCTION = (process.env.REQUIRE_REDIS_IN_PRODUCTION || 'true') === 'true';

const validateCampusConfig = async () => {
  const warnings = [];
  const errors = [];

  if (!process.env.MONGODB_URI) {
    errors.push('MONGODB_URI is required');
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    warnings.push('JWT_SECRET should be a long random string (16+ chars)');
  }

  if (!process.env.QR_SECRET || process.env.QR_SECRET === 'qr_fallback_secret') {
    warnings.push('QR_SECRET should be set to a stable random value in production');
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.PUBLIC_BACKEND_URL) {
      warnings.push('PUBLIC_BACKEND_URL is not set — QR image links may break');
    }
    if (REQUIRE_REDIS_IN_PRODUCTION && !hasRedis()) {
      errors.push(
        'REDIS_URL is required in production for pending in/out QRs, active home-visit QRs, and scan locks'
      );
    }
  }

  const redis = await getRedis();
  if (hasRedis() && !redis) {
    warnings.push('REDIS_URL is set but Redis connection failed — using in-memory fallback');
  }

  return {
    capacity: CAMPUS_STUDENT_CAPACITY,
    pendingQrListLimit: PENDING_QR_LIST_LIMIT,
    inOutRequestExpirySeconds: INOUT_REQUEST_EXPIRY_SECONDS,
    qrPngRetentionDays: QR_PNG_RETENTION_DAYS,
    redis: hasRedis() ? (redis ? 'connected' : 'unavailable') : 'not_configured',
    warnings,
    errors,
  };
};

const logCampusStartup = async () => {
  const report = await validateCampusConfig();

  console.log(`\n🏛️  Campus mode: up to ${report.capacity} students`);
  console.log(`   Pending QR list limit: ${report.pendingQrListLimit}`);
  console.log(`   Daily OUT request TTL: ${report.inOutRequestExpirySeconds}s`);
  console.log(`   Redis: ${report.redis}`);

  report.warnings.forEach((w) => console.warn(`   ⚠️  ${w}`));
  report.errors.forEach((e) => console.error(`   ❌ ${e}`));

  if (report.errors.length && process.env.NODE_ENV === 'production') {
    console.error('\n   Fix the errors above before serving ~3000 students.\n');
  }

  return report;
};

module.exports = {
  CAMPUS_STUDENT_CAPACITY,
  PENDING_QR_LIST_LIMIT,
  INOUT_REQUEST_EXPIRY_SECONDS,
  QR_PNG_RETENTION_DAYS,
  REQUIRE_REDIS_IN_PRODUCTION,
  validateCampusConfig,
  logCampusStartup,
};
