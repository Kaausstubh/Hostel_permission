/**
 * HEIMDALL Continuous Multi-Actor Load Simulator
 *
 * Simulates real campus peak load with 5,000 users active:
 * - Students generating QR passes, checking status, applying for home visits, filing complaints
 * - Security Guards scanning QR codes (OUT/IN) at gates, checking pending queues
 * - Wardens reviewing dashboard analytics, query logs, not-returned lists, resolving complaints
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const tokensPath = path.join(__dirname, 'testTokens.json');
if (!fs.existsSync(tokensPath)) {
  console.error('testTokens.json not found! Run seed5000.js first.');
  process.exit(1);
}
const { students, guards, wardens } = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));

const BASE_URL = process.env.LOADTEST_BASE_URL || 'http://127.0.0.1:5001';
const DURATION_SECONDS = parseInt(process.env.LOADTEST_DURATION || '25', 10);
const CONCURRENCY = parseInt(process.env.LOADTEST_CONCURRENCY || '40', 10);

const parsedUrl = new URL(BASE_URL);
const HOST = parsedUrl.hostname;
const PORT = parsedUrl.port || 5001;

// Keep-alive agent for realistic connection reuse
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 200,
  maxFreeSockets: 50,
  timeout: 10000,
});

// Endpoint metric tracker
const metrics = {};

function recordMetric(endpoint, status, durationMs) {
  if (!metrics[endpoint]) {
    metrics[endpoint] = {
      total: 0,
      success: 0,
      errors: 0,
      durations: [],
      statuses: {},
    };
  }
  const m = metrics[endpoint];
  m.total++;
  m.statuses[status] = (m.statuses[status] || 0) + 1;
  if (status >= 200 && status < 400) {
    m.success++;
  } else {
    m.errors++;
  }
  m.durations.push(durationMs);
}

// Low-overhead HTTP request helper
function sendRequest(method, reqPath, token, body = null) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const payload = body ? JSON.stringify(body) : null;

    const headers = {
      Accept: 'application/json',
      Connection: 'keep-alive',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: reqPath,
        method,
        headers,
        agent: httpAgent,
        timeout: 10000,
      },
      (res) => {
        let resData = '';
        res.on('data', (chunk) => { resData += chunk; });
        res.on('end', () => {
          const ended = process.hrtime.bigint();
          const durationMs = Number(ended - started) / 1e6;
          recordMetric(`${method} ${reqPath.split('?')[0]}`, res.statusCode, durationMs);
          let parsed = null;
          try { parsed = JSON.parse(resData); } catch {}
          resolve({ status: res.statusCode, data: parsed, durationMs });
        });
      }
    );

    req.on('error', (err) => {
      const ended = process.hrtime.bigint();
      const durationMs = Number(ended - started) / 1e6;
      recordMetric(`${method} ${reqPath.split('?')[0]}`, 599, durationMs);
      resolve({ status: 599, error: err.message, durationMs });
    });

    req.on('timeout', () => {
      req.destroy();
      const ended = process.hrtime.bigint();
      const durationMs = Number(ended - started) / 1e6;
      recordMetric(`${method} ${reqPath.split('?')[0]}`, 504, durationMs);
      resolve({ status: 504, error: 'Timeout', durationMs });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// Shared pool of freshly generated tokens for the guard to scan
const freshlyGeneratedQRs = [];

// ── Actor 1: Student Worker ──────────────────────────────────────────────────
async function runStudentLoop(stopAt) {
  while (Date.now() < stopAt) {
    const student = students[Math.floor(Math.random() * students.length)];
    const roll = Math.random();

    if (roll < 0.40) {
      // 40% of student traffic: Generate Gate QR
      const res = await sendRequest('POST', '/api/inout/generate-qr', student.token);
      if (res.data?.token) {
        freshlyGeneratedQRs.push({ token: res.data.token, studentId: student.id });
        if (freshlyGeneratedQRs.length > 500) freshlyGeneratedQRs.shift();
      }
    } else if (roll < 0.70) {
      // 30%: Check Student Status
      await sendRequest('GET', '/api/student/status', student.token);
    } else if (roll < 0.85) {
    } else if (roll < 0.85) {
      // 15%: Student Home Visits (Request or Check My Requests)
      if (Math.random() < 0.3) {
        await sendRequest('POST', '/api/homevisit/request', student.token, {
          place: 'Pune City',
          reason: 'Weekend Family Visit',
          leave_date: '2026-10-06',
          return_date: '2026-10-08',
        });
      } else {
        await sendRequest('GET', '/api/homevisit/my', student.token);
      }
    } else {
      // 15%: File Complaint
      await sendRequest('POST', '/api/complaints/file', student.token, {
        hostel: student.hostel || 'BH1',
        complaint_type: 'wifi',
        complaint_text: `Load test automated issue report from room ${(Math.floor(Math.random() * 200) + 100)}`,
      });
    }
  }
}

// ── Actor 2: Security Guard Worker (Includes Real Gate Scanning) ─────────────
async function runGuardLoop(stopAt) {
  while (Date.now() < stopAt) {
    const guard = guards[Math.floor(Math.random() * guards.length)];
    const roll = Math.random();

    if (roll < 0.45 && freshlyGeneratedQRs.length > 0) {
      // 45%: Perform real gate QR scan on a pending student token
      const qrItem = freshlyGeneratedQRs.pop();
      if (qrItem) {
        await sendRequest('POST', '/api/gatescan/scan', guard.token, {
          token: qrItem.token,
        });
      }
    } else if (roll < 0.75) {
      // 30%: Monitor Pending QRs at gate
      await sendRequest('GET', '/api/gatescan/pending-qrs', guard.token);
    } else {
      // 25%: View Gate Scan Logs
      await sendRequest('GET', '/api/inout/logs?limit=30', guard.token);
    }
  }
}

// ── Actor 3: Warden Worker ───────────────────────────────────────────────────
async function runWardenLoop(stopAt) {
  while (Date.now() < stopAt) {
    const warden = wardens[Math.floor(Math.random() * wardens.length)];
    const roll = Math.random();

    if (roll < 0.25) {
      // 25%: Warden Dashboard overview
      await sendRequest('GET', '/api/dashboard/summary', warden.token);
    } else if (roll < 0.45) {
      // 20%: Query Scan Logs (all / date filter)
      const dateStr = new Date().toISOString().split('T')[0];
      await sendRequest('GET', `/api/inout/logs?date=${dateStr}&limit=50`, warden.token);
    } else if (roll < 0.65) {
      // 20%: Check Not-Returned students list (curfew)
      await sendRequest('GET', '/api/inout/not-returned', warden.token);
    } else if (roll < 0.80) {
      // 15%: Query Home Visits list
      await sendRequest('GET', '/api/homevisit/list?limit=50', warden.token);
    } else {
      // 20%: Query Complaints dashboard
      await sendRequest('GET', `/api/complaints/all?hostel=${warden.hostel || 'BH1'}&limit=25`, warden.token);
    }
  }
}

// ── Percentile Calculation ───────────────────────────────────────────────────
function calcPercentiles(arr) {
  if (!arr.length) return { p50: 0, p90: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const getP = (p) => sorted[Math.floor((p / 100) * sorted.length)] || 0;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    min: sorted[0].toFixed(1),
    avg: (sum / sorted.length).toFixed(1),
    p50: getP(50).toFixed(1),
    p90: getP(90).toFixed(1),
    p95: getP(95).toFixed(1),
    p99: getP(99).toFixed(1),
    max: sorted[sorted.length - 1].toFixed(1),
  };
}

// ── Main Runner ──────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(78));
  console.log('  HEIMDALL 5,000-USER FULL ECOSYSTEM LOAD TEST');
  console.log(`  Target Backend: ${BASE_URL}`);
  console.log(`  Duration:       ${DURATION_SECONDS} seconds`);
  console.log(`  Concurrency:    ${CONCURRENCY} parallel worker loops`);
  console.log(`  Actors:         Students (60%) | Security Guards (25%) | Wardens (15%)`);
  console.log('═'.repeat(78));

  // Health check first
  const health = await sendRequest('GET', '/api/health');
  if (health.status !== 200) {
    console.error(`Backend not healthy! Got status ${health.status} on /api/health.`);
    process.exit(1);
  }
  console.log('✅ Backend health check passed. Launching concurrent actors...\n');

  const stopAt = Date.now() + DURATION_SECONDS * 1000;
  const workers = [];

  const studentWorkers = Math.max(1, Math.floor(CONCURRENCY * 0.60));
  const guardWorkers = Math.max(1, Math.floor(CONCURRENCY * 0.25));
  const wardenWorkers = Math.max(1, Math.floor(CONCURRENCY * 0.15));

  for (let i = 0; i < studentWorkers; i++) workers.push(runStudentLoop(stopAt));
  for (let i = 0; i < guardWorkers; i++) workers.push(runGuardLoop(stopAt));
  for (let i = 0; i < wardenWorkers; i++) workers.push(runWardenLoop(stopAt));

  // Progress ticker
  const interval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((stopAt - Date.now()) / 1000));
    let totalReqs = 0;
    for (const ep in metrics) totalReqs += metrics[ep].total;
    process.stdout.write(`\r[Running] ${remaining}s remaining | Total requests completed: ${totalReqs} | Queue QRs: ${freshlyGeneratedQRs.length} `);
  }, 1000);

  await Promise.all(workers);
  clearInterval(interval);
  console.log('\n\nLoad test execution finished. Analyzing performance metrics...\n');

  // Print Summary Table
  console.log('═'.repeat(96));
  console.log(
    'Endpoint'.padEnd(36) +
    'Total'.padStart(8) +
    'Success'.padStart(9) +
    'Errors'.padStart(8) +
    'p50(ms)'.padStart(9) +
    'p95(ms)'.padStart(9) +
    'p99(ms)'.padStart(9) +
    'Max(ms)'.padStart(8)
  );
  console.log('─'.repeat(96));

  let grandTotal = 0;
  let grandSuccess = 0;
  let grandErrors = 0;
  const allDurations = [];

  for (const ep of Object.keys(metrics).sort()) {
    const m = metrics[ep];
    const stats = calcPercentiles(m.durations);
    grandTotal += m.total;
    grandSuccess += m.success;
    grandErrors += m.errors;
    allDurations.push(...m.durations);

    console.log(
      ep.padEnd(36).slice(0, 36) +
      String(m.total).padStart(8) +
      String(m.success).padStart(9) +
      String(m.errors).padStart(8) +
      String(stats.p50).padStart(9) +
      String(stats.p95).padStart(9) +
      String(stats.p99).padStart(9) +
      String(stats.max).padStart(8)
    );
  }

  const overall = calcPercentiles(allDurations);
  const throughput = (grandTotal / DURATION_SECONDS).toFixed(1);

  console.log('═'.repeat(96));
  console.log(
    'OVERALL TOTALS'.padEnd(36) +
    String(grandTotal).padStart(8) +
    String(grandSuccess).padStart(9) +
    String(grandErrors).padStart(8) +
    String(overall.p50).padStart(9) +
    String(overall.p95).padStart(9) +
    String(overall.p99).padStart(9) +
    String(overall.max).padStart(8)
  );
  console.log('═'.repeat(96));

  console.log(`\n📊 System Performance Summary Under 5,000-User Database:`);
  console.log(`  • Sustained Throughput:   ${throughput} req/sec`);
  console.log(`  • Success Rate:           ${((grandSuccess / grandTotal) * 100).toFixed(2)}%`);
  console.log(`  • Error Rate:             ${((grandErrors / grandTotal) * 100).toFixed(2)}%`);
  console.log(`  • Median Response Time:   ${overall.p50} ms`);
  console.log(`  • 95th Percentile (p95):  ${overall.p95} ms`);
  console.log(`  • 99th Percentile (p99):  ${overall.p99} ms`);
  console.log(`  • Min / Max Latency:      ${overall.min} ms / ${overall.max} ms`);

  // Write JSON artifact
  const reportPath = path.join(__dirname, 'loadtest_results.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        durationSeconds: DURATION_SECONDS,
        concurrency: CONCURRENCY,
        grandTotal,
        grandSuccess,
        grandErrors,
        throughputRps: throughput,
        overallStats: overall,
        endpoints: metrics,
      },
      null,
      2
    )
  );
  console.log(`\nDetailed JSON results exported to: ${reportPath}`);
}

main().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});
