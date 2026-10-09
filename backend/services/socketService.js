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
        const normalize = (u) => (!u ? '' : /^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`);
        const allowedOrigins = new Set([
          ...(process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).filter(Boolean),
          ...(process.env.FRONTEND_URLS || '').split(',').map((s) => s.trim()).filter(Boolean),
          ...(process.env.VERCEL_URL ? [process.env.VERCEL_URL.trim(), normalize(process.env.VERCEL_URL)] : []),
          'http://localhost:5173',
          'http://localhost:5174',
          'http://127.0.0.1:5173',
          'http://127.0.0.1:5174',
        ]);
        if (allowedOrigins.has(origin)) return callback(null, true);
        try {
          const { hostname, protocol, origin: originUrl } = new URL(origin);
          if (allowedOrigins.has(originUrl)) return callback(null, true);

          if (process.env.VERCEL_URL) {
            const vercelHost = process.env.VERCEL_URL.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
            if (hostname === vercelHost) return callback(null, true);
          }

          if ((process.env.ALLOW_VERCEL_PREVIEWS || 'true') === 'true') {
            if (protocol === 'https:' && hostname.endsWith('.vercel.app')) {
              return callback(null, true);
            }
          }
        } catch { /* ignore */ }
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

  // ── Global Namespace (Used by Students and default clients) ──────────────────
  _io.on('connection', (socket) => {
    logger.info('[Socket] Global client connected', { userId: socket.userId, id: socket.id });

    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
      socket.join(`student:${socket.userId}`);
    }

    socket.on('join_student', (studentId) => {
      if (studentId) {
        socket.join(`user:${studentId}`);
        socket.join(`student:${studentId}`);
      }
    });

    socket.on('disconnect', () => {
      logger.info('[Socket] Global client disconnected', { userId: socket.userId, id: socket.id });
    });
  });

  // ── /dashboard Namespace ─────────────────────────────────────────────────────
  const dashboardNs = _io.of('/dashboard');
  dashboardNs.use((socket, next) => next()); // Auth already applied globally

  dashboardNs.on('connection', (socket) => {
    logger.info('[Socket] Dashboard client connected', { userId: socket.userId, id: socket.id });

    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
      socket.join(`student:${socket.userId}`);
    }

    socket.on('join_student', (studentId) => {
      if (studentId) {
        socket.join(`user:${studentId}`);
        socket.join(`student:${studentId}`);
      }
    });

    socket.on('subscribe_hostel', (hostel) => {
      if (typeof hostel === 'string' && ['BH1', 'BH2', 'GH', 'GH1', 'GH2', 'ALL'].includes(hostel.toUpperCase())) {
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
 * Server-Sent Events (SSE) Client Registry for Students
 * Guarantees real-time push even if WebSockets are blocked by proxies
 */
const sseClients = new Map(); // studentId -> Set(res)

const addSseClient = (studentId, res) => {
  const idStr = String(studentId);
  if (!sseClients.has(idStr)) {
    sseClients.set(idStr, new Set());
  }
  sseClients.get(idStr).add(res);
};

const removeSseClient = (studentId, res) => {
  const idStr = String(studentId);
  const clientSet = sseClients.get(idStr);
  if (clientSet) {
    clientSet.delete(res);
    if (clientSet.size === 0) sseClients.delete(idStr);
  }
};

const sendSseScanEvent = (studentId, payload) => {
  const idStr = String(studentId);
  const clientSet = sseClients.get(idStr);
  if (!clientSet || clientSet.size === 0) return;

  const data = `event: scan_verified\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clientSet) {
    try {
      res.write(data);
    } catch (_) {
      clientSet.delete(res);
    }
  }
};

/**
 * Get the Socket.IO instance (after initSocketIO has been called).
 */
const getIO = () => _io;

/**
 * Broadcast a scan result to student dashboard (instant popup), wardens, and scanners.
 * @param {object} scanResult  - The full scan result from gateScan handler
 * @param {string|null} studentId - Target student ID for instant private popup delivery
 * @param {string} hostel      - The hostel of the scanned student
 */
