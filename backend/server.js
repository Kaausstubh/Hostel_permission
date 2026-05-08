/**
 * Smart Campus Hostel Management Platform
 * Main Express Server Entry Point
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { scheduleNotReturnedAlert } = require('./jobs/notReturnedAlert');
const { startWhatsAppWorker, hasQueueInfra } = require('./queues/whatsappQueue');
const { getRedis } = require('./services/redisClient');

// Ensure QR image directory exists on startup
const QR_DIR = path.join(__dirname, 'public', 'qr');
if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });

// Route imports
const authRoutes = require('./routes/auth');
const inOutRoutes = require('./routes/inOut');
const homeVisitRoutes = require('./routes/homeVisit');
const complaintRoutes = require('./routes/complaints');
const dashboardRoutes = require('./routes/dashboard');
const whatsappRoutes = require('./routes/whatsapp');
const studentRoutes = require('./routes/student');
const gateScanRoutes = require('./routes/gateScan');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;
const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '1mb';
const API_RATE_LIMIT_WINDOW_MS = parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`, 10);
const API_RATE_LIMIT_MAX = parseInt(process.env.API_RATE_LIMIT_MAX || '600', 10);

const parseOriginList = (...values) => values
  .flatMap((value) => (value || '').split(','))
  .map((value) => value.trim())
  .filter(Boolean);

const configuredOrigins = new Set(
  [
    ...parseOriginList(process.env.FRONTEND_URL, process.env.FRONTEND_URLS),
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
  ]
);

const shouldAllowOrigin = (origin) => {
  if (!origin) return true;
  if (configuredOrigins.has(origin)) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    const allowVercelPreviews = (process.env.ALLOW_VERCEL_PREVIEWS || 'true') === 'true';

    if (allowVercelPreviews && protocol === 'https:' && hostname.endsWith('.vercel.app')) {
      return true;
    }
  } catch (error) {
    console.warn('Invalid Origin header received:', origin, error.message);
  }

  return false;
};

// ─── Connect to MongoDB ────────────────────────────────────────────────────────
connectDB();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use(helmet());

const apiLimiter = rateLimit({
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  max: API_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

app.use('/api', apiLimiter);

app.use((req, res, next) => {
  req.requestId = uuidv4();
  const started = Date.now();
  res.on('finish', () => {
    const elapsedMs = Date.now() - started;
    console.log(
      JSON.stringify({
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        elapsedMs,
      })
    );
  });
  next();
});

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow non-browser requests (curl/postman) with no Origin header
      if (!origin) return cb(null, true);
      if (shouldAllowOrigin(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  })
);
app.options('*', cors());

// Serve generated QR code PNGs as public static files
// e.g. GET /qr/qr_1234567890_abc123.png
app.use('/qr', express.static(path.join(__dirname, 'public', 'qr')));

// JSON parser for all routes EXCEPT WhatsApp webhook (needs raw/urlencoded)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/whatsapp/webhook')) {
    return next(); // Express urlencoded is applied in the route itself
  }
  express.json({ limit: REQUEST_BODY_LIMIT })(req, res, next);
});

app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/inout', inOutRoutes);
app.use('/api/homevisit', homeVisitRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/gatescan', gateScanRoutes);

// ─── Manual Cron Trigger (Dev/Testing) ────────────────────────────────────────
app.post('/api/dev/trigger-alert', async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ message: 'Only available in development mode' });
  }
  const { runNotReturnedAlert } = require('./jobs/notReturnedAlert');
  const result = await runNotReturnedAlert();
  res.json({ success: true, result });
});

// ─── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'Smart Campus Hostel API',
  });
});

app.get('/api/ready', async (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  const redis = await getRedis();
  const redisReady = hasQueueInfra() ? Boolean(redis?.isOpen) : true;
  const ready = dbReady && redisReady;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    requestId: req.requestId,
    checks: {
      mongodb: dbReady ? 'up' : 'down',
      redis: redisReady ? 'up' : 'down',
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, requestId: req.requestId, message: `Route ${req.method} ${req.path} not found` });
});

// ─── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Global error:', err.stack);
  res.status(500).json({ success: false, requestId: req.requestId, message: 'Internal server error', error: err.message });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🚀 Smart Campus Hostel Management Platform');
  console.log(`   Server running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   WhatsApp Mode: ${process.env.SIMULATE_WHATSAPP === 'true' ? 'SIMULATION' : 'LIVE (Twilio)'}`);
  console.log(`   WhatsApp Queue: ${hasQueueInfra() ? 'ENABLED' : 'DISABLED (fallback inline)'}`);
  console.log(`   Frontend Origins: ${configuredOrigins.size ? Array.from(configuredOrigins).join(', ') : 'NOT CONFIGURED'}`);
  console.log(`   MongoDB URI: ${process.env.MONGODB_URI ? 'SET' : 'MISSING'}`);
  console.log(`   QR Secret: ${process.env.QR_SECRET ? 'SET' : 'MISSING (using fallback)'}`);
  console.log(`   Public Backend URL: ${process.env.PUBLIC_BACKEND_URL || 'NOT CONFIGURED'}`);
  console.log('─'.repeat(50));

  // Start cron job
  scheduleNotReturnedAlert();
  startWhatsAppWorker();
});

module.exports = app;
