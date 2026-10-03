/**
 * Security Guard Portal Load Simulation Scenario
 */

class GuardScenario {
  constructor(apiClient, metrics) {
    this.api = apiClient;
    this.metrics = metrics;
  }

  async executeGuardFlow(guard, activeTokens = []) {
    const token = guard.token;
    const actions = [];

    // 1. Guard Dashboard / Summary
    const summaryRes = await this.api.get('/api/dashboard/summary', { token });
    this.metrics.record(summaryRes, 'guard');
    actions.push('summary');

    // 2. Fetch pending QR requests (Real-time scanner feed)
    const pendingRes = await this.api.get('/api/gatescan/pending-qrs?limit=50', { token });
    this.metrics.record(pendingRes, 'guard');
    actions.push('pending_qrs');

    // 3. Scan a QR code if available
    const pendingItems = pendingRes.data?.items || pendingRes.data?.requests || [];
    let scannedToken = null;

    if (pendingItems.length > 0) {
      scannedToken = pendingItems[0].token;
    } else if (activeTokens.length > 0) {
      scannedToken = activeTokens[Math.floor(Math.random() * activeTokens.length)];
    }

    if (scannedToken) {
      const scanRes = await this.api.post('/api/gatescan/scan', { token: scannedToken }, { token });
      this.metrics.record(scanRes, 'guard');
      actions.push('scan');
    }

    // 4. View Gate Logs
    const logsRes = await this.api.get('/api/inout/logs?page=1&limit=25', { token });
    this.metrics.record(logsRes, 'guard');
    actions.push('gate_logs');

    // 5. Search Student / Curfew breach check
    const roll = Math.random();
    if (roll < 0.5) {
      const nrRes = await this.api.get('/api/inout/not-returned?page=1&limit=25', { token });
      this.metrics.record(nrRes, 'guard');
      actions.push('not_returned');
    } else {
      const searchRes = await this.api.get('/api/dashboard/students?search=Sharma&page=1&limit=10', { token });
      this.metrics.record(searchRes, 'guard');
      actions.push('student_search');
    }

    return actions;
  }
}

module.exports = GuardScenario;
