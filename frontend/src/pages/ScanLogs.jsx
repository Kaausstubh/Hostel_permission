/**
 * Scan Logs Page — In/Out history table (Warden & Security)
 */
import { useState, useEffect, useRef } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdHistory, MdRefresh, MdDeleteOutline } from 'react-icons/md';
import { RiFilePdf2Line, RiFileExcel2Line, RiArrowDownSFill, RiDeleteBinLine } from 'react-icons/ri';
import { useAuth } from '../context/AuthContext';
import { downloadGateRecordsPDF, generatePDFFromLocalLogs } from '../utils/pdfReportGenerator';
import { downloadGateRecordsExcel } from '../utils/excelReportGenerator';
import StudentAvatar from '../components/StudentAvatar';

export default function ScanLogs({ defaultTab = 'gate' }) {
  const [logs, setLogs] = useState([]);
  const [homeLogs, setHomeLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeTab, setActiveTab] = useState(defaultTab);
  const { user } = useAuth();
  const isWarden = ['warden', 'admin'].includes(user?.role);

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

  const [exportingExcel, setExportingExcel] = useState(false);
  const [excelMenuOpen, setExcelMenuOpen] = useState(false);
  const excelMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (excelMenuRef.current && !excelMenuRef.current.contains(e.target)) {
        setExcelMenuOpen(false);
      }
    };
    if (excelMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [excelMenuOpen]);

  const handleExportExcel = async (exportScope = 'current') => {
    try {
      setExportingExcel(true);
      setExcelMenuOpen(false);

      const currentRecords = activeTab === 'gate' ? logs : homeLogs;
      if (exportScope === 'current' && (!currentRecords || currentRecords.length === 0)) {
        toast.error(`No ${activeTab === 'gate' ? 'gate scan' : 'home visit'} records available to export`);
        return;
      }
      if (exportScope === 'gate' && logs.length === 0) {
        toast.error('No gate scan records found to export');
        return;
      }
      if (exportScope === 'home' && homeLogs.length === 0) {
        toast.error('No home visit records found to export');
        return;
      }
      if (exportScope === 'all' && logs.length === 0 && homeLogs.length === 0) {
        toast.error('No scan or visit records found to export');
        return;
      }

      await downloadGateRecordsExcel({
        gateLogs: logs,
        homeLogs,
        user,
        dateFilter,
        activeTab,
        exportScope,
      });

      const label = exportScope === 'csv'
        ? 'CSV file'
        : (exportScope === 'all' ? 'Complete Master Excel workbook' : 'Excel spreadsheet');
      toast.success(`${label} downloaded successfully!`);
    } catch (err) {
      console.error('[Excel Export] Error:', err);
      toast.error(err.message || 'Failed to generate Excel export');
    } finally {
      setExportingExcel(false);
    }
  };

  const [clearing, setClearing] = useState(false);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    description: '',
    confirmTargetText: 'delete',
    onConfirm: null,
  });
  const [confirmInput, setConfirmInput] = useState('');

  return (
    <div className="fade-in">
      <Navbar title="Scan Logs" />
      <div className="page-area">

        <div className="section-header">
          <div>
            <div className="section-title">
              <MdHistory /> {activeTab === 'gate' ? 'Gate Scan Logs' : 'Home Visit Records'}
            </div>
            <div className="section-subtitle">
              {activeTab === 'gate' ? logs.length : homeLogs.length} record(s)
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {isWarden && activeTab === 'gate' && (
              <button
                type="button"
                className="btn-pill-light btn-pill-danger"
                onClick={() => {
                  setConfirmModal({
                    isOpen: true,
                    title: 'Delete All Gate Scan Logs',
                    description: `You are about to permanently delete all ${logs.length} gate scan records from the database. Student accounts and home visits remain 100% safe.`,
                    confirmTargetText: 'delete',
                    onConfirm: async () => {
                      await api.delete('/inout');
                      toast.success('All gate scan logs deleted successfully');
                      await fetchLogs('gate');
                    },
                  });
                  setConfirmInput('');
                }}
                disabled={clearing || loading || logs.length === 0}
                title="Delete all gate scan records"
              >
                <RiDeleteBinLine size={16} />
                <span>Delete All Gate Logs</span>
              </button>
            )}

            {isWarden && activeTab === 'home' && (
              <button
                type="button"
                className="btn-pill-light btn-pill-danger"
                onClick={() => {
                  setConfirmModal({
                    isOpen: true,
                    title: 'Delete All Home Visit Records',
                    description: `You are about to permanently delete all ${homeLogs.length} home visit pass records from the database. Student accounts and gate logs remain 100% safe.`,
                    confirmTargetText: 'delete',
                    onConfirm: async () => {
                      await api.delete('/homevisit');
                      toast.success('All home visit records deleted successfully');
                      await fetchLogs('home');
                    },
                  });
                  setConfirmInput('');
                }}
                disabled={clearing || loading || homeLogs.length === 0}
                title="Delete all home visit records"
              >
                <RiDeleteBinLine size={16} />
                <span>Delete All Home Visits</span>
              </button>
            )}

            <button
              type="button"
              className="btn-pill-light"
              onClick={handleExportPDF}
              disabled={exportingPdf || loading || clearing}
              title="Export official PDF report"
            >
              <RiFilePdf2Line size={17} color="#ef4444" />
              <span>{exportingPdf ? 'Exporting...' : 'Export PDF'}</span>
            </button>

            <div ref={excelMenuRef} style={{ position: 'relative', display: 'inline-flex' }}>
              <div className="btn-pill-light-group">
                <button
                  type="button"
                  className="btn-pill-light-main"
                  onClick={() => handleExportExcel('current')}
                  disabled={exportingExcel || loading || clearing}
                  title="Download Excel spreadsheet for current view"
                >
                  <RiFileExcel2Line size={17} color="#10b981" />
                  <span>{exportingExcel ? 'Exporting...' : 'Export Excel'}</span>
                </button>
                <button
                  type="button"
                  className="btn-pill-light-arrow"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExcelMenuOpen((prev) => !prev);
                  }}
                  disabled={exportingExcel || loading || clearing}
                  title="Export options"
                  aria-expanded={excelMenuOpen}
                >
                  <RiArrowDownSFill size={16} color="#475569" />
                </button>
              </div>

              {excelMenuOpen && (
                <div className="excel-export-dropdown fade-in">
                  <div className="excel-dropdown-header">Export Spreadsheet</div>
                  <button
                    type="button"
                    className="excel-dropdown-item"
                    onClick={() => handleExportExcel('current')}
                  >
                    <span className="excel-item-icon">⚡</span>
                    <div className="excel-item-body">
                      <div className="excel-item-title">Current View: {activeTab === 'gate' ? 'Gate Scan Logs' : 'Home Visit Records'}</div>
                      <div className="excel-item-desc">
                        {activeTab === 'gate' ? `${logs.length} filtered gate record(s)` : `${homeLogs.length} filtered home record(s)`} (.xlsx)
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="excel-dropdown-item"
                    onClick={() => handleExportExcel('gate')}
                  >
                    <span className="excel-item-icon">📋</span>
                    <div className="excel-item-body">
                      <div className="excel-item-title">Gate Scan Logs Only</div>
                      <div className="excel-item-desc">{logs.length} gate pass record(s) (.xlsx)</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="excel-dropdown-item"
                    onClick={() => handleExportExcel('home')}
                  >
                    <span className="excel-item-icon">🏠</span>
                    <div className="excel-item-body">
                      <div className="excel-item-title">Home Visit Records Only</div>
                      <div className="excel-item-desc">{homeLogs.length} home pass record(s) (.xlsx)</div>
                    </div>
                  </button>

                  <div className="excel-dropdown-divider" />

                  <button
                    type="button"
                    className="excel-dropdown-item"
                    onClick={() => handleExportExcel('all')}
                  >
                    <span className="excel-item-icon">📑</span>
                    <div className="excel-item-body">
                      <div className="excel-item-title">Complete Multi-Sheet Report</div>
                      <div className="excel-item-desc">Gate + Home visits + Institutional Summary (.xlsx)</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="excel-dropdown-item"
                    onClick={() => handleExportExcel('csv')}
                  >
                    <span className="excel-item-icon">📄</span>
                    <div className="excel-item-body">
                      <div className="excel-item-title">Export as CSV</div>
                      <div className="excel-item-desc">Direct CSV file for current tab (.csv)</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn-pill-dark"
              onClick={() => fetchLogs()}
              disabled={loading || clearing}
              title="Refresh logs"
            >
              <MdRefresh size={17} />
              <span>Refresh</span>
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
                  {isWarden && <th>Action</th>}
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
                    {isWarden && (
                      <td>
                        <button
                          className="btn btn-ghost btn-xs"
                          style={{ color: '#ef4444', padding: '4px 6px', display: 'inline-flex', alignItems: 'center' }}
                          title="Delete record"
                          onClick={() => {
                            const studentName = log.student_id?.name || log.name || 'Student';
                            setConfirmModal({
                              isOpen: true,
                              title: 'Delete Gate Scan Record',
                              description: `Delete gate scan record for ${studentName} (${log.status} on ${log.date})? This action cannot be undone.`,
                              confirmTargetText: 'delete',
                              onConfirm: async () => {
                                await api.delete(`/inout/${log._id}`);
                                toast.success('Gate record deleted successfully');
                                await fetchLogs('gate');
                              },
                            });
                            setConfirmInput('');
                          }}
                          disabled={clearing}
                        >
                          <MdDeleteOutline size={17} />
                        </button>
                      </td>
                    )}
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
                  {isWarden && <th>Action</th>}
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
                    {isWarden && (
                      <td>
                        <button
                          className="btn btn-ghost btn-xs"
                          style={{ color: '#ef4444', padding: '4px 6px', display: 'inline-flex', alignItems: 'center' }}
                          title="Delete record"
                          onClick={() => {
                            const studentName = visit.student_id?.name || visit.name || 'Student';
                            setConfirmModal({
                              isOpen: true,
                              title: 'Delete Home Visit Record',
                              description: `Delete home visit record for ${studentName} (${visit.leave_date} to ${visit.return_date})? This action cannot be undone.`,
                              confirmTargetText: 'delete',
                              onConfirm: async () => {
                                await api.delete(`/homevisit/${visit._id}`);
                                toast.success('Home visit record deleted successfully');
                                await fetchLogs('home');
                              },
                            });
                            setConfirmInput('');
                          }}
                          disabled={clearing}
                        >
                          <MdDeleteOutline size={17} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmModal.isOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--surface, #1e293b)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '16px',
            maxWidth: '460px',
            width: '100%',
            padding: '24px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <div style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                flexShrink: 0
              }}>
                ⚠️
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-primary, #f8fafc)' }}>
                  {confirmModal.title}
                </h3>
                <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: '600' }}>
                  Permanent Action — Cannot Be Undone
                </span>
              </div>
            </div>

            <p style={{ fontSize: '14px', color: 'var(--text-secondary, #94a3b8)', lineHeight: 1.5, marginBottom: '16px' }}>
              {confirmModal.description}
            </p>

            <div style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px dashed rgba(239, 68, 68, 0.35)',
              borderRadius: '8px',
              padding: '14px',
              marginBottom: '20px'
            }}>
              <div style={{ fontSize: '13px', color: 'var(--text-primary, #e2e8f0)', marginBottom: '8px' }}>
                To confirm this deletion, type <strong>{confirmModal.confirmTargetText}</strong> below:
              </div>
              <input
                type="text"
                className="form-input"
                style={{
                  width: '100%',
                  borderColor: confirmInput.trim().toLowerCase() === confirmModal.confirmTargetText.toLowerCase() ? '#10b981' : '#f87171',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '14px',
                  fontWeight: '600',
                  letterSpacing: '1px'
                }}
                placeholder={`Type "${confirmModal.confirmTargetText}" to confirm`}
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setConfirmModal({ isOpen: false, title: '', description: '', confirmTargetText: 'delete', onConfirm: null });
                  setConfirmInput('');
                }}
                disabled={clearing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  backgroundColor: confirmInput.trim().toLowerCase() === confirmModal.confirmTargetText.toLowerCase() ? '#ef4444' : '#64748b',
                  color: '#fff',
                  cursor: confirmInput.trim().toLowerCase() === confirmModal.confirmTargetText.toLowerCase() ? 'pointer' : 'not-allowed',
                  opacity: confirmInput.trim().toLowerCase() === confirmModal.confirmTargetText.toLowerCase() ? 1 : 0.5,
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                disabled={confirmInput.trim().toLowerCase() !== confirmModal.confirmTargetText.toLowerCase() || clearing}
                onClick={async () => {
                  try {
                    setClearing(true);
                    if (confirmModal.onConfirm) {
                      await confirmModal.onConfirm();
                    }
                    setConfirmModal({ isOpen: false, title: '', description: '', confirmTargetText: 'delete', onConfirm: null });
                    setConfirmInput('');
                  } catch (err) {
                    toast.error(err.response?.data?.message || 'Deletion failed');
                  } finally {
                    setClearing(false);
                  }
                }}
              >
                <MdDeleteOutline size={16} />
                {clearing ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
