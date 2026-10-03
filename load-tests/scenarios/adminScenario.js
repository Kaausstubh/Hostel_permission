/**
 * Admin Portal Load Simulation Scenario (Read-Only & Safe)
 */

class AdminScenario {
  constructor(apiClient, metrics) {
    this.api = apiClient;
    this.metrics = metrics;
  }

  async executeAdminFlow(admin) {
    const token = admin.token;
    const actions = [];

    // 1. Storage Analytics
    const storageRes = await this.api.get('/api/archive/storage-stats', { token });
    this.metrics.record(storageRes, 'admin');
    actions.push('storage_stats');

    // 2. Audit Trail
    const auditRes = await this.api.get('/api/archive/audit-logs?limit=25', { token });
    this.metrics.record(auditRes, 'admin');
    actions.push('audit_logs');

    // 3. System Metrics Snapshot
    const metricsRes = await this.api.get('/api/metrics', { token });
    this.metrics.record(metricsRes, 'admin');
    actions.push('system_metrics');

    return actions;
  }
}

module.exports = AdminScenario;
