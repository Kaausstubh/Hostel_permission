/**
 * Scan Logs Page — In/Out history table (Warden & Security)
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { 
  MdHistory, MdRefresh, MdDeleteOutline, 
  MdStorage, MdWarning, MdCheckCircle, MdSecurity, 
  MdDeleteSweep, MdClose, MdInfoOutline, MdAccessTime 
} from 'react-icons/md';
import { RiFilePdf2Line, RiFileExcel2Line, RiArrowDownSFill, RiDeleteBinLine } from 'react-icons/ri';
import { useAuth } from '../context/AuthContext';
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

  const [storageStats, setStorageStats] = useState(() => {
    try {
      const cached = sessionStorage.getItem('storage_stats_cache');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [storageLoading, setStorageLoading] = useState(false);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeCutoffDate, setPurgeCutoffDate] = useState('');
  const [purgeScope, setPurgeScope] = useState('all');
  const [purging, setPurging] = useState(false);

  const fetchStorageStats = async () => {
    try {
      setStorageLoading(true);
      const res = await api.get('/inout/storage-stats');
      if (res.data?.success) {
        setStorageStats(res.data);
        try {
          sessionStorage.setItem('storage_stats_cache', JSON.stringify(res.data));
          sessionStorage.setItem('storage_stats_cache_time', String(Date.now()));
        } catch {}
      }
    } catch (err) {
      console.error('Failed to load storage stats:', err);
    } finally {
      setStorageLoading(false);
    }
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
      fetchStorageStats().catch(() => {});
    } catch (err) {
      toast.error('Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => { 
    fetchLogs(activeTab);
    fetchStorageStats();
  }, [dateFilter, statusFilter, activeTab]);

  const handlePurgeLogs = async () => {
    if (!purgeCutoffDate) {
      toast.error('Please select a cutoff date (YYYY-MM-DD)');
      return;
    }
    try {
      setPurging(true);
      let successMsg = '';
      if (purgeScope === 'gate' || purgeScope === 'all') {
        const res1 = await api.post('/inout/purge', { cutoffDate: purgeCutoffDate });
        successMsg = res1.data?.message || 'Purged gate logs';
      }
      if (purgeScope === 'home' || purgeScope === 'all') {
        const res2 = await api.post('/homevisit/purge', { cutoffDate: purgeCutoffDate });
        successMsg = (successMsg ? successMsg + ' • ' : '') + (res2.data?.message || 'Purged home visits');
      }
      toast.success(successMsg || 'Purged successfully');
      setPurgeModalOpen(false);
      setPurgeCutoffDate('');
      await fetchLogs();
      await fetchStorageStats();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Purge failed');
    } finally {
      setPurging(false);
    }
  };

  const handleExportPDF = async () => {
    const currentRecords = activeTab === 'gate' ? logs : homeLogs;
    if (!currentRecords || currentRecords.length === 0) {
      toast.error('No records available for the selected filters to generate PDF');
      return;
    }

    try {
      setExportingPdf(true);
      const { downloadGateRecordsPDF, generatePDFFromLocalLogs } = await import('../utils/pdfReportGenerator');
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
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const excelMenuRef = useRef(null);
  const buttonGroupRef = useRef(null);

  const updateMenuPosition = () => {
    if (buttonGroupRef.current) {
      const rect = buttonGroupRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 8,
        right: Math.max(16, window.innerWidth - rect.right),
      });
    }
  };

  const toggleExcelMenu = (e) => {
    e.stopPropagation();
    if (!excelMenuOpen) {
      updateMenuPosition();
      setExcelMenuOpen(true);
    } else {
      setExcelMenuOpen(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        excelMenuRef.current &&
        !excelMenuRef.current.contains(e.target) &&
        buttonGroupRef.current &&
        !buttonGroupRef.current.contains(e.target)
      ) {
        setExcelMenuOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      setExcelMenuOpen(false);
    };

    if (excelMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScrollOrResize, true);
      window.addEventListener('resize', handleScrollOrResize);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
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

      const { downloadGateRecordsExcel } = await import('../utils/excelReportGenerator');
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

        <div className="section-header" style={{ position: 'relative', zIndex: excelMenuOpen ? 150 : 20 }}>
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
                      const res = await api.delete('/inout');
                      toast.success(res.data?.message || 'All gate scan logs deleted successfully');
                      await fetchLogs('gate');
                      await fetchStorageStats();
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
                      const res = await api.delete('/homevisit');
                      toast.success(res.data?.message || 'All home visit records deleted successfully');
                      await fetchLogs('home');
                      await fetchStorageStats();
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

            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <div ref={buttonGroupRef} className="btn-pill-light-group">
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
                  onClick={toggleExcelMenu}
                  disabled={exportingExcel || loading || clearing}
                  title="Export options"
                  aria-expanded={excelMenuOpen}
                >
                  <RiArrowDownSFill size={16} color="#475569" />
                </button>
              </div>

              {excelMenuOpen && typeof document !== 'undefined' && createPortal(
                <div
                  ref={excelMenuRef}
                  className="excel-export-dropdown fade-in"
                  style={{
                    position: 'fixed',
                    top: `${menuPosition.top}px`,
                    right: `${menuPosition.right}px`,
                    zIndex: 99999999,
                    pointerEvents: 'auto',
                  }}
                >
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
                </div>,
                document.body
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

        {/* ── Storage Capacity & Memory Alert Card for Hostel Staff ── */}
        <div
          className="card fade-in"
          style={{
            marginBottom: 16,
            padding: '16px 20px',
            background: 'var(--bg-card)',
            border: storageStats?.total?.alertLevel === 'CRITICAL'
              ? '1.5px solid #ef4444'
              : storageStats?.total?.alertLevel === 'WARNING'
                ? '1.5px solid #f59e0b'
                : '1px solid var(--border)',
            boxShadow: storageStats?.total?.alertLevel === 'CRITICAL'
              ? '0 0 20px rgba(239, 68, 68, 0.15)'
              : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: storageStats?.total?.alertLevel === 'CRITICAL'
                  ? 'rgba(239, 68, 68, 0.15)'
                  : storageStats?.total?.alertLevel === 'WARNING'
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'rgba(99, 102, 241, 0.15)',
                color: storageStats?.total?.alertLevel === 'CRITICAL'
                  ? '#ef4444'
                  : storageStats?.total?.alertLevel === 'WARNING'
                    ? '#f59e0b'
                    : 'var(--primary)',
              }}>
                <MdStorage size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Log Storage & System Memory</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 99,
                      background: storageStats?.total?.alertLevel === 'CRITICAL'
                        ? 'rgba(239, 68, 68, 0.2)'
                        : storageStats?.total?.alertLevel === 'WARNING'
                          ? 'rgba(245, 158, 11, 0.2)'
                          : 'rgba(16, 185, 129, 0.2)',
                      color: storageStats?.total?.alertLevel === 'CRITICAL'
                        ? '#ef4444'
                        : storageStats?.total?.alertLevel === 'WARNING'
                          ? '#f59e0b'
                          : '#10b981',
                      border: storageStats?.total?.alertLevel === 'CRITICAL'
                        ? '1px solid rgba(239, 68, 68, 0.4)'
                        : storageStats?.total?.alertLevel === 'WARNING'
                          ? '1px solid rgba(245, 158, 11, 0.4)'
                          : '1px solid rgba(16, 185, 129, 0.4)',
                    }}
                  >
                    {storageStats?.total?.alertLevel === 'CRITICAL'
                      ? '🚨 CRITICAL ALERT (90%+ Used)'
                      : (storageStats?.total?.isOver80Percent || storageStats?.total?.percentUsed >= 80)
                        ? '⚠️ STORAGE LIMIT ALERT (≥80% / 400 MB)'
                        : '✅ Memory Healthy'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Active institutional logs memory consumption (500 MB capacity quota, 400 MB warning limit)
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {isWarden && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => window.dispatchEvent(new CustomEvent('open-storage-limit-modal'))}
                    style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, color: '#f87171' }}
                    title="View 80% (400 MB) Storage Limit Pop-Up Alert"
                  >
                    <MdWarning size={16} color="#ef4444" />
                    <span>80% Alert Pop-up</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPurgeModalOpen(true)}
                    style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    title="Purge logs older than a specific date to free memory"
                  >
                    <MdDeleteSweep size={16} color="#f59e0b" />
                    <span>Purge by Date</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAuditModalOpen(true)}
                    style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    title="View audit trail of which hostel staff member deleted logs"
                  >
                    <MdSecurity size={16} color="var(--primary-light)" />
                    <span>Deletion Audit Trail ({storageStats?.recentAudits?.length || 0})</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Memory Bar */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                Total Memory Stored: <strong style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {storageStats?.total?.sizeFormatted || '—'}
                </strong> of {storageStats?.total?.quotaFormatted || '50 MB'}
              </span>
              <span style={{
                fontWeight: 700,
                fontFamily: 'JetBrains Mono, monospace',
                color: storageStats?.total?.alertLevel === 'CRITICAL'
                  ? '#ef4444'
                  : storageStats?.total?.alertLevel === 'WARNING'
                    ? '#f59e0b'
                    : '#10b981',
              }}>
                {storageStats?.total?.percentUsed || 0}% used
              </span>
            </div>

            <div style={{
              width: '100%',
              height: 8,
              borderRadius: 99,
              background: 'rgba(255, 255, 255, 0.08)',
              overflow: 'hidden',
            }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, Math.max(1, storageStats?.total?.percentUsed || 0))}%`,
                  borderRadius: 99,
                  background: storageStats?.total?.alertLevel === 'CRITICAL'
                    ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                    : storageStats?.total?.alertLevel === 'WARNING'
                      ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                      : 'linear-gradient(90deg, #10b981, #059669)',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>

          {/* Breakdown Pills */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 10,
            fontSize: 12,
          }}>
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }}>
              <div style={{ color: 'var(--text-muted)' }}>Gate In/Out Logs:</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>
                <span style={{ color: '#3b82f6', fontFamily: 'JetBrains Mono, monospace' }}>
                  {storageStats?.inOut?.count ?? logs.length} records
                </span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> • {storageStats?.inOut?.sizeFormatted || '—'}</span>
              </div>
            </div>

            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }}>
              <div style={{ color: 'var(--text-muted)' }}>Home Visit Records:</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>
                <span style={{ color: '#10b981', fontFamily: 'JetBrains Mono, monospace' }}>
                  {storageStats?.homeVisit?.count ?? homeLogs.length} records
                </span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> • {storageStats?.homeVisit?.sizeFormatted || '—'}</span>
              </div>
            </div>

            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }}>
              <div style={{ color: 'var(--text-muted)' }}>Alert Threshold & Quota:</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>
                <span>Alert at 75% • Critical at 90%</span>
              </div>
            </div>
          </div>

          {/* Last deletion notice if present */}
          {storageStats?.recentAudits && storageStats.recentAudits.length > 0 && (
            <div style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              color: 'var(--text-muted)',
              flexWrap: 'wrap',
              gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <MdAccessTime size={14} color="var(--primary-light)" />
                <span>
                  Last log deletion: <strong style={{ color: 'var(--text-primary)' }}>
                    {storageStats.recentAudits[0].deletedByName}
                  </strong> ({storageStats.recentAudits[0].deletedByRole}) removed {storageStats.recentAudits[0].deletedCount} records on {new Date(storageStats.recentAudits[0].timestamp).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })} at {new Date(storageStats.recentAudits[0].timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} IST
                </span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => setAuditModalOpen(true)}
              >
                View Full Log
              </button>
            </div>
          )}

          {/* High memory alert banner */}
          {storageStats?.total?.isAlert && (
            <div style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 8,
              background: storageStats.total.alertLevel === 'CRITICAL' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
              border: storageStats.total.alertLevel === 'CRITICAL' ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(245, 158, 11, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              color: storageStats.total.alertLevel === 'CRITICAL' ? '#ef4444' : '#f59e0b',
            }}>
              <MdWarning size={18} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>{storageStats.total.alertMessage}</div>
              <button
                type="button"
                className="btn btn-sm btn-warning"
                onClick={() => setPurgeModalOpen(true)}
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              >
                Purge Old Logs
              </button>
            </div>
          )}
        </div>

        <div className="tabs" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`tab ${activeTab === 'gate' ? 'active' : ''}`}
            onClick={() => setActiveTab('gate')}
          >
            Gate Scan Logs ({logs.length})
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => setActiveTab('home')}
          >
            Home Visit Records ({homeLogs.length})
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
                        ? new Date(log.out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                        : (log.status === 'OUT' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—')}
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                      {log.in_time
                        ? new Date(log.in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                        : (log.status === 'IN' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—')}
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
                      {visit.actual_out_time ? new Date(visit.actual_out_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—'}
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                      {visit.actual_in_time ? new Date(visit.actual_in_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—'}
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

      {/* ── Purge Historical Logs Modal ── */}
      {purgeModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            background: 'var(--bg-card, #1e293b)',
            border: '1px solid var(--border, #334155)',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '520px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            padding: '24px',
            position: 'relative'
          }}>
            <button
              type="button"
              onClick={() => setPurgeModalOpen(false)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer'
              }}
            >
              <MdClose size={20} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'rgba(245, 158, 11, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f59e0b'
              }}>
                <MdDeleteSweep size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>Purge Historical Logs</h3>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                  Free up memory storage by clearing older records
                </p>
              </div>
            </div>

            {/* Scope selection */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                Purge Scope
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {[
                  { id: 'all', label: 'All Logs' },
                  { id: 'gate', label: 'Gate In/Out' },
                  { id: 'home', label: 'Home Visits' }
                ].map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPurgeScope(item.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: purgeScope === item.id ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                      background: purgeScope === item.id ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-surface, #0f172a)',
                      color: purgeScope === item.id ? 'var(--primary-light, #818cf8)' : 'var(--text-secondary)'
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Cutoff Date Picker */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                Delete records older than (Cutoff Date)
              </label>
              <input
                type="date"
                className="form-input"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px' }}
                value={purgeCutoffDate}
                onChange={(e) => setPurgeCutoffDate(e.target.value)}
              />
              {/* Presets */}
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                {[
                  { label: '30 Days Ago', days: 30 },
                  { label: '60 Days Ago', days: 60 },
                  { label: '90 Days Ago', days: 90 }
                ].map(preset => {
                  const d = new Date();
                  d.setDate(d.getDate() - preset.days);
                  const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
                  return (
                    <button
                      key={preset.days}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                      onClick={() => setPurgeCutoffDate(dateStr)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Staff Accountability Notice */}
            <div style={{
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '20px',
              fontSize: '12px',
              lineHeight: 1.5,
              color: 'var(--text-secondary)'
            }}>
              <div style={{ fontWeight: 700, color: 'var(--primary-light, #818cf8)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <MdSecurity size={15} />
                Staff Deletion Audit Recorded
              </div>
              Your account details (<strong>{user?.name || 'Staff Member'}</strong> • {user?.role?.toUpperCase()} • {user?.email}) and execution timestamp in IST will be permanently preserved in the staff audit registry.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPurgeModalOpen(false)}
                disabled={purging}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: '#f59e0b',
                  color: '#000',
                  fontWeight: 700,
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}
                disabled={!purgeCutoffDate || purging}
                onClick={handlePurgeLogs}
              >
                <MdDeleteSweep size={16} />
                {purging ? 'Purging Records...' : 'Execute Purge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Staff Deletion Audit Trail Modal ── */}
      {auditModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            background: 'var(--bg-card, #1e293b)',
            border: '1px solid var(--border, #334155)',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '860px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            position: 'relative'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  background: 'rgba(99, 102, 241, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--primary)'
                }}>
                  <MdSecurity size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>
                    Hostel Staff Log Deletion Audit Trail
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                    Tamper-proof accountability records showing which hostel staff member deleted or purged logs
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => fetchStorageStats()}
                  disabled={storageLoading}
                  title="Refresh audit records"
                >
                  <MdRefresh size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setAuditModalOpen(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer'
                  }}
                >
                  <MdClose size={20} />
                </button>
              </div>
            </div>

            {/* Modal Body / Table */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {(!storageStats?.recentAudits || storageStats.recentAudits.length === 0) ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                  <MdCheckCircle size={42} style={{ color: '#10b981', marginBottom: 10 }} />
                  <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                    No Deletions Recorded
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    All institutional gate scan logs and home visit records are pristine and intact.
                  </div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px' }}>
                        <th style={{ padding: '10px 12px' }}>Staff Member</th>
                        <th style={{ padding: '10px 12px' }}>Role</th>
                        <th style={{ padding: '10px 12px' }}>Action & Scope</th>
                        <th style={{ padding: '10px 12px' }}>Records Deleted</th>
                        <th style={{ padding: '10px 12px' }}>Timestamp (IST)</th>
                        <th style={{ padding: '10px 12px' }}>Details / Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storageStats.recentAudits.map((audit) => {
                        const istDate = audit.timestampIST || (audit.timestamp ? new Date(audit.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—');
                        return (
                          <tr key={audit._id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                              <div>{audit.deletedByName || 'Unknown Staff'}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>
                                {audit.deletedByEmail || '—'}
                              </div>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 99,
                                background: audit.deletedByRole === 'admin' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                                color: audit.deletedByRole === 'admin' ? '#ef4444' : 'var(--primary-light, #818cf8)',
                                textTransform: 'uppercase'
                              }}>
                                {audit.deletedByRole || 'STAFF'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ fontWeight: 600 }}>{audit.action || 'DELETE'}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {audit.targetType}
                              </div>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                fontWeight: 700,
                                color: '#ef4444',
                                background: 'rgba(239, 68, 68, 0.12)',
                                padding: '2px 8px',
                                borderRadius: 6
                              }}>
                                -{audit.recordsDeletedCount ?? 1}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <MdAccessTime size={13} style={{ color: 'var(--text-muted)' }} />
                                <span>{istDate}</span>
                              </div>
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)', maxWidth: 200 }}>
                              {audit.description || audit.details?.reason || 'Standard maintenance purge'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
              color: 'var(--text-muted)'
            }}>
              <span>
                Total Audit Entries: <strong>{storageStats?.recentAudits?.length || 0}</strong>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAuditModalOpen(false)}
              >
                Close Audit Trail
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