const broadcastScanResult = (scanResult, studentId = null, hostel = 'ALL') => {
  if (!_io && sseClients.size === 0) return;

  const payload = {
    ...scanResult,
    timestamp: scanResult?.log?.timestamp || scanResult?.timestamp || new Date().toISOString(),
  };

  // 1. Direct, instant dispatch to the scanned student (Socket.IO + SSE)
  const targetId = studentId || scanResult?.student?._id || scanResult?.student?.id || scanResult?.log?.student_id;
  if (targetId) {
    const sId = targetId.toString();

    // Emit scan_verified directly to private student rooms across namespaces
    if (_io) {
      _io.to(`user:${sId}`).emit('scan_verified', payload);
      _io.to(`student:${sId}`).emit('scan_verified', payload);
      _io.of('/dashboard').to(`user:${sId}`).emit('scan_verified', payload);
      _io.of('/scanner').to(`user:${sId}`).emit('scan_verified', payload);
    }

    // Push to SSE listeners
    sendSseScanEvent(sId, payload);
  }

  // 2. Broadcast to dashboard and scanner clients
  if (_io) {
    _io.emit('scan_result', payload);
    _io.of('/dashboard').emit('scan_result', payload);

    if (hostel && hostel !== 'ALL') {
      _io.of('/dashboard').to(`hostel:${hostel}`).emit('scan_result', payload);
    }

    _io.of('/scanner').emit('scan_result', payload);
  }
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

/**
 * Send SSE event for visitor pass approval request to a student
 */
const sendSseVisitorEvent = (studentId, payload) => {
  const idStr = String(studentId);
  const clientSet = sseClients.get(idStr);
  if (!clientSet || clientSet.size === 0) return;

  const data = `event: visitor_request\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clientSet) {
    try {
      res.write(data);
    } catch (_) {
      clientSet.delete(res);
    }
  }
};

/**
 * Broadcast visitor pass request to target student and staff/scanner dashboards
 */
const broadcastVisitorRequest = (visitor, studentId = null) => {
  const sId = studentId ? String(studentId) : (visitor?.student_id ? String(visitor.student_id) : null);
  const payload = {
    visitor,
    timestamp: new Date().toISOString(),
  };

  // 1. Direct delivery to student rooms across namespaces
  if (sId) {
    if (_io) {
      _io.to(`user:${sId}`).emit('visitor:request', payload);
      _io.to(`student:${sId}`).emit('visitor:request', payload);
      _io.of('/dashboard').to(`user:${sId}`).emit('visitor:request', payload);
      _io.of('/dashboard').to(`student:${sId}`).emit('visitor:request', payload);
      _io.of('/scanner').to(`user:${sId}`).emit('visitor:request', payload);
    }
    sendSseVisitorEvent(sId, payload);
  }

  // 2. Dashboards (Security & Hostel Staff)
  if (_io) {
    _io.of('/dashboard').emit('visitor:new', {
      action: 'request',
      visitor,
      timestamp: payload.timestamp,
    });
    _io.of('/scanner').emit('visitor:new', {
      action: 'request',
      visitor,
      timestamp: payload.timestamp,
    });
  }
};

/**
 * Broadcast student's approval or rejection response to Security & Hostel Staff dashboards
 */
const broadcastVisitorResponse = (visitor, action, studentName = '') => {
  if (!visitor) return;
  const payload = {
    visitor,
    action, // 'APPROVE' or 'REJECT'
    studentName: studentName || visitor.studentName || 'Student',
    timestamp: new Date().toISOString(),
  };

  // Dashboards (Hostel Staff & Security)
  if (_io) {
    _io.of('/dashboard').emit('visitor:student_response', payload);
    _io.of('/scanner').emit('visitor:student_response', payload);
    _io.of('/dashboard').emit('visitor:update', payload);
    _io.of('/scanner').emit('visitor:update', payload);

    // Also notify student rooms (to sync across multiple tabs or close dialogs)
    const sId = visitor.student_id ? String(visitor.student_id) : null;
    if (sId) {
      _io.to(`user:${sId}`).emit('visitor:resolved', payload);
      _io.to(`student:${sId}`).emit('visitor:resolved', payload);
      _io.of('/dashboard').to(`user:${sId}`).emit('visitor:resolved', payload);
    }
  }
};

module.exports = {
  initSocketIO,
  getIO,
  broadcastScanResult,
  broadcastOccupancyUpdate,
  broadcastQrPendingUpdate,
  getConnectedClientCount,
  addSseClient,
  removeSseClient,
  sendSseScanEvent,
  sendSseVisitorEvent,
  broadcastVisitorRequest,
  broadcastVisitorResponse,
};
