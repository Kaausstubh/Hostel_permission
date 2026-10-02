/**
 * Scan Logs Page — In/Out history table (Warden & Security)
 */
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdHistory, MdRefresh, MdPictureAsPdf } from 'react-icons/md';
import { useAuth } from '../context/AuthContext';
import { downloadGateRecordsPDF, generatePDFFromLocalLogs } from '../utils/pdfReportGenerator';
import StudentAvatar from '../components/StudentAvatar';

export default function ScanLogs({ defaultTab = 'gate' }) {
  const [logs, setLogs] = useState([]);
  const [homeLogs, setHomeLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeTab, setActiveTab] = useState(defaultTab);
  const { user } = useAuth();

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  const hasMatchingDate = (visit, date) => {
    if (!date) return true;
    const outDate = visit.actual_out_time ? new Date(visit.actual_out_time).toISOString().slice(0, 10) : '';
    const inDate = visit.actual_in_time ? new Date(visit.actual_in_time).toISOString().slice(0, 10) : '';
    return [visit.leave_date, visit.return_date, outDate, inDate].includes(date);
  };

  const fetchGateLogs = async () => {
    const params = new URLSearchParams();
    if (dateFilter) params.append('date', dateFilter);
    if (statusFilter) params.append('status', statusFilter);
    const gateRes = await api.get(`/inout/logs?${params.toString()}`);
    setLogs(gateRes.data?.logs || []);
  };

  const fetchHomeLogs = async () => {
    const homeRes = await api.get('/homevisit/list?limit=60');
    const filteredHomeLogs = (homeRes.data?.visits || []).filter((visit) => {
      const hasScanRecord = Boolean(visit.actual_out_time || visit.actual_in_time || visit.qr_used_out || visit.qr_used_in);
      if (!hasScanRecord) return false;
      if (statusFilter) {
        if (statusFilter === 'OUT' && !visit.actual_out_time) return false;
        if (statusFilter === 'IN' && !visit.actual_in_time) return false;
      }
      return hasMatchingDate(visit, dateFilter);
    });
    setHomeLogs(filteredHomeLogs);
  };

  const fetchLogs = async (tabToPrioritize = activeTab) => {
    try {
      setLoading(true);
      if (tabToPrioritize === 'gate') {
        await fetchGateLogs();
        setLoading(false);
        fetchHomeLogs().catch(() => {});
      } else {
        await fetchHomeLogs();
        setLoading(false);
        fetchGateLogs().catch(() => {});
      }
    } catch (err) {
      toast.error('Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => { 
    fetchLogs(activeTab); 
  }, [dateFilter, statusFilter, activeTab]);

  const handleExportPDF = async () => {
    const currentRecords = activeTab === 'gate' ? logs : homeLogs;
    if (!currentRecords || currentRecords.length === 0) {
      toast.error('No records available for the selected filters to generate PDF');
      return;
    }

    try {
      setExportingPdf(true);
      const params = new URLSearchParams({
        type: activeTab === 'gate' ? 'gate' : 'home',
      });
      if (dateFilter) {
        params.append('startDate', dateFilter);
        params.append('endDate', dateFilter);
      }

      let exportedFromServer = false;
      try {
        const res = await api.get(`/archive/export-data?${params.toString()}`);
        if (res.data?.records && res.data.records.length > 0) {
          await downloadGateRecordsPDF(res.data);
          exportedFromServer = true;
        }
      } catch (err) {
        console.warn('[PDF Export] Server export-data route fallback to client generation:', err.message);
      }

      if (!exportedFromServer) {
        await generatePDFFromLocalLogs({
          gateLogs: activeTab === 'gate' ? logs : [],
          homeLogs: activeTab === 'home' ? homeLogs : [],
          user,
          period: dateFilter || `${activeTab === 'gate' ? 'Gate Scan Logs' : 'Home Visit Records'} (${new Date().toLocaleDateString('en-IN')})`,
          customFileName: `IIITP_HEIMDALL_${activeTab === 'gate' ? 'Gate_Scan' : 'Home_Visit'}_Logs_${dateFilter || 'Export'}.pdf`,
        });
      }

      toast.success('PDF report downloaded successfully');
    } catch (err) {
      toast.error('Failed to generate PDF report');
    } finally {
      setExportingPdf(false);
    }
  };

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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn btn-outline btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: '#cbd5e1' }}
              onClick={handleExportPDF}
              disabled={exportingPdf || loading}
            >
              <MdPictureAsPdf size={16} color="#ef4444" />
              {exportingPdf ? 'Exporting...' : 'Export PDF'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={fetchLogs} disabled={loading}>
              <MdRefresh size={16} /> Refresh
            </button>
          </div>
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
                  <th>Scanned By</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log._id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <StudentAvatar
                          student={log.student_id}
                          recordPhoto={log.student_photo}
                          name={log.student_id?.name || log.name}
                        />
                        <div>
                          <div style={{ fontWeight: 600 }}>{log.student_id?.name || log.name || 'Unknown'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{log.student_id?.rollNo || log.rollNo || '—'}</div>
                        </div>
                      </div>
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
                      {log.scanned_by_name || log.scannedBy?.name || log.scannedBy?.rollNo || log.scannedBy?.email || 'Duty Guard'}
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
                  <th>Scanned By</th>
                </tr>
              </thead>
              <tbody>
                {homeLogs.map((visit) => (
                  <tr key={visit._id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <StudentAvatar
                          student={visit.student_id}
                          recordPhoto={visit.student_photo}
                          name={visit.student_id?.name || visit.name}
                        />
                        <div>
                          <div style={{ fontWeight: 600 }}>{visit.student_id?.name || visit.name || 'Unknown'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{visit.student_id?.rollNo || visit.rollNo || '—'}</div>
                        </div>
                      </div>
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
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      {visit.scanned_by_name ||
                       visit.scannedBy?.name ||
                       visit.scanned_by_in?.name ||
                       visit.scanned_by_out?.name ||
                       visit.parent_call_confirmed_by?.name ||
                       (visit.actual_in_time || visit.actual_out_time ? 'Duty Guard' : '—')}
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
