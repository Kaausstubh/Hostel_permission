/**
 * Latency and Throughput Metrics Collector
 */

class MetricsCollector {
  constructor(name = 'Test Run') {
    this.name = name;
    this.startTime = Date.now();
    this.endTime = null;
    this.records = [];
    this.endpoints = {};
    this.portals = {
      student: { total: 0, success: 0, errors: 0, latencies: [] },
      guard: { total: 0, success: 0, errors: 0, latencies: [] },
      warden: { total: 0, success: 0, errors: 0, latencies: [] },
      admin: { total: 0, success: 0, errors: 0, latencies: [] },
      auth: { total: 0, success: 0, errors: 0, latencies: [] },
      qr: { total: 0, success: 0, errors: 0, latencies: [] },
      system: { total: 0, success: 0, errors: 0, latencies: [] },
    };
    this.statusCodes = {};
  }

  record(result, portal = 'system') {
    const { endpoint, status, durationMs, ok } = result;

    this.records.push({ endpoint, status, durationMs, ok, timestamp: Date.now() });

    // Status code count
    const statusKey = String(status || '0');
    this.statusCodes[statusKey] = (this.statusCodes[statusKey] || 0) + 1;

    // Per-endpoint stats
    if (!this.endpoints[endpoint]) {
      this.endpoints[endpoint] = {
        total: 0,
        success: 0,
        errors: 0,
        latencies: [],
        statusCodes: {},
      };
    }
    const ep = this.endpoints[endpoint];
    ep.total++;
    if (ok) ep.success++;
    else ep.errors++;
    ep.latencies.push(durationMs);
    ep.statusCodes[statusKey] = (ep.statusCodes[statusKey] || 0) + 1;

    // Per-portal stats
    if (!this.portals[portal]) {
      this.portals[portal] = { total: 0, success: 0, errors: 0, latencies: [] };
    }
    const pt = this.portals[portal];
    pt.total++;
    if (ok) pt.success++;
    else pt.errors++;
    pt.latencies.push(durationMs);
  }

  stop() {
    this.endTime = Date.now();
  }

  static calculateStats(latencies) {
    if (!latencies || latencies.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
    }
    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const getP = (p) => {
      const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
      return Number(sorted[idx].toFixed(2));
    };

    return {
      min: Number(sorted[0].toFixed(2)),
      max: Number(sorted[sorted.length - 1].toFixed(2)),
      avg: Number((sum / sorted.length).toFixed(2)),
      p50: getP(50),
      p90: getP(90),
      p95: getP(95),
      p99: getP(99),
    };
  }

  getSummary() {
    const end = this.endTime || Date.now();
    const durationSeconds = Math.max((end - this.startTime) / 1000, 0.001);
    const allLatencies = this.records.map((r) => r.durationMs);

    const total = this.records.length;
    const success = this.records.filter((r) => r.ok).length;
    const errors = total - success;
    const rps = Number((total / durationSeconds).toFixed(1));

    let http4xx = 0;
    let http5xx = 0;
    let timeouts = 0;

    for (const [codeStr, count] of Object.entries(this.statusCodes)) {
      const code = parseInt(codeStr, 10);
      if (code >= 400 && code < 500) http4xx += count;
      else if (code >= 500) http5xx += count;
      else if (code === 408 || code === 0) timeouts += count;
    }

    const overallStats = MetricsCollector.calculateStats(allLatencies);

    const endpointSummaries = {};
    for (const [epName, ep] of Object.entries(this.endpoints)) {
      endpointSummaries[epName] = {
        total: ep.total,
        success: ep.success,
        errors: ep.errors,
        statusCodes: ep.statusCodes,
        stats: MetricsCollector.calculateStats(ep.latencies),
      };
    }

    const portalSummaries = {};
    for (const [portalName, pt] of Object.entries(this.portals)) {
      if (pt.total > 0) {
        portalSummaries[portalName] = {
          total: pt.total,
          success: pt.success,
          errors: pt.errors,
          successRate: Number(((pt.success / pt.total) * 100).toFixed(1)),
          stats: MetricsCollector.calculateStats(pt.latencies),
        };
      }
    }

    return {
      name: this.name,
      durationSeconds: Number(durationSeconds.toFixed(2)),
      totalRequests: total,
      successfulRequests: success,
      failedRequests: errors,
      successRate: total > 0 ? Number(((success / total) * 100).toFixed(1)) : 100,
      requestsPerSecond: rps,
      http4xx,
      http5xx,
      timeouts,
      statusCodes: this.statusCodes,
      latencies: overallStats,
      portals: portalSummaries,
      endpoints: endpointSummaries,
    };
  }
}

module.exports = MetricsCollector;
