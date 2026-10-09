/**
 * Visitor Entry & Exit Management Page
 * Handles live gate access, visitor headcounts, vehicle tracking,
 * manual visitor registration, Google Form sync, and official reports.
 */

import { useState, useEffect, useRef } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdPeople,
  MdDirectionsCar,
  MdPersonAdd,
  MdSearch,
  MdRefresh,
  MdExitToApp,
  MdCheckCircle,
  MdAccessTime,
  MdClose,
  MdPhone,
  MdApartment,
  MdKeyboardArrowDown,
} from 'react-icons/md';
import { RiFilePdf2Line, RiFileExcel2Line } from 'react-icons/ri';
import { useAuth } from '../context/AuthContext';
import { VISITOR_PURPOSES, PURPOSE_STUDENT_REQUIRED, PURPOSE_OTHER } from '../constants/visitorPurposes';
import { getHostelLabel, HOSTEL_OPTIONS } from '../utils/hostel';
import { downloadVisitorRecordsExcel } from '../utils/excelReportGenerator';
import { downloadVisitorRecordsPDF } from '../utils/pdfReportGenerator';
import { resolveBackendOrigin } from '../services/backendUrl';
import io from 'socket.io-client';

const HOSTELS = HOSTEL_OPTIONS;

export default function VisitorManagement() {
  const { user } = useAuth();
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [summary, setSummary] = useState({
    totalInside: 0,
    totalInsideHeadcount: 0,
    vehiclesInside: 0,
    totalPending: 0,
    totalPendingHeadcount: 0,
    totalToday: 0,
    totalTodayHeadcount: 0,
  });

  // Filters
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'pending' | 'inside' | 'exited'
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [purposeFilter, setPurposeFilter] = useState('all');
  const [vehicleOnlyFilter, setVehicleOnlyFilter] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [totalHeadcount, setTotalHeadcount] = useState(0);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    purpose: VISITOR_PURPOSES[0],
    purposeDetails: '',
    student_id: null,
    studentRollNo: '',
    studentName: '',
    studentHostel: HOSTELS[0].value,
    studentRoomNo: '',
    visitorCount: 1,
    hasVehicle: false,
    vehicleNumber: '',
  });

  // Student search autocomplete state (for "Meeting a student" pass creation)
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Live Clock (IST)
  const [liveClock, setLiveClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setLiveClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 280);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Debounce student search for autocomplete
  useEffect(() => {
    if (!studentQuery || studentQuery.trim().length < 2) {
      setStudentResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingStudents(true);
      try {
        const res = await api.get(`/visitors/students-search?q=${encodeURIComponent(studentQuery.trim())}`);
        if (res.data?.success) {
          setStudentResults(res.data.students || []);
        }
      } catch (err) {
        console.error('[Visitor] Student search failed:', err);
      } finally {
        setSearchingStudents(false);
      }
    }, 240);

    return () => clearTimeout(timer);
  }, [studentQuery]);

  const handleSelectStudent = (st) => {
    setSelectedStudent(st);
    setFormData((prev) => ({
      ...prev,
      student_id: st._id,
      studentName: st.name || '',
      studentRollNo: st.rollNo || '',
      studentHostel: st.hostel || prev.studentHostel,
      studentRoomNo: st.roomNo || prev.studentRoomNo,
    }));
    setStudentQuery('');
    setStudentResults([]);
  };

  const handleClearSelectedStudent = () => {
    setSelectedStudent(null);
    setFormData((prev) => ({
      ...prev,
      student_id: null,
      studentName: '',
      studentRollNo: '',
      studentRoomNo: '',
    }));
  };

  // Fetch visitors
  const fetchVisitors = async (showLoadingSpinner = false) => {
    if (showLoadingSpinner) setLoading(true);
    setIsRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (activeTab === 'pending') params.append('status', 'PENDING');
      if (activeTab === 'inside') params.append('status', 'INSIDE');
      if (activeTab === 'exited') params.append('status', 'EXITED');
      if (dateFilter) params.append('date', dateFilter);
      if (purposeFilter !== 'all') params.append('purpose', purposeFilter);
      if (vehicleOnlyFilter) params.append('hasVehicle', 'true');
      if (debouncedSearch) params.append('search', debouncedSearch);
      params.append('page', String(page));
      params.append('limit', '50');

      const res = await api.get(`/visitors?${params.toString()}`);
      if (res.data?.success) {
        setVisitors(res.data.visitors || []);
        setTotalCount(res.data.count || 0);
        setTotalHeadcount(res.data.totalHeadcount || 0);
        setHasMore(Boolean(res.data.hasMore));
        if (res.data.summary) {
          setSummary(res.data.summary);
        }
      }
    } catch (err) {
      console.error('[Visitor] Fetch error:', err);
      toast.error(err.response?.data?.message || 'Failed to load visitor logs');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchVisitors(true);
  }, [activeTab, dateFilter, purposeFilter, vehicleOnlyFilter, debouncedSearch, page]);

  // Socket.IO Real-Time Updates (Security & Staff sync)
  useEffect(() => {
    let socket;
    try {
      const backendOrigin = resolveBackendOrigin();
      socket = io(`${backendOrigin}/dashboard`, {
        transports: ['websocket', 'polling'],
        auth: { token: localStorage.getItem('token') },
      });

      socket.on('visitor:new', (data) => {
        if (data?.action === 'request') {
          toast('New visitor pass requested — awaiting student approval', { icon: '🔔', id: 'vis-new-req-toast', duration: 4000 });
        } else {
          toast.success('New visitor entry recorded!', { id: 'visitor-new-toast', duration: 2500 });
        }
        fetchVisitors(false);
      });

      socket.on('visitor:student_response', (data) => {
        const sName = data?.studentName || 'Student';
        const vName = data?.visitor?.name || 'Visitor';
        if (data?.action === 'APPROVE') {
          toast.success(`🟢 ${sName} APPROVED ${vName}'s pass! Entry permitted.`, {
            id: `vis-resp-${data?.visitor?._id}`,
            duration: 5500,
          });
        } else {
          toast.error(`🔴 ${sName} REJECTED ${vName}'s pass.`, {
            id: `vis-resp-${data?.visitor?._id}`,
            duration: 5500,
          });
        }
        fetchVisitors(false);
      });

      socket.on('visitor:update', () => {
        fetchVisitors(false);
      });

      socket.on('visitor:exit', () => {
        toast('Visitor marked as exited', { icon: '👋', id: 'visitor-exit-toast', duration: 2500 });
        fetchVisitors(false);
      });
    } catch (e) {
      console.warn('[Socket] Could not connect to dashboard namespace:', e);
    }

    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  // Handle Mark Exit
  const handleMarkExit = async (visitorId, visitorName) => {
    try {
      const res = await api.post(`/visitors/${visitorId}/exit`);
      if (res.data?.success) {
        toast.success(`${visitorName || 'Visitor'} marked as exited`);
        fetchVisitors(false);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record visitor exit');
    }
  };

  // Handle Staff Override (Admit or Reject at gate)
  const handleStaffAction = async (visitorId, action, visitorName) => {
    try {
      const res = await api.post(`/visitors/${visitorId}/staff-action`, { action });
      if (res.data?.success) {
        toast.success(`Visitor ${action === 'APPROVE' ? 'approved & admitted' : 'rejected'} by staff`);
        fetchVisitors(false);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Staff action failed');
    }
  };

  // Handle Form Submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return toast.error('Visitor name is required');
    if (!formData.phone.trim()) return toast.error('Phone number is required');

    if (formData.purpose === PURPOSE_STUDENT_REQUIRED) {
      if (!formData.studentName.trim()) return toast.error('Student name is required');
      if (!formData.studentRoomNo.trim()) return toast.error('Student room number is required');
    }

    if (formData.purpose === PURPOSE_OTHER) {
      if (!formData.purposeDetails.trim()) return toast.error('Specific reason / details is required when purpose is "Other"');
    }

    if (formData.hasVehicle) {
      const cleaned = formData.vehicleNumber.trim().toUpperCase().replace(/[\s-]/g, '');
      if (!cleaned || cleaned.length < 4 || cleaned.length > 15) {
        return toast.error('Please enter a valid vehicle registration number (4-15 characters)');
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        purpose: formData.purpose,
        purposeDetails: formData.purposeDetails.trim(),
        student_id: formData.purpose === PURPOSE_STUDENT_REQUIRED ? formData.student_id : null,
        studentName: formData.purpose === PURPOSE_STUDENT_REQUIRED ? formData.studentName.trim() : '',
        studentRollNo: formData.purpose === PURPOSE_STUDENT_REQUIRED ? formData.studentRollNo.trim() : '',
        studentHostel: formData.purpose === PURPOSE_STUDENT_REQUIRED ? formData.studentHostel : '',
        studentRoomNo: formData.purpose === PURPOSE_STUDENT_REQUIRED ? formData.studentRoomNo.trim() : '',
        visitorCount: parseInt(formData.visitorCount, 10) || 1,
        hasVehicle: formData.hasVehicle,
        vehicleNumber: formData.hasVehicle ? formData.vehicleNumber.trim().toUpperCase().replace(/[\s-]/g, '') : null,
      };

      const res = await api.post('/visitors', payload);
      if (res.data?.success) {
        toast.success(res.data?.message || `Visitor pass issued! Pass #${res.data.visitor?.passNumber || ''}`);
        setIsModalOpen(false);
        setFormData({
          name: '',
          phone: '',
          purpose: VISITOR_PURPOSES[0],
          purposeDetails: '',
          student_id: null,
          studentRollNo: '',
          studentName: '',
          studentHostel: HOSTELS[0].value,
          studentRoomNo: '',
          visitorCount: 1,
          hasVehicle: false,
          vehicleNumber: '',
        });
        setSelectedStudent(null);
        setStudentQuery('');
        fetchVisitors(false);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to register visitor');
    } finally {
      setSubmitting(false);
    }
  };

  // Export to Excel
  const handleExportExcel = async (asCsv = false) => {
    try {
      const toastId = toast.loading(`Preparing ${asCsv ? 'CSV' : 'Excel'} visitor report...`);
      const exportRes = await api.get('/visitors/export-data', {
        params: {
          date: dateFilter || undefined,
          status: activeTab !== 'all' ? activeTab.toUpperCase() : undefined,
          purpose: purposeFilter !== 'all' ? purposeFilter : undefined,
          hasVehicle: vehicleOnlyFilter ? 'true' : undefined,
        },
      });

      const records = exportRes.data?.records || visitors;
      await downloadVisitorRecordsExcel({
        visitorLogs: records,
        user,
        dateFilter,
        statusFilter: activeTab,
        asCsv,
      });

      toast.success(`${asCsv ? 'CSV' : 'Excel'} downloaded successfully!`, { id: toastId });
    } catch (err) {
      toast.error(err.message || 'Export failed');
    }
  };

  // Export to PDF
  const handleExportPDF = async () => {
    try {
      const toastId = toast.loading('Compiling visitor audit report (PDF)...');
      const exportRes = await api.get('/visitors/export-data', {
        params: {
          date: dateFilter || undefined,
          status: activeTab !== 'all' ? activeTab.toUpperCase() : undefined,
          purpose: purposeFilter !== 'all' ? purposeFilter : undefined,
          hasVehicle: vehicleOnlyFilter ? 'true' : undefined,
        },
      });

      const reportData = exportRes.data;
      await downloadVisitorRecordsPDF(reportData);
      toast.success('Official PDF report generated successfully!', { id: toastId });
    } catch (err) {
      toast.error(err.message || 'PDF generation failed');
    }
  };

  return (
    <div className="fade-in">
      <Navbar title="Visitor Entry & Exit Management" />
      <div className="page-area">

        {/* ── Section Header ── */}
        <div className="section-header">
          <div>
            <div className="section-title">
              <MdPeople size={24} style={{ color: 'var(--primary)' }} /> Visitor Entry & Access Control
            </div>
            <div className="section-subtitle">
              Manage campus guests, track real-time headcounts, log vehicles, and verify exits
            </div>
          </div>
          <div className="section-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="live-clock-badge" title="Campus Gate Master Clock (Asia/Kolkata)">
              <MdAccessTime size={16} />
              <span>{liveClock.toLocaleTimeString('en-IN', { hour12: false })} IST</span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsModalOpen(true)}
              id="btn-add-visitor"
            >
              <MdPersonAdd size={18} />
              <span>Add Visitor Pass</span>
            </button>
          </div>
        </div>

        {/* ── KPI Stat Cards ── */}
        <div className="stats-grid">
          <div
            className={`stat-card ${summary.totalPending > 0 ? 'warning' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => { setActiveTab('pending'); setPage(1); }}
            title="Filter passes awaiting student approval"
          >
            <div className="stat-edge-glow" />
            <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
              <MdAccessTime size={22} />
            </div>
            <div className="stat-value" id="kpi-pending-count">{summary.totalPending || 0}</div>
            <div className="stat-label">Pending Student Approval</div>
          </div>

          <div className="stat-card success" style={{ cursor: 'pointer' }} onClick={() => { setActiveTab('inside'); setPage(1); }}>
            <div className="stat-edge-glow" />
            <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
              <MdPeople size={22} />
            </div>
            <div className="stat-value" id="kpi-inside-headcount">{summary.totalInsideHeadcount}</div>
            <div className="stat-label">People Inside ({summary.totalInside} passes)</div>
          </div>

          <div className="stat-card" style={{ cursor: 'default' }}>
            <div className="stat-edge-glow" />
            <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1' }}>
              <MdCheckCircle size={22} />
            </div>
            <div className="stat-value">{summary.totalInside}</div>
            <div className="stat-label">Active Inside Passes</div>
          </div>

          <div className="stat-card warning" style={{ cursor: 'default' }}>
            <div className="stat-edge-glow" />
            <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
              <MdDirectionsCar size={22} />
            </div>
            <div className="stat-value">{summary.vehiclesInside}</div>
            <div className="stat-label">Vehicles On Campus</div>
          </div>

          <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => { setActiveTab('all'); setPage(1); }}>
            <div className="stat-edge-glow" />
            <div className="stat-icon" style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4' }}>
              <MdAccessTime size={22} />
            </div>
            <div className="stat-value">{summary.totalTodayHeadcount}</div>
            <div className="stat-label">Today's Total Headcount ({summary.totalToday} entries)</div>
          </div>
        </div>

        {/* ── Controls Bar: Tabs, Search, Filters & Export ── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="visitor-controls-header">
            {/* Tab Filter */}
            <div className="visitor-tabs-wrap">
              <div className="tabs">
                <button
                  type="button"
                  className={`tab ${activeTab === 'all' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('all'); setPage(1); }}
                >
                  All Logs ({summary.totalToday})
                </button>
                <button
                  type="button"
                  className={`tab ${activeTab === 'pending' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('pending'); setPage(1); }}
                  style={{ position: 'relative' }}
                >
                  Pending Approval
                  {summary.totalPending > 0 && (
                    <span style={{
                      marginLeft: 6,
                      background: '#f59e0b',
                      color: '#000',
                      borderRadius: '10px',
                      padding: '1px 6px',
                      fontSize: 11,
                      fontWeight: 800,
                    }}>
                      {summary.totalPending}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={`tab ${activeTab === 'inside' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('inside'); setPage(1); }}
                >
                  Inside ({summary.totalInsideHeadcount} People)
                </button>
                <button
                  type="button"
                  className={`tab ${activeTab === 'exited' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('exited'); setPage(1); }}
                >
                  Exited
                </button>
              </div>
            </div>

            {/* Export Actions */}
            <div className="visitor-export-actions">
              <button
                type="button"
                className="btn-pill-light"
                onClick={handleExportPDF}
                title="Download institutional printable PDF report"
              >
                <RiFilePdf2Line size={17} color="#ef4444" />
                <span>Export PDF</span>
              </button>
              <button
                type="button"
                className="btn-pill-light"
                onClick={() => handleExportExcel(false)}
                title="Download formatted Excel spreadsheet with Headcount summary"
              >
                <RiFileExcel2Line size={17} color="#10b981" />
                <span>Export Excel</span>
              </button>
              <button
                type="button"
                className="btn-pill-dark"
                onClick={() => fetchVisitors(false)}
                disabled={isRefreshing}
                title="Refresh visitor logs"
              >
                <MdRefresh size={17} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
                <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            </div>
          </div>

          <div className="visitor-filters-row">
            {/* Search bar */}
            <div className="visitor-search-box">
              <MdSearch size={20} className="search-icon" style={{ position: 'absolute', left: 14, color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search by visitor name, phone, student, or vehicle number..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                id="visitor-search-input"
                style={{ width: '100%', paddingLeft: 42, paddingRight: searchTerm ? 36 : 14 }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  style={{
                    position: 'absolute',
                    right: 12,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: 2,
                  }}
                  aria-label="Clear search"
                >
                  <MdClose size={16} />
                </button>
              )}
            </div>

            <div className="visitor-filter-secondary">
              {/* Purpose Filter with Arrow Indicator */}
              <div className="select-wrapper" style={{ flex: '1 1 170px', minWidth: 140 }}>
                <select
                  className="form-select"
                  value={purposeFilter}
                  onChange={(e) => { setPurposeFilter(e.target.value); setPage(1); }}
                >
                  <option value="all">All Purposes</option>
                  {VISITOR_PURPOSES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <MdKeyboardArrowDown className="select-arrow-icon" size={18} />
              </div>

              {/* Vehicle Only Toggle */}
              <button
                type="button"
                className={`btn btn-sm ${vehicleOnlyFilter ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => { setVehicleOnlyFilter(!vehicleOnlyFilter); setPage(1); }}
                title="Filter visitors bringing vehicles"
                style={{ height: '42px', flex: '1 1 auto', justifyContent: 'center' }}
              >
                <MdDirectionsCar size={16} />
                <span>Vehicles Only</span>
              </button>
            </div>

            {/* Date Filter */}
            <div className="visitor-date-group">
              <input
                type="date"
                className="form-input"
                value={dateFilter}
                onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
                style={{ flex: 1, minWidth: 130 }}
              />
              {dateFilter && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setDateFilter(''); setPage(1); }}
                  title="Clear date filter"
                  style={{ flexShrink: 0 }}
                >
                  Clear Date
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Table & List Area ── */}
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-page" style={{ padding: '60px 0' }}>
              <div className="loading-spinner" style={{ width: 40, height: 40 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>Loading visitor records...</span>
            </div>
          ) : visitors.length === 0 ? (
            <div className="empty-state" style={{ padding: '60px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 50, marginBottom: 12 }}>👥</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>No visitor records found</div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 16 }}>
                {debouncedSearch || dateFilter || purposeFilter !== 'all' || vehicleOnlyFilter
                  ? 'Try adjusting your search filters.'
                  : 'No visitors have been recorded yet.'}
              </p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setIsModalOpen(true)}>
                <MdPersonAdd size={16} /> Add First Visitor
              </button>
            </div>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>Visitor & Phone</th>
                    <th style={{ textAlign: 'center' }}>Visitors</th>
                    <th>Vehicle No</th>
                    <th>Purpose & Host / Details</th>
                    <th>Entry Time</th>
                    <th>Exit / Status</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visitors.map((log, idx) => {
                    const isInside = log.status === 'INSIDE';
                    return (
                      <tr key={log._id || idx} style={{ background: isInside ? 'rgba(16, 185, 129, 0.03)' : undefined }}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          {(page - 1) * 50 + idx + 1}
                        </td>

                        {/* Visitor Name & Phone */}
                        <td>
                          <div className="visitor-profile">
                            <div className="user-avatar" style={{ width: 36, height: 36, fontSize: 14 }}>
                              {log.name?.charAt(0).toUpperCase() || 'V'}
                            </div>
                            <div className="visitor-meta">
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{log.name}</span>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                <MdPhone size={12} /> {log.phone}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Visitors Count Badge */}
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${log.visitorCount > 1 ? 'badge-progress' : 'badge-out'}`}>
                            👥 {log.visitorCount || 1}
                          </span>
                        </td>

                        {/* Vehicle Number Badge */}
                        <td>
                          {log.hasVehicle && log.vehicleNumber ? (
                            <span className="vehicle-badge">
                              <MdDirectionsCar size={13} />
                              <span>{log.vehicleNumber}</span>
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>
                          )}
                        </td>

                        {/* Purpose & Host Info */}
                        <td>
                          <div className="purpose-info" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{log.purpose}</span>
                            {log.purpose === PURPOSE_STUDENT_REQUIRED && (
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <MdApartment size={13} color="#6366f1" />
                                  <span>
                                    <strong>{log.studentName}</strong>
                                    {log.studentRollNo ? ` (${log.studentRollNo})` : ''} · {getHostelLabel(log.studentHostel)}, Rm {log.studentRoomNo || '—'}
                                  </span>
                                </div>
                                {/* Approval Badge */}
                                {log.studentApprovalStatus === 'PENDING' && (
                                  <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: '#f59e0b',
                                    background: 'rgba(245, 158, 11, 0.1)',
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    width: 'fit-content',
                                  }}>
                                    🟡 Awaiting Student Approval
                                  </span>
                                )}
                                {log.studentApprovalStatus === 'APPROVED' && (
                                  <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: '#10b981',
                                    background: 'rgba(16, 185, 129, 0.1)',
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    width: 'fit-content',
                                  }}>
                                    🟢 Approved by Student
                                    {log.studentApprovalTime && ` (${new Date(log.studentApprovalTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})`}
                                  </span>
                                )}
                                {log.studentApprovalStatus === 'REJECTED' && (
                                  <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: '#ef4444',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    width: 'fit-content',
                                  }}>
                                    🔴 Rejected by Student
                                    {log.studentApprovalRemarks && ` (${log.studentApprovalRemarks})`}
                                  </span>
                                )}
                              </div>
                            )}
                            {log.purposeDetails && (
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                📝 {log.purposeDetails}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Entry Time */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                              {log.entryTime
                                ? new Date(log.entryTime).toLocaleTimeString('en-IN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: false,
                                  })
                                : (log.status === 'PENDING' ? 'Awaiting…' : '—')}
                            </span>
                            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{log.date || '—'}</span>
                          </div>
                        </td>

                        {/* Exit Time / Status */}
                        <td>
                          {log.status === 'PENDING' ? (
                            <span className="badge badge-pending" style={{
                              background: 'rgba(245, 158, 11, 0.15)',
                              color: '#f59e0b',
                              border: '1px solid rgba(245, 158, 11, 0.35)',
                              fontWeight: 700,
                            }}>
                              ⏳ PENDING APPROVAL
                            </span>
                          ) : log.status === 'REJECTED' ? (
                            <span className="badge badge-out" style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              color: '#ef4444',
                              border: '1px solid rgba(239, 68, 68, 0.35)',
                              fontWeight: 700,
                            }}>
                              ✕ REJECTED
                            </span>
                          ) : isInside ? (
                            <span className="badge badge-in">
                              ● INSIDE
                            </span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span className="badge badge-pending">EXITED</span>
                              <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                                {log.exitTime
                                  ? new Date(log.exitTime).toLocaleTimeString('en-IN', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: false,
                                    })
                                  : '—'}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Actions */}
                        <td style={{ textAlign: 'right' }}>
                          {log.status === 'PENDING' ? (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{
                                  background: '#10b981',
                                  color: '#fff',
                                  border: 'none',
                                  padding: '5px 10px',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  borderRadius: 8,
                                }}
                                onClick={() => handleStaffAction(log._id, 'APPROVE', log.name)}
                                title="Staff Override: Admit Visitor"
                              >
                                Admit
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                style={{
                                  color: '#ef4444',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  padding: '5px 10px',
                                  fontSize: 12,
                                  borderRadius: 8,
                                }}
                                onClick={() => handleStaffAction(log._id, 'REJECT', log.name)}
                                title="Staff Override: Reject Visitor"
                              >
                                Deny
                              </button>
                            </div>
                          ) : isInside ? (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm btn-mark-exit"
                              onClick={() => handleMarkExit(log._id, log.name)}
                              title="Mark visitor as EXITED"
                            >
                              <MdExitToApp size={15} />
                              <span>Mark Exit</span>
                            </button>
                          ) : log.status === 'REJECTED' ? (
                            <span style={{ color: '#ef4444', fontSize: 12.5, fontWeight: 600 }}>Declined</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>Completed</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination / Total count footer bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Showing {visitors.length} of {totalCount} records (Headcount:{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>{totalHeadcount} people</strong>)
                </span>

                {hasMore && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={loading}
                  >
                    Load Next Page
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Add Visitor Modal ── */}
        {isModalOpen && (
          <div className="modal-backdrop" onClick={() => !submitting && setIsModalOpen(false)}>
            <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title-group">
                  <div className="modal-title-icon">
                    <MdPersonAdd size={22} />
                  </div>
                  <div>
                    <h3>Issue Visitor Pass</h3>
                    <p className="modal-subtitle">Register guest entry at campus gate</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitting}
                  aria-label="Close modal"
                >
                  <MdClose size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit}>
                {/* Purpose Selector */}
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Purpose of Visit *</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      Select dropdown <MdKeyboardArrowDown size={15} />
                    </span>
                  </label>
                  <div className="select-wrapper">
                    <select
                      className="form-select"
                      value={formData.purpose}
                      onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                      required
                      id="visitor-purpose-select"
                    >
                      {VISITOR_PURPOSES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <MdKeyboardArrowDown className="select-arrow-icon" size={20} />
                  </div>
                </div>

                {/* Student Details (if purpose is 'Meeting a student') */}
                {formData.purpose === PURPOSE_STUDENT_REQUIRED && (
                  <div className="form-section-highlight" style={{
                    background: 'rgba(99, 102, 241, 0.05)',
                    border: '1.5px solid rgba(99, 102, 241, 0.25)',
                    borderRadius: 14,
                    padding: '16px',
                    marginBottom: '16px',
                  }}>
                    <div className="modal-inner-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
                      <MdApartment size={18} color="#6366f1" /> Select Registered Student (for real-time approval)
                    </div>

                    {/* Search Box / Selected Student Chip */}
                    {selectedStudent ? (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: 10,
                        background: 'rgba(16, 185, 129, 0.12)',
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        marginBottom: 12,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: '#10b981',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: 13,
                          }}>
                            {selectedStudent.name?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>
                              {selectedStudent.name} {selectedStudent.rollNo ? `(${selectedStudent.rollNo})` : ''}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {getHostelLabel(selectedStudent.hostel)}, Room {selectedStudent.roomNo || 'N/A'} • {selectedStudent.email}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={handleClearSelectedStudent}
                          style={{ fontSize: 12, color: 'var(--text-muted)' }}
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <div style={{ position: 'relative', marginBottom: 12 }}>
                        <label className="form-label">
                          Search Student by Name or Roll No
                        </label>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <MdSearch size={18} style={{ position: 'absolute', left: 12, color: 'var(--text-muted)', pointerEvents: 'none' }} />
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Type student name or roll number to search..."
                            value={studentQuery}
                            onChange={(e) => setStudentQuery(e.target.value)}
                            style={{ paddingLeft: 38 }}
                          />
                          {searchingStudents && (
                            <span style={{ position: 'absolute', right: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                              Searching...
                            </span>
                          )}
                        </div>

                        {/* Dropdown Suggestions */}
                        {studentResults.length > 0 && (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            zIndex: 50,
                            background: 'var(--bg-card, #1e293b)',
                            border: '1px solid var(--border-color, #334155)',
                            borderRadius: 10,
                            boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
                            maxHeight: 210,
                            overflowY: 'auto',
                            marginTop: 4,
                          }}>
                            {studentResults.map((st) => (
                              <div
                                key={st._id}
                                onClick={() => handleSelectStudent(st)}
                                style={{
                                  padding: '10px 14px',
                                  cursor: 'pointer',
                                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                                  transition: 'background 0.15s ease',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99, 102, 241, 0.15)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                                    {st.name} {st.rollNo ? `(${st.rollNo})` : ''}
                                  </div>
                                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                                    {st.email}
                                  </div>
                                </div>
                                <span className="badge badge-pending" style={{ fontSize: 11 }}>
                                  {getHostelLabel(st.hostel)} · Rm {st.roomNo || '—'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="form-grid-3">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Student Name *</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. Rahul Sharma"
                          value={formData.studentName}
                          onChange={(e) => setFormData({ ...formData, studentName: e.target.value })}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Hostel *</label>
                        <div className="select-wrapper">
                          <select
                            className="form-select"
                            value={formData.studentHostel}
                            onChange={(e) => setFormData({ ...formData, studentHostel: e.target.value })}
                            required
                          >
                            {HOSTELS.map((h) => (
                              <option key={h.value} value={h.value}>{h.label}</option>
                            ))}
                          </select>
                          <MdKeyboardArrowDown className="select-arrow-icon" size={18} />
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Room No *</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. B-204"
                          value={formData.studentRoomNo}
                          onChange={(e) => setFormData({ ...formData, studentRoomNo: e.target.value })}
                          required
                        />
                      </div>
                    </div>

                    <div style={{ fontSize: 11.5, color: '#6366f1', marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>🔔</span>
                      <span>
                        {formData.student_id
                          ? 'Linked to student account: Instant approval request popup will be sent to this student.'
                          : 'Tip: Search and select the student above so they receive the approval popup on their dashboard.'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Other Note */}
                {formData.purpose === PURPOSE_OTHER && (
                  <div className="form-group">
                    <label className="form-label">
                      Specific Reason / Details <span style={{ color: 'var(--danger, #ef4444)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Please explain the specific reason for your visit..."
                      value={formData.purposeDetails}
                      onChange={(e) => setFormData({ ...formData, purposeDetails: e.target.value })}
                      maxLength={120}
                      required
                    />
                  </div>
                )}

                {/* Visitor Contact Info */}
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Visitor Full Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Ramesh Patel"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Mobile Number *</label>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="10-digit number e.g. 9876543210"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* Visitor Count (Headcount) */}
                <div className="form-group">
                  <label className="form-label">
                    Number of Visitors (Total Headcount) *
                  </label>
                  <div className="headcount-input-wrapper">
                    <input
                      type="number"
                      className="form-input"
                      min={1}
                      max={20}
                      value={formData.visitorCount}
                      onChange={(e) =>
                        setFormData({ ...formData, visitorCount: Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)) })
                      }
                      required
                    />
                    <span className="input-hint">People entering together (1 to 20)</span>
                  </div>
                </div>

                {/* Vehicle Toggle */}
                <div className="vehicle-toggle-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="toggle-label-group">
                      <MdDirectionsCar size={18} className="toggle-icon" />
                      <div>
                        <div className="toggle-title">Are you bringing a vehicle?</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          Four-wheeler or two-wheeler entering campus
                        </div>
                      </div>
                    </div>

                    <div className="segmented-switch">
                      <button
                        type="button"
                        className={`switch-option ${!formData.hasVehicle ? 'active' : ''}`}
                        onClick={() => setFormData({ ...formData, hasVehicle: false, vehicleNumber: '' })}
                      >
                        No
                      </button>
                      <button
                        type="button"
                        className={`switch-option ${formData.hasVehicle ? 'active' : ''}`}
                        onClick={() => setFormData({ ...formData, hasVehicle: true })}
                      >
                        Yes
                      </button>
                    </div>
                  </div>

                  {/* Vehicle Number input - revealed only when hasVehicle is true */}
                  {formData.hasVehicle && (
                    <div className="vehicle-input-reveal">
                      <label className="form-label">
                        Vehicle Registration Number *
                      </label>
                      <input
                        type="text"
                        className="form-input uppercase-input"
                        placeholder="e.g. MH12AB1234 or DL01C1234"
                        value={formData.vehicleNumber}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            vehicleNumber: e.target.value.toUpperCase().replace(/[\s-]/g, ''),
                          })
                        }
                        maxLength={15}
                        required
                      />
                      <span className="input-hint">
                        Alphanumeric (4-15 characters). Spaces and hyphens will be stripped.
                      </span>
                    </div>
                  )}
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setIsModalOpen(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submitting}
                  >
                    {submitting ? 'Checking In...' : 'Confirm & Check-In'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
