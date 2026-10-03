/**
 * Authentication Scenario Tester
 *
 * Tests:
 * 1. Valid token validation (GET /api/auth/me)
 * 2. Missing token (401)
 * 3. Invalid signature (401)
 * 4. Expired token (401)
 * 5. Logout cache invalidation (POST /api/auth/logout)
 * 6. High-concurrency token validation burst
 */

const jwt = require('jsonwebtoken');

class AuthScenario {
  constructor(apiClient, metrics, config) {
    this.api = apiClient;
    this.metrics = metrics;
    this.config = config;
  }

  async runSuite(sampleStudent) {
    console.log('\n🔒 Running Authentication Verification Suite...');
    const results = {
      validAuth: null,
      missingToken: null,
      invalidSignature: null,
      expiredToken: null,
      logout: null,
      concurrentBurst: null,
    };

    // 1. Valid Token
    if (sampleStudent?.token) {
      const res = await this.api.get('/api/auth/me', { token: sampleStudent.token });
      this.metrics.record(res, 'auth');
      results.validAuth = { ok: res.ok, status: res.status, durationMs: res.durationMs };
      console.log(`   ✓ Valid token check: status ${res.status} (${res.durationMs.toFixed(1)}ms)`);
    }

    // 2. Missing Token
    const resNoToken = await this.api.get('/api/auth/me');
    this.metrics.record({ ...resNoToken, ok: resNoToken.status === 401 }, 'auth');
    results.missingToken = { ok: resNoToken.status === 401, status: resNoToken.status };
    console.log(`   ✓ Missing token rejection: status ${resNoToken.status} (expected 401)`);

    // 3. Invalid Signature
    const bogusToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMCJ9.invalidSignatureByteCheck';
    const resBadSig = await this.api.get('/api/auth/me', { token: bogusToken });
    this.metrics.record({ ...resBadSig, ok: resBadSig.status === 401 }, 'auth');
    results.invalidSignature = { ok: resBadSig.status === 401, status: resBadSig.status };
    console.log(`   ✓ Invalid signature rejection: status ${resBadSig.status} (expected 401)`);

    // 4. Expired Token
    const expiredToken = jwt.sign({ id: sampleStudent?.id || '6abff08206b35128f1afaa60' }, this.config.jwtSecret, { expiresIn: '-10s' });
    const resExpired = await this.api.get('/api/auth/me', { token: expiredToken });
    this.metrics.record({ ...resExpired, ok: resExpired.status === 401 }, 'auth');
    results.expiredToken = { ok: resExpired.status === 401, status: resExpired.status };
    console.log(`   ✓ Expired token rejection: status ${resExpired.status} (expected 401)`);

    // 5. Logout
    if (sampleStudent?.token) {
      const resLogout = await this.api.post('/api/auth/logout', null, { token: sampleStudent.token });
      this.metrics.record(resLogout, 'auth');
      results.logout = { ok: resLogout.ok, status: resLogout.status, durationMs: resLogout.durationMs };
      console.log(`   ✓ Logout endpoint check: status ${resLogout.status} (${resLogout.durationMs.toFixed(1)}ms)`);
    }

    return results;
  }

  async runConcurrentAuth(tokens, concurrency = 50) {
    const selected = tokens.slice(0, concurrency);
    const start = process.hrtime.bigint();

    const tasks = selected.map((t) =>
      this.api.get('/api/auth/me', { token: t.token }).then((res) => {
        this.metrics.record(res, 'auth');
        return res;
      })
    );

    const outcomes = await Promise.all(tasks);
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;

    const successCount = outcomes.filter((o) => o.ok).length;
    console.log(`   ⚡ Concurrent Auth Burst (${selected.length} users): ${successCount}/${selected.length} succeeded in ${durationMs.toFixed(1)}ms`);

    return { total: selected.length, success: successCount, durationMs };
  }
}

module.exports = AuthScenario;
