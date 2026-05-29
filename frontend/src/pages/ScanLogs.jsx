/**
 * Scan Logs Page — In/Out history table (Warden & Security)
 */
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdHistory, MdRefresh } from 'react-icons/md';

export default function ScanLogs({ defaultTab = 'gate' }) {
  const [logs, setLogs] = useState([]);
  const [homeLogs, setHomeLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  const hasMatchingDate = (visit, date) => {
    if (!date) return true;
    const outDate = visit.actual_out_time ? new Date(visit.actual_out_time).toISOString().slice(0, 10) : '';
    const inDate = visit.actual_in_time ? new Date(visit.actual_in_time).toISOString().slice(0, 10) : '';
    return [visit.leave_date, visit.return_date, outDate, inDate].includes(date);
  };

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateFilter) params.append('date', dateFilter);
      if (statusFilter) params.append('status', statusFilter);
      const [gateRes, homeRes] = await Promise.all([
        api.get(`/inout/logs?${params.toString()}`),
        api.get('/homevisit/list?limit=200'),
      ]);

      setLogs(gateRes.data.logs || []);

      const filteredHomeLogs = (homeRes.data.visits || []).filter((visit) => {
        const hasScanRecord = Boolean(visit.actual_out_time || visit.actual_in_time || visit.qr_used_out || visit.qr_used_in);
        if (!hasScanRecord) return false;
        if (statusFilter) {
          if (statusFilter === 'OUT' && !visit.actual_out_time) return false;
          if (statusFilter === 'IN' && !visit.actual_in_time) return false;
        }
        return hasMatchingDate(visit, dateFilter);
      });

      setHomeLogs(filteredHomeLogs);
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
            <div className="section-subtitle">
              {activeTab === 'gate' ? logs.length : homeLogs.length} record(s)
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchLogs} disabled={loading}>
            <MdRefresh size={16} /> Refresh
          </button>
        </div>

        <div className="tabs" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`tab ${activeTab === 'gate' ? 'active' : ''}`}
            onClick={() => setActiveTab('gate')}
          >
            Gate Scan Logs
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => setActiveTab('home')}
          >
            Home Visit Records
          </button>
        </div>

        <div className="filters-row">
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
        ) : activeTab === 'gate' && logs.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 60 }}>📝</div>
            <div style={{ fontWeight: 700, marginTop: 12 }}>No logs found</div>
          </div>
        ) : activeTab === 'home' && homeLogs.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 60 }}>🏠</div>
            <div style={{ fontWeight: 700, marginTop: 12 }}>No home visit records found</div>
          </div>
        ) : activeTab === 'gate' ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Hostel</th>
                  <th>Status</th>
                  <th>Place</th>
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
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{log.place || '—'}</td>
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
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Hostel</th>
                  <th>Place</th>
                  <th>Reason</th>
                  <th>Leave</th>
                  <th>Return</th>
                  <th>Home Out</th>
                  <th>Home In</th>
                  <th>Status</th>
                  <th>Parent Phone</th>
                </tr>
              </thead>
              <tbody>
                {homeLogs.map((visit) => (
                  <tr key={visit._id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{visit.student_id?.name || visit.name || 'Unknown'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{visit.student_id?.rollNo || visit.rollNo || '—'}</div>
                    </td>
                    <td><span className="badge badge-out">{visit.student_id?.hostel || '—'}</span></td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{visit.place || '—'}</td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={visit.reason}>
                      {visit.reason || '—'}
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{visit.leave_date}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{visit.return_date}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                      {visit.actual_out_time ? new Date(visit.actual_out_time).toLocaleString('en-IN') : '—'}
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                      {visit.actual_in_time ? new Date(visit.actual_in_time).toLocaleString('en-IN') : '—'}
                    </td>
                    <td>
                      <span className={`badge ${visit.actual_in_time ? 'badge-in' : 'badge-out'}`}>
                        {visit.actual_in_time ? 'HOME IN' : visit.actual_out_time ? 'HOME OUT' : visit.overall_status}
                      </span>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {visit.student_id?.parentPhone || visit.parent_phone || '—'}
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
