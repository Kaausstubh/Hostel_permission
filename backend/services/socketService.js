/**
 * Socket.IO Service
 * Real-time event broadcasting for dashboards and scan results.
 *
 * Namespaces:
 *   /dashboard  — Warden/security dashboards (live occupancy, scan events)
 *   /scanner    — Security guard scanner screens (peer scan awareness)
 *
 * Authentication: JWT verified on socket handshake (same secret as REST API)
 *
 * Events emitted by server:
 *   scan_result         — { kind, student, log, scanDuration, timestamp }
 *   occupancy_update    — { studentsOut, totalStudents, date }
 *   qr_pending_update   — { count }
 *   server_stats        — { connectedClients, uptime }
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

let _io = null;

/**
 * Attach Socket.IO to the HTTP server and configure namespaces.
 * Call once during server startup.
 */
const initSocketIO = (httpServer) => {
  const { Server } = require('socket.io');

  _io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Reuse the same CORS logic as Express
        if (!origin) return callback(null, true);
        const allowedOrigins = new Set([
          ...(process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).filter(Boolean),
          ...(process.env.FRONTEND_URLS || '').split(',').map((s) => s.trim()).filter(Boolean),
          'http://localhost:5173',
          'http://localhost:5174',
          'http://127.0.0.1:5173',
          'http://127.0.0.1:5174',
        ]);
        if (allowedOrigins.has(origin)) return callback(null, true);
        if ((process.env.ALLOW_VERCEL_PREVIEWS || 'true') === 'true') {
          try {
            const { hostname, protocol } = new URL(origin);
            if (protocol === 'https:' && hostname.endsWith('.vercel.app')) {
              return callback(null, true);
            }
          } catch { /* ignore */ }
        }
        return callback(new Error(`Socket.IO CORS blocked: ${origin}`));
      },
      credentials: true,
    },
    transports: ['websocket', 'polling'], // WebSocket preferred
    pingTimeout: 60000,
    pingInterval: 25000,
    // Per-connection rate limiting to prevent socket flooding
    maxHttpBufferSize: 1e5, // 100KB max message size
  });

  // ── JWT Auth Middleware ──────────────────────────────────────────────────────
  _io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── /dashboard Namespace ─────────────────────────────────────────────────────
  const dashboardNs = _io.of('/dashboard');
  dashboardNs.use((socket, next) => next()); // Auth already applied globally

  dashboardNs.on('connection', (socket) => {
    logger.info('[Socket] Dashboard client connected', { userId: socket.userId, id: socket.id });

    socket.on('subscribe_hostel', (hostel) => {
      if (typeof hostel === 'string' && ['BH1', 'BH2', 'GH', 'ALL'].includes(hostel.toUpperCase())) {
        socket.join(`hostel:${hostel.toUpperCase()}`);
        logger.debug('[Socket] Client subscribed to hostel room', { hostel, socketId: socket.id });
      }
    });

    socket.on('disconnect', () => {
      logger.info('[Socket] Dashboard client disconnected', { userId: socket.userId, id: socket.id });
    });
  });

  // ── /scanner Namespace ───────────────────────────────────────────────────────
  const scannerNs = _io.of('/scanner');
  scannerNs.on('connection', (socket) => {
    logger.info('[Socket] Scanner client connected', { userId: socket.userId, id: socket.id });

    socket.on('disconnect', () => {
      logger.info('[Socket] Scanner client disconnected', { userId: socket.userId, id: socket.id });
    });
  });

  logger.info('[Socket] ✅ Socket.IO initialized');
  return _io;
};

/**
 * Get the Socket.IO instance (after initSocketIO has been called).
 */
const getIO = () => _io;

/**
 * Broadcast a scan result to all connected dashboard and scanner clients.
 * @param {object} scanResult  - The full scan result from gateScan handler
 * @param {string} hostel      - The hostel of the scanned student (for targeted broadcast)
 */
const broadcastScanResult = (scanResult, hostel = 'ALL') => {
  if (!_io) return;

  const payload = {
    ...scanResult,
    timestamp: new Date().toISOString(),
  };

  // Broadcast to all dashboard viewers
  _io.of('/dashboard').emit('scan_result', payload);

  // Broadcast to hostel-specific room if applicable
  if (hostel && hostel !== 'ALL') {
    _io.of('/dashboard').to(`hostel:${hostel}`).emit('scan_result', payload);
  }

  // Broadcast to all scanner screens (so other guards see peer activity)
  _io.of('/scanner').emit('scan_result', payload);
};

/**
 * Broadcast an occupancy update (total students out right now).
 */
const broadcastOccupancyUpdate = (stats) => {
  if (!_io) return;
  _io.of('/dashboard').emit('occupancy_update', {
    ...stats,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Broadcast that the pending QR list has changed.
 */
const broadcastQrPendingUpdate = (count) => {
  if (!_io) return;
  _io.of('/scanner').emit('qr_pending_update', { count, timestamp: new Date().toISOString() });
  _io.of('/dashboard').emit('qr_pending_update', { count, timestamp: new Date().toISOString() });
};

/**
 * Get count of connected clients across all namespaces.
 */
const getConnectedClientCount = async () => {
  if (!_io) return 0;
  const [dashboard, scanner] = await Promise.all([
    _io.of('/dashboard').allSockets(),
    _io.of('/scanner').allSockets(),
  ]);
  return dashboard.size + scanner.size;
};

module.exports = {
  initSocketIO,
  getIO,
  broadcastScanResult,
  broadcastOccupancyUpdate,
  broadcastQrPendingUpdate,
  getConnectedClientCount,
};
