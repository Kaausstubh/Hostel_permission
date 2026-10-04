/**
 * MongoDB Connection — Free-Tier Optimized
 *
 * ⚠️  FREE-TIER CONSTRAINTS (Atlas M0):
 *   - Max 100 total connections across ALL clients (not per-instance)
 *   - Shared CPU — avoid heavy aggregations
 *   - 512MB storage limit
 *   - No dedicated RAM — cold query cache on M0
 *
 * Pool sizing guide:
 *   M0 (free)  → maxPoolSize: 5  (leave headroom for Atlas monitoring)
 *   M2 ($9/mo) → maxPoolSize: 20
 *   M5 ($25/mo)→ maxPoolSize: 50
 *   M10 ($57/mo)→ maxPoolSize: 100
 *
 * Set MONGODB_MAX_POOL_SIZE in env to override — NEVER set >8 on M0.
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

const MAX_CONNECT_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set — server cannot start without a database');
  }

  // ── Detect cluster tier from URI ─────────────────────────────────────────
  // Atlas M0 URIs contain "mongodb+srv". Self-hosted / Docker MongoDB has no M0 limit.
  const isAtlasM0 = (process.env.MONGODB_URI || '').includes('mongodb+srv');
  const defaultPool = process.env.MONGODB_TIER === 'paid' || !isAtlasM0
    ? '50'   // Self-hosted Docker / paid cluster default
    : '5';   // Atlas M0 free tier default

  const options = {
    // ── Connection Pool ───────────────────────────────────────────────────────
    maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || defaultPool, 10),
    minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '1', 10),

    // Close idle connections quickly
    maxIdleTimeMS: 15_000,

    // ── Timeouts ─────────────────────────────────────────────────────────────
    connectTimeoutMS:         15_000,
    socketTimeoutMS:          30_000,
    serverSelectionTimeoutMS:  8_000,
    heartbeatFrequencyMS:     20_000,

    // ── Write Concern ─────────────────────────────────────────────────────────
    writeConcern: { w: 1, j: false },
  };

  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
    try {
      logger.info(`[DB] Connecting to MongoDB (attempt ${attempt}/${MAX_CONNECT_ATTEMPTS})…`);
      const conn = await mongoose.connect(process.env.MONGODB_URI, options);

      const poolSize = options.maxPoolSize;
      logger.info(`[DB] ✅ MongoDB connected (pool=${poolSize})`, {
        host: conn.connection.host,
        pool: poolSize,
        tier: process.env.MONGODB_TIER || (isAtlasM0 ? 'atlas-m0' : 'self-hosted'),
      });

      // Non-blocking background migration — runs after server is ready
      const { migrateAllLegacyHomeVisitQrs } = require('../services/homeVisitQrService');
      setImmediate(() => {
        migrateAllLegacyHomeVisitQrs().catch((err) => {
          logger.warn('[DB] Home visit QR migration failed', { error: err.message });
        });
        
        // Drop legacy unique index on phone if it exists to prevent duplicate key errors on null values
        mongoose.connection.db.collection('users').dropIndex('phone_1')
          .then(() => logger.info('[DB] Legacy unique index phone_1 dropped successfully'))
          .catch((err) => {
            if (err.codeName !== 'IndexNotFound' && err.codeName !== 'NamespaceNotFound') {
              logger.warn('[DB] Error dropping legacy phone index (non-critical)', { error: err.message });
            }
          });
      });

      // Connection lifecycle events
      mongoose.connection.on('error', (err) => {
        logger.error('[DB] MongoDB connection error', { error: err.message });
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('[DB] MongoDB disconnected — Mongoose will auto-reconnect');
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('[DB] MongoDB reconnected');
      });

      return;
    } catch (error) {
      logger.error(`[DB] Connection attempt ${attempt} failed`, { error: error.message });
      if (attempt < MAX_CONNECT_ATTEMPTS) {
        // Exponential back-off: 1s, 2s, 4s, 8s
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.info(`[DB] Retrying in ${delay}ms…`);
        await sleep(delay);
      } else {
        logger.error('[DB] All MongoDB connection attempts exhausted — exiting');
        process.exit(1);
      }
    }
  }
};

module.exports = connectDB;
