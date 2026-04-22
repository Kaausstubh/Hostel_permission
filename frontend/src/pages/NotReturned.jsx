/**
 * Not Returned Page
 * Shows students who scanned OUT but haven't returned — highlighted in RED
 * Allows manual cron trigger in dev mode
 */
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdWarning, MdRefresh } from 'react-icons/md';

export default function NotReturned() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  const fetchNotReturned = async () => {
    try {
      setLoading(true);
      const res = await api.get('/inout/not-returned');
      setStudents(res.data.students);
    } catch (err) {
      toast.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const triggerAlertManually = async () => {
    setTriggering(true);
    try {
      const res = await api.post('/dev/trigger-alert');
      toast.success(`Alert sent to ${res.data.result.processed} student(s)`);
      fetchNotReturned();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Trigger failed');
    } finally {
      setTriggering(false);
    }
  };

  useEffect(() => {
    fetchNotReturned();
    const interval = setInterval(fetchNotReturned, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fade-in">
      <Navbar title="Not Returned Students" />
      <div className="page-area">

        {/* Alert Banner */}
        {students.length > 0 && (
          <div style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.5)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            animation: 'pulse-red 2s ease-in-out infinite',
          }}>
            <MdWarning size={28} color="#ef4444" />
            <div>
              <div style={{ color: '#ef4444', fontWeight: 700, fontSize: 16 }}>
                🚨 {students.length} Student{students.length > 1 ? 's' : ''} Have Not Returned Today
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
                These students scanned OUT but have not come back. Alerts will be sent at 11:59 PM.
              </div>
            </div>
          </div>
        )}

        <div className="section-header">
          <div>
            <div className="section-title"><MdWarning color="#ef4444" /> Students Not Returned</div>
            <div className="section-subtitle">
              {loading ? 'Loading...' : `${students.length} student(s) still outside`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={fetchNotReturned} disabled={loading}>
              <MdRefresh size={16} /> Refresh
            </button>
            <button className="btn btn-danger btn-sm" onClick={triggerAlertManually} disabled={triggering}>
              {triggering
                ? <><span className="loading-spinner" style={{ width: 14, height: 14 }} /> Sending...</>
                : '⚡ Trigger Alert Now'
              }
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading-page">
            <div className="loading-spinner" style={{ width: 40, height: 40 }} />
          </div>
        ) : students.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 60 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 12, color: '#10b981' }}>
              All Students Have Returned!
            </div>
            <p>No students are currently unaccounted for today.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th>Roll Number</th>
                  <th>Hostel</th>
                  <th>Exit Time</th>
                  <th>Phone</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {students.map((log) => (
                  <tr key={log._id} style={{
                    background: 'rgba(239,68,68,0.05)',
                    borderLeft: '3px solid #ef4444',
                  }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{log.student_id?.name || 'Unknown'}</div>
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                      {log.student_id?.rollNumber || '—'}
                    </td>
                    <td>
                      <span className="badge badge-out">{log.student_id?.hostel || '—'}</span>
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#ef4444' }}>
                      {new Date(log.timestamp).toLocaleTimeString('en-IN')}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                      {log.student_id?.phone || '—'}
                    </td>
                    <td>
                      <span className="badge badge-rejected">
                        🔴 Not Returned
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
