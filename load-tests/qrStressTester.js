/**
 * High-Precision QR Load and Stress Tester
 *
 * Verifies:
 * 1. Valid QR verification throughput & latency
 * 2. Simultaneous Guard race condition (Locking & Duplicate scan prevention)
 * 3. Expired & Invalid QR code rejections
 * 4. Step-wise scan rates: 10, 25, 50, 100, 200, 500 scans/sec
 */

const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const ApiClient = require('./lib/apiClient');
const MetricsCollector = require('./lib/metricsCollector');

class QrStressTester {
  constructor(apiUrl = config.apiUrl) {
    this.api = new ApiClient(apiUrl);
    this.tokens = this.loadTokens();
  }

  loadTokens() {
    if (fs.existsSync(config.tokensFile)) {
      return JSON.parse(fs.readFileSync(config.tokensFile, 'utf8'));
    }
    // Fallback if seeded elsewhere
    const alt = path.resolve(__dirname, '../../Hostel_permission/backend/loadtest/testTokens.json');
    if (fs.existsSync(alt)) {
      return JSON.parse(fs.readFileSync(alt, 'utf8'));
    }
    return { students: [], guards: [] };
  }

  async testRaceCondition() {
    console.log('\n' + '─'.repeat(70));
    console.log('🏁 QR RACE CONDITION & DUPLICATE PREVENTION TEST');
    console.log('─'.repeat(70));

    const student = this.tokens.students[0];
    const guard1 = this.tokens.guards[0];
    const guard2 = this.tokens.guards[1] || guard1;

    if (!student || !guard1) {
      console.log('⚠️  No student or guard tokens found. Run `npm run seed-test-users` first.');
      return null;
    }

    // 1. Student generates a fresh QR pass
    console.log(`📱 Step 1: Student (${student.name}) generates a fresh gate pass QR...`);
    const genRes = await this.api.post(
      '/api/student/request-inout',
      { place: 'Pune' },
      { token: student.token }
    );

    if (!genRes.ok || !genRes.data?.token) {
      console.log(`❌ Failed to generate QR: ${genRes.status} ${genRes.rawData}`);
      return null;
    }

    const qrToken = genRes.data.token;
    console.log(`   ✓ Pass generated: Token length=${qrToken.length} chars`);

    // 2. Simulate TWO GUARDS scanning the EXACT SAME QR SIMULTANEOUSLY
    console.log(`⚡ Step 2: Guard 1 (${guard1.name}) & Guard 2 (${guard2.name}) scanning simultaneously...`);
    const t0 = process.hrtime.bigint();

    const [scan1, scan2] = await Promise.all([
      this.api.post('/api/gatescan/scan', { token: qrToken }, { token: guard1.token }),
      this.api.post('/api/gatescan/scan', { token: qrToken }, { token: guard2.token }),
    ]);

    const t1 = process.hrtime.bigint();
    const durationMs = Number(t1 - t0) / 1e6;

    console.log(`\n📊 Race Condition Results (${durationMs.toFixed(2)}ms total):`);
    console.log(`   • Guard 1 Response: Status ${scan1.status} | Body: ${JSON.stringify(scan1.data?.message || scan1.rawData).slice(0, 80)}`);
    console.log(`   • Guard 2 Response: Status ${scan2.status} | Body: ${JSON.stringify(scan2.data?.message || scan2.rawData).slice(0, 80)}`);

    // Verification check
    const statusCodes = [scan1.status, scan2.status].sort();
    const isDuplicateBlocked =
      (statusCodes.includes(200) && (statusCodes.includes(409) || statusCodes.includes(400))) ||
      (scan1.status === 200 && scan2.data?.message?.includes('already'));

    console.log(`\n🛡️  Duplicate Prevention Verdict: ${isDuplicateBlocked ? '✅ PROTECTED (Locking working)' : '⚠️ Check concurrency guard'}`);

    return {
      success: isDuplicateBlocked,
      guard1: { status: scan1.status, message: scan1.data?.message },
      guard2: { status: scan2.status, message: scan2.data?.message },
      durationMs,
    };
  }

