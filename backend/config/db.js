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

  // ── Detect free-tier M0 from URI ─────────────────────────────────────────
  // Atlas M0 URIs contain "mongodb+srv" and free clusters are identifiable
  // by the env var or by explicit opt-out. Default conservatively to 5.
  const defaultPool = process.env.MONGODB_TIER === 'paid'
    ? '20'   // M2+ paid tier default
    : '5';   // M0 free tier default

  const options = {
    // ── Connection Pool ───────────────────────────────────────────────────────
    // CRITICAL: Atlas M0 only has 100 connections TOTAL across all clients.
    // With Render free (single instance) use 5 — leaves 95 for Atlas monitoring
    // and other operations. NEVER set >8 on M0.
    maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || defaultPool, 10),
    minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '1', 10),

    // Close idle connections quickly — free tier hibernates
    maxIdleTimeMS: 15_000,   // 15s idle → release connection back to pool

    // ── Timeouts (tuned for free-tier latency) ────────────────────────────────
    connectTimeoutMS:         15_000,  // Free tier can be slow on cold start
    socketTimeoutMS:          30_000,  // More generous than paid — free is slower
    serverSelectionTimeoutMS:  8_000,  // Give Atlas M0 time to respond
    heartbeatFrequencyMS:     20_000,  // Less frequent → fewer background connections

    // ── Write Concern ─────────────────────────────────────────────────────────
    // w:1 (default) is fine for free tier — w:majority adds latency on shared clusters
    writeConcern: { w: 1, j: false },  // Fast writes for scan logs on free tier

    // ── Compression ───────────────────────────────────────────────────────────
    // zlib compression on free tier reduces network bytes significantly
    compressors: ['zlib'],
    zlibCompressionLevel: 1,
  };

  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
    try {
      logger.info(`[DB] Connecting to MongoDB (attempt ${attempt}/${MAX_CONNECT_ATTEMPTS})…`);
      const conn = await mongoose.connect(process.env.MONGODB_URI, options);

      const poolSize = options.maxPoolSize;
      logger.info(`[DB] ✅ MongoDB connected (pool=${poolSize})`, {
        host: conn.connection.host,
        pool: poolSize,
        tier: process.env.MONGODB_TIER || 'free',
      });

      // Non-blocking background migration — runs after server is ready
      const { migrateAllLegacyHomeVisitQrs } = require('../services/homeVisitQrService');
      setImmediate(() => {
        migrateAllLegacyHomeVisitQrs().catch((err) => {
          logger.warn('[DB] Home visit QR migration failed', { error: err.message });
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
