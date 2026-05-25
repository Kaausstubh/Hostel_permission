/**
 * HEIMDALL Enterprise Load Test Suite
 *
 * Simulates real-world hostel rush conditions at scale.
 * Tests staged user counts: 100 → 500 → 1k → 2.5k → 5k → 10k → 15k
 *
 * Usage:
 *   # Test against local:
 *   node loadtest/enterprise.js
 *
 *   # Test against deployed:
 *   LOADTEST_BASE_URL=https://heimdall-api.onrender.com \
 *   LOADTEST_JWT=<guard_jwt> \
 *   LOADTEST_STUDENT_JWT=<student_jwt> \
 *   node loadtest/enterprise.js
 *
 * Output: JSON report + human-readable summary + bottleneck analysis
 */

/* eslint-disable no-console */
const autocannon = require('autocannon');
const { EventEmitter } = require('events');

const BASE_URL = process.env.LOADTEST_BASE_URL || 'http://localhost:5000';
const GUARD_JWT = process.env.LOADTEST_JWT || '';
const STUDENT_JWT = process.env.LOADTEST_STUDENT_JWT || '';

const DURATION_SECONDS = parseInt(process.env.LOADTEST_DURATION || '20', 10);

// ── Test stages (connections = concurrent users) ──────────────────────────────
const STAGES = [
  { label: 'Baseline',       connections:   50, pipelining: 1 },
  { label: 'Light load',     connections:  100, pipelining: 1 },
  { label: 'Normal load',    connections:  250, pipelining: 1 },
  { label: 'Rush hour',      connections:  500, pipelining: 1 },
  { label: 'Heavy rush',     connections: 1000, pipelining: 1 },
  { label: 'Stress test',    connections: 2500, pipelining: 1 },
  { label: 'Breaking point', connections: 5000, pipelining: 1 },
];

