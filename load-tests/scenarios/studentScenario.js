/**
 * Student Portal Load Simulation Scenario
 */

class StudentScenario {
  constructor(apiClient, metrics) {
    this.api = apiClient;
    this.metrics = metrics;
  }

  async executeUserFlow(student) {
    const token = student.token;
    const actions = [];

    // Step 1: Initial Dashboard & Status Check (100% of students)
    const statusRes = await this.api.get('/api/student/status', { token });
    this.metrics.record(statusRes, 'student');
    actions.push('status');

    // Random roll for subsequent student actions
    const roll = Math.random();

    // Flow A (40% probability): Student generates daily gate pass QR
    if (roll < 0.40) {
      const qrRes = await this.api.post(
        '/api/inout/generate-qr',
        { place: 'City Market', reason: 'Groceries' },
        { token }
      );
      this.metrics.record(qrRes, 'student');
      actions.push('generate_qr');

      // Refresh / re-check status after generating QR
      const postQrStatus = await this.api.get('/api/student/status', { token });
      this.metrics.record(postQrStatus, 'student');
      actions.push('status_post_qr');
    }
    // Flow B (25% probability): Student checks past history & complaints
    else if (roll < 0.65) {
      const compRes = await this.api.get('/api/student/complaints?page=1&limit=10', { token });
      this.metrics.record(compRes, 'student');
      actions.push('view_complaints');

      const hvRes = await this.api.get('/api/student/home-visits?page=1&limit=10', { token });
      this.metrics.record(hvRes, 'student');
      actions.push('view_home_visits');
    }
    // Flow C (15% probability): Student files a maintenance complaint
    else if (roll < 0.80) {
      const fileRes = await this.api.post(
        '/api/student/complaint',
        {
          complaint_type: 'wifi',
          complaint_text: `[LoadTest] Slow Wi-Fi connectivity in room ${student.hostel || 'Hostel'}.`,
        },
        { token }
      );
      this.metrics.record(fileRes, 'student');
      actions.push('file_complaint');
    }
    // Flow D (10% probability): Student submits a home leave application
    else if (roll < 0.90) {
      const hvReq = await this.api.post(
        '/api/student/home-visit',
        {
          place: 'Mumbai',
          reason: 'Family event',
          leave_date: '2026-10-10',
          return_date: '2026-10-14',
          parent_phone: '+919100000001',
        },
        { token }
      );
      this.metrics.record(hvReq, 'student');
      actions.push('request_home_visit');
    }
    // Flow E (10% probability): Student logs out
    else {
      const logoutRes = await this.api.post('/api/auth/logout', null, { token });
      this.metrics.record(logoutRes, 'student');
      actions.push('logout');
    }

    return actions;
  }
}

module.exports = StudentScenario;
