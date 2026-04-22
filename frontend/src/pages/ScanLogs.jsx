/**
 * Scan Logs Page — In/Out history table (Warden & Security)
 */
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdHistory, MdRefresh } from 'react-icons/md';

export default function ScanLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateFilter) params.append('date', dateFilter);
      if (statusFilter) params.append('status', statusFilter);
      const res = await api.get(`/inout/logs?${params.toString()}`);
      setLogs(res.data.logs);
    } catch (err) {
      toast.error('Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [dateFilter, statusFilter]);

  return (
    <div className="fade-in">
      <Navbar title="Scan Logs" />
      <div className="page-area">

        <div className="section-header">
          <div>
            <div className="section-title"><MdHistory /> Gate Scan Logs</div>
            <div className="section-subtitle">{logs.length} record(s)</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchLogs} disabled={loading}>
            <MdRefresh size={16} /> Refresh
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <input
            type="date"
            id="date-filter"
            className="form-input"
            style={{ maxWidth: 180 }}
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
          <select
            id="log-status-filter"
            className="form-select"
            style={{ maxWidth: 160 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Status</option>
            <option value="IN">IN</option>
            <option value="OUT">OUT</option>
          </select>
        </div>

        {loading ? (
          <div className="loading-page"><div className="loading-spinner" style={{ width: 40, height: 40 }} /></div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 60 }}>📝</div>
            <div style={{ fontWeight: 700, marginTop: 12 }}>No logs found</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Hostel</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Out Time</th>
                  <th>In Time</th>
                  <th>Returned</th>
                  <th>Scanned By (MSF)</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log._id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{log.student_id?.name || 'Unknown'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{log.student_id?.rollNo}</div>
                    </td>
                    <td><span className="badge badge-out">{log.student_id?.hostel || '—'}</span></td>
                    <td>
                      <span className={`badge ${log.status === 'IN' ? 'badge-in' : 'badge-out'}`}>
                        {log.status === 'IN' ? '🚪 IN' : '🔓 OUT'}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{log.date}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                      {log.out_time
                        ? new Date(log.out_time).toLocaleTimeString('en-IN')
                        : (log.status === 'OUT' ? new Date(log.timestamp).toLocaleTimeString('en-IN') : '—')}
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                      {log.in_time
                        ? new Date(log.in_time).toLocaleTimeString('en-IN')
                        : (log.status === 'IN' ? new Date(log.timestamp).toLocaleTimeString('en-IN') : '—')}
                    </td>
                    <td>
                      {log.returned
                        ? <span style={{ color: '#10b981', fontSize: 13 }}>✅ Yes</span>
                        : <span style={{ color: '#ef4444', fontSize: 13 }}>❌ No</span>
                      }
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      {log.scannedBy?.rollNo || log.scannedBy?.name || 'N/A'}
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
