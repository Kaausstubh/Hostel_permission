/**
 * Request Metrics Middleware
 * Tracks latency, request counts, and error rates per endpoint.
 * Exposed at GET /api/metrics (warden-only).
 *
 * Metrics collected:
 *   - Total requests per route
 *   - Error count per route
 *   - Latency histogram (p50, p95, p99) per route
 *   - Active requests (in-flight)
 *   - Scan-specific metrics (scan count, avg scan latency)
 */

const logger = require('../utils/logger');

// ── In-memory metrics store ───────────────────────────────────────────────────
// For production, replace with prometheus-client or InfluxDB
const metrics = {
  startTime: Date.now(),
  requests: {},      // { route: { total, errors, latencies[] } }
  activeRequests: 0,
  totalRequests: 0,
  totalErrors: 0,
  scans: {
    total: 0,
    success: 0,
    failed: 0,
    latencies: [],
  },
};

const MAX_LATENCY_SAMPLES = 1000; // Rolling window for percentile calculation

/**
 * Get route key — normalize dynamic segments for grouping
 * e.g. /api/inout/history/507f1f77bcf86cd799439011 → /api/inout/history/:id
 */
const getRouteKey = (req) => {
  const method = req.method;
  let path = req.route?.path || req.path;
  // Replace ObjectId-like segments
  path = path.replace(/\/[0-9a-f]{24}/g, '/:id');
  // Replace UUIDs
  path = path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '/:uuid');
  return `${method} ${path}`;
};

const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
};

/**
 * Middleware: tracks every request's latency and status.
 */
const metricsMiddleware = (req, res, next) => {
  const start = Date.now();
  metrics.activeRequests++;
  metrics.totalRequests++;

  res.on('finish', () => {
    metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
    const duration = Date.now() - start;
    const routeKey = getRouteKey(req);

    if (!metrics.requests[routeKey]) {
      metrics.requests[routeKey] = { total: 0, errors: 0, latencies: [] };
    }

    const route = metrics.requests[routeKey];
    route.total++;
    route.latencies.push(duration);

    // Keep rolling window
    if (route.latencies.length > MAX_LATENCY_SAMPLES) {
      route.latencies = route.latencies.slice(-MAX_LATENCY_SAMPLES);
    }

    if (res.statusCode >= 400) {
      route.errors++;
      metrics.totalErrors++;
    }

    // Scan-specific tracking
    if (req.path.includes('/scan') && req.method === 'POST') {
      metrics.scans.total++;
      metrics.scans.latencies.push(duration);
      if (metrics.scans.latencies.length > MAX_LATENCY_SAMPLES) {
        metrics.scans.latencies = metrics.scans.latencies.slice(-MAX_LATENCY_SAMPLES);
      }
      if (res.statusCode === 200) metrics.scans.success++;
      else metrics.scans.failed++;
    }
  });

  next();
};

/**
 * GET /api/metrics — Returns current metrics snapshot.
 * Should be protected by auth middleware (warden/admin only).
 */
const getMetricsSnapshot = async () => {
  const uptime = Math.floor((Date.now() - metrics.startTime) / 1000);
  const { getConnectedClientCount } = require('../services/socketService');
  const { getScanQueueMetrics } = require('../queues/scanQueue');

  let connectedClients = 0;
  try { connectedClients = await getConnectedClientCount(); } catch { /* ignore */ }

  let queueMetrics = {};
  try { queueMetrics = await getScanQueueMetrics(); } catch { /* ignore */ }

  // Compute per-route summaries
  const routes = {};
  for (const [route, data] of Object.entries(metrics.requests)) {
    routes[route] = {
      total: data.total,
      errors: data.errors,
      errorRate: data.total ? ((data.errors / data.total) * 100).toFixed(1) + '%' : '0%',
      latency: {
        p50:  percentile(data.latencies, 50),
        p95:  percentile(data.latencies, 95),
        p99:  percentile(data.latencies, 99),
        avg:  data.latencies.length
          ? Math.round(data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length)
          : 0,
      },
    };
  }

  return {
    server: {
      uptime_seconds: uptime,
      uptime_human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`,
      environment: process.env.NODE_ENV,
      version: '1.0.0',
      memory: process.memoryUsage(),
      activeRequests: metrics.activeRequests,
      totalRequests: metrics.totalRequests,
      totalErrors: metrics.totalErrors,
      errorRate: metrics.totalRequests
        ? ((metrics.totalErrors / metrics.totalRequests) * 100).toFixed(2) + '%'
        : '0%',
    },
    scans: {
      total: metrics.scans.total,
      success: metrics.scans.success,
      failed: metrics.scans.failed,
      successRate: metrics.scans.total
        ? ((metrics.scans.success / metrics.scans.total) * 100).toFixed(1) + '%'
        : 'N/A',
      latency: {
        p50:  percentile(metrics.scans.latencies, 50),
        p95:  percentile(metrics.scans.latencies, 95),
        p99:  percentile(metrics.scans.latencies, 99),
        avg:  metrics.scans.latencies.length
          ? Math.round(metrics.scans.latencies.reduce((a, b) => a + b, 0) / metrics.scans.latencies.length)
          : 0,
      },
    },
    realtime: { connectedClients },
    queue: queueMetrics,
    routes,
    generatedAt: new Date().toISOString(),
  };
};

module.exports = { metricsMiddleware, getMetricsSnapshot };
