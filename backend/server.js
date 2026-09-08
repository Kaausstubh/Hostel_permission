/**
 * Smart Campus Hostel Management Platform — HEIMDALL
 * Production-grade Express server with:
 *  ✅ Startup env validation
 *  ✅ Socket.IO real-time layer
 *  ✅ Distributed Redis scan locking
 *  ✅ Request metrics
 *  ✅ Structured logging
 *  ✅ Helmet security hardening
 *  ✅ Per-route rate limiting
 *  ✅ Strict CORS
 *  ✅ Graceful shutdown
 */

require('dotenv').config();

// ── CRITICAL: Validate env before anything else ───────────────────────────────
const { validateEnv } = require('./config/env');
validateEnv();

const http = require('http');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { scheduleNotReturnedAlert } = require('./jobs/notReturnedAlert');
const { scheduleQrCleanup } = require('./jobs/qrCleanup');
const { scheduleArchiveJob } = require('./jobs/archiveScheduler');
const { startWhatsAppWorker, hasQueueInfra } = require('./queues/whatsappQueue');
const { startArchiveWorker } = require('./queues/archiveQueue');
const { initScanQueue } = require('./queues/scanQueue');
const { getRedis, hasRedis } = require('./services/redisClient');
const { logCampusStartup, validateCampusConfig } = require('./config/campus');
const { initSocketIO } = require('./services/socketService');
const { metricsMiddleware, getMetricsSnapshot } = require('./middleware/metrics');
const { apiLimiter } = require('./middleware/rateLimiters');
const { protect, authorize } = require('./middleware/auth');
const session = require('express-session');
const passport = require('./config/passport');

// ── QR Directory (Removed — now generating dynamically in memory) ──────────

// ── Route imports ─────────────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const inOutRoutes     = require('./routes/inOut');
const homeVisitRoutes = require('./routes/homeVisit');
const complaintRoutes = require('./routes/complaints');
const dashboardRoutes = require('./routes/dashboard');
const whatsappRoutes  = require('./routes/whatsapp');
const studentRoutes   = require('./routes/student');
const gateScanRoutes  = require('./routes/gateScan');
const archiveRoutes   = require('./routes/archive');

// ── App & HTTP server (shared with Socket.IO) ─────────────────────────────────
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '1mb';

// ── CORS configuration ────────────────────────────────────────────────────────
const parseOriginList = (...values) =>
  values.flatMap((v) => (v || '').split(',')).map((v) => v.trim()).filter(Boolean);

const configuredOrigins = new Set([
  ...parseOriginList(process.env.FRONTEND_URL, process.env.FRONTEND_URLS),
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
]);

// Default to false in production — must be explicitly opted in
const allowVercelPreviews = process.env.ALLOW_VERCEL_PREVIEWS === 'true';

const shouldAllowOrigin = (origin) => {
  if (!origin) return true; // curl/Postman — allow non-browser requests
  if (configuredOrigins.has(origin)) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    if (allowVercelPreviews && protocol === 'https:' && hostname.endsWith('.vercel.app')) {
      return true;
    }
  } catch {
    logger.warn('[CORS] Invalid Origin header', { origin });
  }

  return false;
};

// ── Connect to MongoDB ────────────────────────────────────────────────────────
connectDB();

// ── Middleware stack (ORDER MATTERS) ──────────────────────────────────────────
app.disable('x-powered-by');

// Security headers (must be first)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com'],
      connectSrc:     ["'self'", ...(process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(s => s.trim())],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow QR images to be loaded cross-origin
  hsts: {
    maxAge: 31536000,       // 1 year
    includeSubDomains: true,
    preload: true,
  },
}));

// ── Session middleware (required for OAuth state/CSRF param during redirect) ───
// Session is ONLY used during the OAuth handshake. After the callback, a JWT
// is issued and sessions are not consulted for API requests.
const sessionConfig = {
  secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'heimdall.sid',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 10 * 60 * 1000, // 10 minutes — only needed for OAuth handshake
  },
};

// ── Dynamic Session middleware (prevents startup race conditions with Redis) ──
let sessionMiddleware;
app.use((req, res, next) => {
  if (sessionMiddleware) {
    return sessionMiddleware(req, res, next);
  }
  
  getRedis().then((redis) => {
    const store = redis ? new (require('connect-redis').default)({ client: redis }) : undefined;
    sessionConfig.store = store;
    sessionMiddleware = session(sessionConfig);
    if (redis) {
      logger.info('[Session] Using Redis session store (lazily initialized)');
    } else {
      logger.warn('[Session] Redis unavailable — using in-memory session store (dev only)');
    }
    sessionMiddleware(req, res, next);
  }).catch((err) => {
    logger.warn('[Session] Redis check failed — using in-memory session store', { error: err.message });
    sessionMiddleware = session(sessionConfig);
    sessionMiddleware(req, res, next);
  });
});

// ── Passport (OAuth) ──────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// Compression (before any route handling)
app.use(compression({ threshold: 1024 }));

// Request metrics (before rate limiting so all requests are tracked)
app.use(metricsMiddleware);

