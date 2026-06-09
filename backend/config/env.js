/**
 * Environment Validation
 * Fail-fast at startup if critical configuration is missing or insecure.
 * This runs BEFORE the server starts accepting connections.
 */

const logger = require('../utils/logger');

const REQUIRED_IN_ALL = [
  'MONGODB_URI',
  'JWT_SECRET',       // Signs the short-lived JWT issued after OAuth callback
  'QR_SECRET',        // Signs QR codes — separate from auth
];
// OAuth credentials — required to USE Google login, but server can boot without them in dev
const REQUIRED_FOR_OAUTH = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SESSION_SECRET',   // express-session secret for OAuth state cookie
];
const REQUIRED_IN_PRODUCTION = ['PUBLIC_BACKEND_URL', 'FRONTEND_URL'];

const MIN_SECRET_LENGTH = 32;

const INSECURE_VALUES = new Set([
  'qr_fallback_secret',
  'replace_with_long_random_secret_min_32_chars',
  'replace_with_different_long_random_secret_min_32_chars',
  'secret',
  'password',
  'changeme',
  'your_jwt_secret',
  'your_qr_secret',
]);

/**
 * Validate all environment variables.
 * Throws in production; logs warnings in development.
 */
const validateEnv = () => {
  const isProd = process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  // ── Always-required vars ──────────────────────────────────────────────────
  for (const key of REQUIRED_IN_ALL) {
    const val = process.env[key];
    if (!val) {
      errors.push(`${key} is required but not set`);
      continue;
    }

    // Secret strength checks
    if (['JWT_SECRET', 'QR_SECRET'].includes(key)) {
      if (INSECURE_VALUES.has(val)) {
        if (isProd) {
          errors.push(`${key} is set to a known insecure placeholder — use a cryptographically random value`);
        } else {
          warnings.push(`${key} is using an insecure placeholder — this must be changed before production`);
        }
      } else if (val.length < MIN_SECRET_LENGTH) {
        if (isProd) {
          errors.push(`${key} must be at least ${MIN_SECRET_LENGTH} characters — got ${val.length}`);
        } else {
          warnings.push(`${key} is shorter than ${MIN_SECRET_LENGTH} characters — strengthen before production`);
        }
      }
    }
  }

  // ── OAuth credentials — warn in dev, error in prod ────────────────────────
  for (const key of REQUIRED_FOR_OAUTH) {
    if (!process.env[key]) {
      if (isProd) {
        errors.push(`${key} is required but not set`);
      } else {
        warnings.push(`${key} is not set — Google OAuth login will not work until this is configured`);
      }
    }
  }

  // ── Production-only required vars ─────────────────────────────────────────
  if (isProd) {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!process.env[key]) {
        errors.push(`${key} is required in production but not set`);
      }
    }

    // Redis is optional in production — set REQUIRE_REDIS_IN_PRODUCTION=false to skip
    const requireRedis = (process.env.REQUIRE_REDIS_IN_PRODUCTION ?? 'true') !== 'false';
    if (requireRedis && !process.env.REDIS_URL) {
      errors.push('REDIS_URL is required in production — set REQUIRE_REDIS_IN_PRODUCTION=false to disable this check');
    } else if (!process.env.REDIS_URL) {
      warnings.push('REDIS_URL not set — running without Redis (scan locking and session cache disabled)');
    }

    // Vercel preview access must be explicitly disabled in production
    const allowPreviews = process.env.ALLOW_VERCEL_PREVIEWS;
    if (!allowPreviews || allowPreviews === 'true') {
      warnings.push(
        'ALLOW_VERCEL_PREVIEWS is true or unset — set to "false" in production to restrict CORS to known origins only'
      );
    }
  }

  // ── Port sanity check ──────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT || '5000', 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be a valid port number (1–65535), got: ${process.env.PORT}`);
  }

  // ── Output results ─────────────────────────────────────────────────────────
  for (const w of warnings) {
    logger.warn(`[ENV] ⚠️  ${w}`);
  }

  if (errors.length > 0) {
    for (const e of errors) {
      logger.error(`[ENV] ❌ ${e}`);
    }
    if (isProd) {
      logger.error('[ENV] Fatal: Fix the errors above before starting the server in production.');
      process.exit(1);
    } else {
      logger.warn('[ENV] Non-fatal in development — these MUST be fixed before deploying to production.');
    }
  } else {
    logger.info('[ENV] ✅ All environment variables validated');
  }
};

module.exports = { validateEnv };
