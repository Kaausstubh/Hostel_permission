/**
 * MongoDB Connection Configuration
 * Production-tuned for low latency and connection reuse on Render/cloud deployments.
 */

const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not set');
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // ── Connection Pool ───────────────────────────────────────────────────────
      // maxPoolSize: max concurrent connections. For Render starter, 10-20 is safe.
      // Higher = more memory; keep in sync with Atlas M0/M2/M5 limits.
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '20', 10),
      minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '5', 10),

      // ── Timeouts ──────────────────────────────────────────────────────────────
      // connectTimeoutMS: how long to wait for initial connection
      connectTimeoutMS: 10000,
      // socketTimeoutMS: how long a socket can be idle before being closed
      socketTimeoutMS: 45000,
      // serverSelectionTimeoutMS: how long to keep trying to find a viable server
      serverSelectionTimeoutMS: 10000,

      // ── Heartbeat ─────────────────────────────────────────────────────────────
      // Detect disconnections faster — default is 10s, explicit here for clarity
      heartbeatFrequencyMS: 10000,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Non-blocking migration — runs in background, doesn't delay server startup
    const { migrateAllLegacyHomeVisitQrs } = require('../services/homeVisitQrService');
    setImmediate(() => {
      migrateAllLegacyHomeVisitQrs().catch((err) => {
        console.error('Home visit QR migration failed:', err.message);
      });
    });

    // Handle connection errors after initial connection
    mongoose.connection.on('error', (err) => {
      console.error(`❌ MongoDB connection error: ${err}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
    });

  } catch (error) {
    console.error(`❌ MongoDB Connection Failed: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