// Request ID + structured access logging
app.use((req, res, next) => {
  req.requestId = uuidv4();
  const started = Date.now();
  res.set('X-Request-Id', req.requestId);

  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    const ms = Date.now() - started;
    const logFn = res.statusCode >= 500 ? logger.error : res.statusCode >= 400 ? logger.warn : logger.info;
    logFn(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`, {
      requestId: req.requestId.slice(0, 8),
      ip: req.ip,
      ua: req.headers['user-agent']?.slice(0, 80),
    });
  });
  next();
});

// CORS
app.use(cors({
  origin: (origin, cb) => {
    if (shouldAllowOrigin(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));
app.options('*', cors());

// Dynamic QR Image rendering (stateless)
app.get('/api/qr/render', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send('Token required');
  try {
    const QRCode = require('qrcode');
    const buffer = await QRCode.toBuffer(token, { errorCorrectionLevel: 'H', width: 512, margin: 3 });
    res.type('image/png');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.send(buffer);
  } catch (err) {
    res.status(500).send('Error generating QR');
  }
});

// Body parsing (skip for WhatsApp webhook which needs raw body)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/whatsapp/webhook')) return next();
  express.json({ limit: REQUEST_BODY_LIMIT })(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// Global API rate limiter
app.use('/api', apiLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/inout',      inOutRoutes);
app.use('/api/homevisit',  homeVisitRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/dashboard',  dashboardRoutes);
app.use('/api/whatsapp',   whatsappRoutes);
app.use('/api/student',    studentRoutes);
app.use('/api/gatescan',   gateScanRoutes);
app.use('/api/archive',    archiveRoutes);

// ── Health & Readiness Checks ─────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'public, max-age=5');
  res.json({
    status: 'ok',
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    service: 'HEIMDALL Smart Campus API',
    uptime: process.uptime(),
  });
});

app.get('/api/ready', async (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  const redis = await getRedis();
  const redisRequired = process.env.NODE_ENV === 'production' &&
    (process.env.REQUIRE_REDIS_IN_PRODUCTION || 'true') === 'true';
  const redisReady = redisRequired ? Boolean(redis?.isOpen) : (hasRedis() ? Boolean(redis?.isOpen) : true);

  const campus = await validateCampusConfig();
  const ready = dbReady && redisReady && campus.errors.length === 0;

  res.status(ready ? 200 : 503).json({
    status:    ready ? 'ready' : 'not_ready',
    requestId: req.requestId,
    checks: {
      mongodb: dbReady    ? 'up'                    : 'down',
      redis:   redisReady ? 'up'                    : (hasRedis() ? 'down' : 'optional'),
    },
    campus: {
      capacity:           campus.capacity,
      pendingQrListLimit: campus.pendingQrListLimit,
      redis:              campus.redis,
    },
    warnings:  campus.warnings,
    errors:    campus.errors,
    timestamp: new Date().toISOString(),
  });
});

// ── Metrics Endpoint (warden/admin only) ──────────────────────────────────────
app.get('/api/metrics', protect, authorize('warden'), async (req, res) => {
  try {
    const snapshot = await getMetricsSnapshot();
    res.json({ success: true, metrics: snapshot });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Dev-only cron trigger ─────────────────────────────────────────────────────
app.post('/api/dev/trigger-alert', async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ message: 'Only available in development mode' });
  }
  const { runNotReturnedAlert } = require('./jobs/notReturnedAlert');
  const result = await runNotReturnedAlert();
  res.json({ success: true, result });
});

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    requestId: req.requestId,
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('[Server] Unhandled error', {
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    requestId: req.requestId,
    path: req.path,
  });

  // CORS errors
  if (err.message?.startsWith('CORS blocked')) {
    return res.status(403).json({ success: false, message: err.message });
  }

  res.status(err.status || 500).json({
    success: false,
    requestId: req.requestId,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start server ──────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  logger.info('🚀 HEIMDALL Smart Campus Hostel Management Platform v2.0');
  logger.info(`   Environment: ${process.env.NODE_ENV}`);
  logger.info(`   Listening on port ${PORT}`);
  logger.info(`   MongoDB pool: ${process.env.MONGODB_MAX_POOL_SIZE || 100}`);
  logger.info(`   Redis: ${hasRedis() ? process.env.REDIS_URL?.split('@').pop() : 'not configured'}`);
  logger.info(`   WhatsApp: ${process.env.SIMULATE_WHATSAPP === 'true' ? 'SIMULATION' : 'LIVE'}`);
  logger.info(`   CORS origins: ${configuredOrigins.size} + Vercel previews: ${allowVercelPreviews}`);
  logger.info('─'.repeat(60));

  // Initialize Socket.IO real-time layer
  initSocketIO(server);

  // Initialize scan event queue
  initScanQueue();

  // Background jobs
  scheduleNotReturnedAlert();
  scheduleQrCleanup();
  scheduleArchiveJob();
  startWhatsAppWorker();
  startArchiveWorker();

  // Campus config validation report
  await logCampusStartup();
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
const shutdown = (signal) => async () => {
  logger.info(`[Server] ${signal} received — shutting down gracefully…`);

  server.close(async () => {
    logger.info('[Server] HTTP server closed');
    try {
      await mongoose.connection.close();
      logger.info('[Server] MongoDB connection closed');
    } catch (err) {
      logger.error('[Server] Error closing MongoDB', { error: err.message });
    }
    process.exit(0);
  });

  // Force exit after 15s if graceful shutdown hangs
  setTimeout(() => {
    logger.error('[Server] Graceful shutdown timeout — forcing exit');
    process.exit(1);
  }, 15_000);
};

process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT',  shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('[Server] Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('[Server] Unhandled promise rejection', { reason: String(reason) });
});

module.exports = app;