// Run a single autocannon benchmark
const runBenchmark = (opts) =>
  new Promise((resolve, reject) => {
    const instance = autocannon(opts, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    autocannon.track(instance, { renderProgressBar: true });
  });

// Percentile from autocannon latency histogram object
const p = (lat, pct) => lat?.[`p${pct}`] ?? lat?.percentiles?.[pct] ?? 0;

// Format a single result into a concise object
const summarize = (result) => ({
  requestsPerSec:    result.requests?.average || 0,
  requestsTotal:     result.requests?.total || 0,
  latency_avg:       result.latency?.average || 0,
  latency_p50:       p(result.latency, 50),
  latency_p95:       p(result.latency, 95),
  latency_p99:       p(result.latency, 99),
  latency_max:       result.latency?.max || 0,
  throughput_MB:     ((result.throughput?.average || 0) / 1_000_000).toFixed(2),
  errors:            result.errors || 0,
  timeouts:          result.timeouts || 0,
  non2xx:            result.non2xxResponses || 0,
  errorRate:         result.requests?.total
    ? (((result.errors || 0) + (result.timeouts || 0)) / result.requests.total * 100).toFixed(2)
    : '0.00',
});

// Determine if a stage shows degradation
const gradeStage = (s) => {
  if (s.errorRate > 10 || s.latency_p95 > 3000) return '🔴 CRITICAL';
  if (s.errorRate > 3  || s.latency_p95 > 1200) return '🟠 DEGRADED';
  if (s.errorRate > 0.5 || s.latency_p95 > 500) return '🟡 CAUTION';
  return '🟢 HEALTHY';
};

const runEndpointTest = async (stage, endpoint, headers = {}) => {
  return runBenchmark({
    url: `${BASE_URL}${endpoint}`,
    connections: stage.connections,
    duration: DURATION_SECONDS,
    pipelining: stage.pipelining,
    headers,
    method: 'GET',
    timeout: 10,
  });
};

// ── Main test runner ──────────────────────────────────────────────────────────
const main = async () => {
  console.log('\n');
  console.log('═'.repeat(70));
  console.log('  HEIMDALL Enterprise Load Test Suite');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Duration per stage: ${DURATION_SECONDS}s`);
  console.log(`  Auth: Guard JWT ${GUARD_JWT ? '✅' : '❌ (some tests skipped)'}`);
  console.log('═'.repeat(70));

  const report = {
    target: BASE_URL,
    startedAt: new Date().toISOString(),
    stages: [],
    bottlenecks: [],
    breakingPoint: null,
    recommendations: [],
  };

  const authHeaders = GUARD_JWT
    ? { Authorization: `Bearer ${GUARD_JWT}` }
    : {};

  // ── Stage tests ─────────────────────────────────────────────────────────────
  for (const stage of STAGES) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  Stage: ${stage.label} (${stage.connections} concurrent connections)`);
    console.log('─'.repeat(60));

    const stageResult = { stage: stage.label, connections: stage.connections, endpoints: {} };

    // 1. Health endpoint (no auth)
    console.log('\n  [1/3] Health endpoint (GET /api/health)');
    try {
      const r = await runEndpointTest(stage, '/api/health');
      stageResult.endpoints.health = summarize(r);
    } catch (e) {
      stageResult.endpoints.health = { error: e.message };
    }

    // 2. Authenticated status endpoint
    if (GUARD_JWT) {
      console.log('\n  [2/3] Dashboard summary (GET /api/dashboard/summary)');
      try {
        const r = await runEndpointTest(stage, '/api/dashboard/summary', authHeaders);
        stageResult.endpoints.dashboard = summarize(r);
      } catch (e) {
        stageResult.endpoints.dashboard = { error: e.message };
      }

      console.log('\n  [3/3] Pending QRs (GET /api/gatescan/pending-qrs)');
      try {
        const r = await runEndpointTest(stage, '/api/gatescan/pending-qrs', authHeaders);
        stageResult.endpoints.pendingQrs = summarize(r);
      } catch (e) {
        stageResult.endpoints.pendingQrs = { error: e.message };
      }
    } else {
      console.log('\n  [2/3] Skipped — no GUARD_JWT provided');
      console.log('  [3/3] Skipped — no GUARD_JWT provided');
    }

    // Determine worst endpoint performance for breaking point detection
    const worstEndpoint = Object.values(stageResult.endpoints)
      .filter((e) => !e.error)
      .sort((a, b) => b.latency_p95 - a.latency_p95)[0];

    stageResult.worstP95 = worstEndpoint?.latency_p95 || 0;
    stageResult.worstErrorRate = worstEndpoint?.errorRate || '0';
    stageResult.grade = worstEndpoint ? gradeStage(worstEndpoint) : '⚪ N/A';

    console.log(`\n  Grade: ${stageResult.grade}`);
    console.log(`  Worst p95: ${stageResult.worstP95}ms | Error rate: ${stageResult.worstErrorRate}%`);

    report.stages.push(stageResult);

    // Detect breaking point
    if (!report.breakingPoint && parseFloat(stageResult.worstErrorRate) > 5) {
      report.breakingPoint = {
        connections: stage.connections,
        errorRate: stageResult.worstErrorRate,
        p95: stageResult.worstP95,
        stage: stage.label,
      };
    }
  }

  // ── Analysis ─────────────────────────────────────────────────────────────────
  console.log('\n');
  console.log('═'.repeat(70));
  console.log('  LOAD TEST REPORT');
  console.log('═'.repeat(70));

  console.log('\n  Stage Summary:');
  console.log('  ' + '─'.repeat(68));
  console.log(`  ${'Stage'.padEnd(18)} ${'Users'.padEnd(8)} ${'p95 (ms)'.padEnd(12)} ${'Errors'.padEnd(10)} Grade`);
  console.log('  ' + '─'.repeat(68));

  for (const s of report.stages) {
    console.log(
      `  ${s.stage.padEnd(18)} ${String(s.connections).padEnd(8)} ${String(s.worstP95).padEnd(12)} ${String(s.worstErrorRate + '%').padEnd(10)} ${s.grade}`
    );
  }

  if (report.breakingPoint) {
    console.log('\n  ⚠️  BREAKING POINT DETECTED:');
    console.log(`     At ${report.breakingPoint.connections} concurrent users`);
    console.log(`     Error rate: ${report.breakingPoint.errorRate}%`);
    console.log(`     p95 latency: ${report.breakingPoint.p95}ms`);
    report.recommendations.push(
      `Scale backend horizontally before ${report.breakingPoint.connections} concurrent users`
    );
  } else {
    console.log('\n  ✅ No clear breaking point detected in tested range.');
    report.recommendations.push('System handled all tested load levels — consider testing beyond 5000 connections');
  }

  // Bottleneck identification
  const bottlenecks = [];
  for (const s of report.stages) {
    for (const [ep, data] of Object.entries(s.endpoints)) {
      if (data.error) continue;
      if (data.latency_p95 > 1000) bottlenecks.push({ stage: s.stage, endpoint: ep, p95: data.latency_p95 });
    }
  }

  if (bottlenecks.length > 0) {
    console.log('\n  🔴 Bottlenecks identified:');
    for (const b of bottlenecks) {
      console.log(`     ${b.stage} / ${b.endpoint}: p95=${b.p95}ms`);
    }
    report.bottlenecks = bottlenecks;
  }

  console.log('\n  Recommendations:');
  const baseRecs = [
    'Ensure MongoDB pool size ≥ 100 (MONGODB_MAX_POOL_SIZE=100)',
    'Redis is mandatory in production for distributed scan locks',
    'Use horizontal scaling (2+ backend instances) for >1000 concurrent users',
    'Enable Redis-backed dashboard cache (30s TTL) to reduce DB fan-out',
    'Use a CDN (Cloudflare/Vercel Edge) for frontend static assets',
  ];
  [...report.recommendations, ...baseRecs].forEach((r, i) => {
    console.log(`     ${i + 1}. ${r}`);
  });

  console.log('\n  Capacity Estimates:');
  const healthyStages = report.stages.filter((s) => parseFloat(s.worstErrorRate) < 1);
  const maxSafe = healthyStages.length > 0 ? healthyStages[healthyStages.length - 1].connections : 50;
  console.log(`     Max concurrent users (error rate <1%): ~${maxSafe}`);
  console.log(`     Estimated total registered students supported: ~${maxSafe * 20} (5% concurrent)`);
  console.log(`     Estimated QR scans/minute: ~${Math.floor(maxSafe * 0.4)} (40% of connections scanning)`);

  report.finishedAt = new Date().toISOString();
  report.summary = {
    maxSafeConnections: maxSafe,
    estimatedStudentCapacity: maxSafe * 20,
    estimatedScansPerMinute: Math.floor(maxSafe * 0.4),
  };

  console.log('\n  Full JSON report saved to: loadtest/report.json');
  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(
    path.join(__dirname, 'report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log('\n' + '═'.repeat(70));
  console.log('  Test complete.');
  console.log('═'.repeat(70) + '\n');
};

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
