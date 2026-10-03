/**
 * Warden Portal Load Simulation Scenario
 */

class WardenScenario {
  constructor(apiClient, metrics) {
    this.api = apiClient;
    this.metrics = metrics;
  }

  async executeWardenFlow(warden) {
    const token = warden.token;
    const actions = [];

    // 1. Live Campus Dashboard Summary (Aggregate queries + Redis cache)
    const summaryRes = await this.api.get('/api/dashboard/summary', { token });
    this.metrics.record(summaryRes, 'warden');
    actions.push('summary');

    // 2. Pending Home Leave Applications
    const leavesRes = await this.api.get('/api/homevisit/list?status=pending&limit=20', { token });
    this.metrics.record(leavesRes, 'warden');
    actions.push('home_visits_pending');

    // 3. Student Roster Directory Lookup
    const studentsRes = await this.api.get('/api/dashboard/students?page=1&limit=25', { token });
    this.metrics.record(studentsRes, 'warden');
    actions.push('students_list');

    // 4. Overdue / Not Returned Check
    const notReturnedRes = await this.api.get('/api/inout/not-returned?limit=25', { token });
    this.metrics.record(notReturnedRes, 'warden');
    actions.push('not_returned');

    // 5. Open Maintenance Complaints
    const complaintsRes = await this.api.get('/api/complaints/all?status=pending&limit=20', { token });
    this.metrics.record(complaintsRes, 'warden');
    actions.push('complaints_pending');

    // 6. Gate Logs Audit Trail
    const logsRes = await this.api.get('/api/inout/logs?page=1&limit=25', { token });
    this.metrics.record(logsRes, 'warden');
    actions.push('gate_logs');

    return actions;
  }
}

module.exports = WardenScenario;