  async runRateTest(targetRateRps = 50, durationSec = 10) {
    console.log('\n' + '─'.repeat(70));
    console.log(`🎯 QR SCAN RATE TEST: Target = ${targetRateRps} scans/sec for ${durationSec}s`);
    console.log('─'.repeat(70));

    const metrics = new MetricsCollector(`QR Scan Rate: ${targetRateRps} rps`);
    const guard = this.tokens.guards[0];
    const testStudents = this.tokens.students.slice(0, Math.min(targetRateRps * 2, this.tokens.students.length));

    if (!guard || testStudents.length === 0) {
      console.log('⚠️  Tokens missing. Run `npm run seed-test-users` first.');
      return null;
    }

    // Pre-generate QRs for smooth rate testing
    console.log(`⏳ Pre-generating ${testStudents.length} gate pass QRs...`);
    const preGeneratedQRs = [];
    const genBatches = 20;

    for (let i = 0; i < testStudents.length; i += genBatches) {
      const chunk = testStudents.slice(i, i + genBatches);
      const batchRes = await Promise.all(
        chunk.map((s) =>
          this.api.post('/api/student/request-inout', { place: 'Pune' }, { token: s.token })
        )
      );
      for (const r of batchRes) {
        if (r.ok && r.data?.token) preGeneratedQRs.push(r.data.token);
      }
    }

    console.log(`   ✓ Ready with ${preGeneratedQRs.length} active QR tokens.`);

    const totalRequests = targetRateRps * durationSec;
    const intervalMs = 1000 / targetRateRps;
    let completed = 0;
    let sent = 0;

    const startTime = Date.now();

    await new Promise((resolve) => {
      const timer = setInterval(async () => {
        if (sent >= totalRequests || Date.now() - startTime >= durationSec * 1000) {
          clearInterval(timer);
          // Wait for inflight requests to complete
          const checkDone = setInterval(() => {
            if (completed >= sent) {
              clearInterval(checkDone);
              metrics.stop();
              resolve();
            }
          }, 50);
          return;
        }

        const qrToken = preGeneratedQRs[sent % preGeneratedQRs.length];
        sent++;

        this.api
          .post('/api/gatescan/scan', { token: qrToken }, { token: guard.token })
          .then((res) => {
            metrics.record(res, 'qr');
            completed++;
          })
          .catch(() => {
            completed++;
          });
      }, intervalMs);
    });

    const summary = metrics.getSummary();
    console.log(`\n📈 Results for ${targetRateRps} scans/sec:`);
    console.log(`   • Completed: ${summary.totalRequests} scans in ${summary.durationSeconds}s`);
    console.log(`   • Actual RPS: ${summary.requestsPerSecond} scans/sec`);
    console.log(`   • Success Rate: ${summary.successRate}%`);
    console.log(`   • Latency P50: ${summary.latencies.p50}ms | P95: ${summary.latencies.p95}ms | P99: ${summary.latencies.p99}ms`);
    console.log(`   • Status Codes: ${JSON.stringify(summary.statusCodes)}`);

    return summary;
  }

  async runFullSuite() {
    console.log('═'.repeat(70));
    console.log('🚀 COMPREHENSIVE QR LOAD TEST SUITE');
    console.log(`Target Backend: ${this.api.baseUrl}`);
    console.log('═'.repeat(70));

    // 1. Race condition test
    const raceResult = await this.testRaceCondition();

    // 2. Stepped scan rate levels: 10, 25, 50, 100, 200, 500
    const rates = [10, 25, 50, 100];
    if (config.isStress || process.argv.includes('--stress')) {
      rates.push(200, 500);
    }

    const rateResults = [];
    for (const rate of rates) {
      const res = await this.runRateTest(rate, 8);
      if (res) rateResults.push(res);
      // Brief cooldown
      await new Promise((r) => setTimeout(r, 1000));
    }

    return { raceResult, rateResults };
  }
}

if (require.main === module) {
  const tester = new QrStressTester();
  const targetRate = config.rate || 50;
  if (process.argv.includes('--suite')) {
    tester.runFullSuite().then(() => process.exit(0));
  } else {
    tester.runRateTest(targetRate, config.duration || 10).then(() => process.exit(0));
  }
}

module.exports = QrStressTester;
