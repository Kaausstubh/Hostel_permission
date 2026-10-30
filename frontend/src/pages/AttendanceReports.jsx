/**
 * Attendance Reports Screen
 * Comprehensive date range filters, hostel/floor/status filters,
 * live tabular breakdown, and direct one-click CSV export.
 */

import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';
import { resolveBackendOrigin } from '../services/backendUrl';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import {
  MdFileDownload,
  MdFilterList,
  MdRefresh,
  MdCheckCircle,
  MdCancel,
  MdHome,
  MdSearch,
  MdAssessment,
  MdPictureAsPdf,
  MdDeleteOutline,
  MdDeleteSweep,
  MdClose,
  MdWarningAmber,
  MdCheck,
} from 'react-icons/md';
import Navbar from '../components/Navbar';
import { downloadAttendanceReportPDF } from '../utils/pdfReportGenerator';
import { exportAttendanceToExcel } from '../utils/excelReportGenerator';

export default function AttendanceReports() {
  const { user } = useAuth();
  const todayStr = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  // Default to past 14 days so all recent records appear immediately upon opening
  const defaultStartDate = new Date(Date.now() + 5.5 * 3600 * 1000 - 14 * 86400000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(todayStr);
  const [hostel, setHostel] = useState('ALL');
  const [floor, setFloor] = useState('ALL');
  const [status, setStatus] = useState('all');
  const [studentQuery, setStudentQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [records, setRecords] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    description: '',
    confirmTargetText: '',
    onConfirm: null,
    loading: false,
  });
  const [confirmInput, setConfirmInput] = useState('');

  const fetchReports = async () => {
    try {
      setLoading(true);
      const params = {
        startDate,
        endDate,
        hostel: hostel !== 'ALL' ? hostel : undefined,
        floor: floor !== 'ALL' ? floor : undefined,
        status: status !== 'all' ? status : undefined,
        student: studentQuery.trim() || undefined,
      };
      const res = await api.get('/attendance/reports', { params });
      if (res.data?.success) {
        setRecords(res.data.records || []);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to fetch attendance reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [startDate, endDate, hostel, status]);

  // Prune any selectedIds that are no longer in records
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => records.some((r) => r.id === id)));
  }, [records]);

  // Real-time synchronization: listen for live attendance events without manual refresh
  useEffect(() => {
    let socket = null;
    try {
      const token = localStorage.getItem('token');
      const origin = resolveBackendOrigin();
      socket = io(`${origin}/dashboard`, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
      });

      socket.on('student_attendance_marked', () => {
        fetchReports();
      });
      socket.on('room_attendance_updated', () => {
        fetchReports();
      });
      socket.on('round_completed', () => {
        fetchReports();
      });
      socket.on('attendance_record_deleted', () => {
        fetchReports();
      });
    } catch (_) {}

    return () => {
      if (socket) socket.disconnect();
    };
  }, [startDate, endDate, hostel, status]);

  const handleToggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (records.length === 0) return;
    if (selectedIds.length === records.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(records.map((r) => r.id));
    }
  };

  const handleDeleteSingle = (record) => {
    const studentName = record.student?.name || record.studentName || 'Student';
    const dateDisplay = record.formattedDate || record.date;
    const statusText = (record.status || 'ABSENT').toUpperCase();

    setConfirmModal({
      isOpen: true,
      title: 'Delete Attendance Record',
      description: `Are you sure you want to delete the attendance record for ${studentName} (${statusText} on ${dateDisplay}, Room ${record.roomNo || '—'})? This action removes it permanently from the attendance ledger.`,
      confirmTargetText: '',
      onConfirm: async () => {
        try {
          setDeletingId(record.id);
          const res = await api.delete(`/attendance/records/${record.id}`);
          toast.success(res.data?.message || 'Attendance record deleted successfully');
          setSelectedIds((prev) => prev.filter((id) => id !== record.id));
          await fetchReports();
        } catch (err) {
          toast.error(err.response?.data?.message || 'Failed to delete attendance record');
        } finally {
          setDeletingId(null);
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
    setConfirmInput('');
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;

    setConfirmModal({
      isOpen: true,
      title: `Delete ${count} Selected Record${count > 1 ? 's' : ''}`,
      description: `You are about to permanently delete ${count} attendance record(s) from the database. This action cannot be undone.`,
      confirmTargetText: count > 5 ? 'delete' : '',
      onConfirm: async () => {
        try {
          setBulkDeleting(true);
          const res = await api.delete('/attendance/records', { data: { ids: selectedIds } });
          toast.success(res.data?.message || `Successfully deleted ${count} attendance record(s)`);
          setSelectedIds([]);
          await fetchReports();
        } catch (err) {
          toast.error(err.response?.data?.message || 'Failed to delete selected records');
        } finally {
          setBulkDeleting(false);
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
    setConfirmInput('');
  };

  const handleDeleteAllFiltered = () => {
    if (records.length === 0) return;
    const count = records.length;

    setConfirmModal({
      isOpen: true,
      title: `Delete All Filtered Records (${count})`,
      description: `DANGER: You are about to permanently delete all ${count} records currently displayed under these filters (${startDate} to ${endDate}, Hostel: ${hostel}, Status: ${status}). Type "delete" to confirm.`,
      confirmTargetText: 'delete',
      onConfirm: async () => {
        try {
          setBulkDeleting(true);
          const res = await api.delete('/attendance/records', {
            data: {
              deleteAllFiltered: true,
              startDate,
              endDate,
              hostel: hostel !== 'ALL' ? hostel : undefined,
              status: status !== 'all' ? status : undefined,
            },
          });
          toast.success(res.data?.message || `Successfully cleared ${count} records`);
          setSelectedIds([]);
          await fetchReports();
        } catch (err) {
          toast.error(err.response?.data?.message || 'Failed to clear filtered records');
        } finally {
          setBulkDeleting(false);
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
    setConfirmInput('');
  };

  const handleExportPdf = async () => {
    if (records.length === 0) {
      toast.error('No attendance records to export');
      return;
    }
    try {
      setExportingPdf(true);
      await downloadAttendanceReportPDF({
        records,
        startDate,
        endDate,
        hostel,
        floor,
        user,
      });
      toast.success('Attendance PDF report downloaded successfully');
    } catch (err) {
      toast.error('Failed to export PDF: ' + err.message);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    if (records.length === 0) {
      toast.error('No attendance records to export');
      return;
    }
    try {
      setExportingExcel(true);
      await exportAttendanceToExcel({
        records,
        startDate,
        endDate,
        hostel,
        floor,
      });
      toast.success('Attendance Excel report downloaded successfully');
    } catch (err) {
      toast.error('Failed to export Excel: ' + err.message);
    } finally {
      setExportingExcel(false);
    }
  };

  const presentCount = records.filter((r) => r.status === 'present').length;
  const absentCount = records.filter((r) => r.status === 'absent').length;
  const leaveCount = records.filter((r) => r.status === 'on_leave').length;
  const pendingCount = records.filter((r) => r.status === 'pending').length;

  return (
    <div className="fade-in">
      <Navbar title="Attendance Reports" />
      <div className="page-area">
        <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <MdAssessment size={26} color="var(--primary)" /> Attendance Reports & Exports
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>
            Historical audit logs, custom date ranges, and official PDF &amp; Excel exports
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={fetchReports}
            disabled={loading}
            className="secondary-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, fontSize: 13 }}
          >
            <MdRefresh size={18} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button
            onClick={handleExportPdf}
            disabled={exportingPdf || records.length === 0}
            className="secondary-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, fontSize: 13 }}
          >
            <MdPictureAsPdf size={18} style={{ color: '#ef4444' }} /> {exportingPdf ? 'Exporting PDF...' : 'Export PDF'}
          </button>
          <button
            onClick={handleExportExcel}
            disabled={exportingExcel || records.length === 0}
            className="primary-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, fontSize: 13 }}
          >
            <MdFileDownload size={18} /> {exportingExcel ? 'Exporting Excel...' : 'Export Excel'}
          </button>

          {selectedIds.length > 0 ? (
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                backgroundColor: '#ef4444',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.35)',
              }}
            >
              <MdDeleteOutline size={18} /> {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedIds.length})`}
            </button>
          ) : (
            records.length > 0 && (
              <button
                onClick={handleDeleteAllFiltered}
                disabled={bulkDeleting}
                title="Delete all records currently displayed under these filters"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  cursor: 'pointer',
                }}
              >
                <MdDeleteSweep size={18} /> Clear Filtered ({records.length})
              </button>
            )
          )}
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        <div className="metric-card" style={{ padding: '16px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL RECORDS</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: 'var(--text-primary)' }}>{records.length}</div>
        </div>
        <div className="metric-card" style={{ padding: '16px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>PRESENT</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: '#10b981' }}>{presentCount}</div>
        </div>
        <div className="metric-card" style={{ padding: '16px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>ABSENT</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: '#ef4444' }}>{absentCount}</div>
        </div>
        <div className="metric-card" style={{ padding: '16px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600 }}>ON APPROVED LEAVE</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: '#3b82f6' }}>{leaveCount}</div>
        </div>
        <div className="metric-card" style={{ padding: '16px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>PENDING</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: '#f59e0b' }}>{pendingCount}</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Hostel</label>
          <select
            value={hostel}
            onChange={(e) => setHostel(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
          >
            <option value="ALL">All Hostels</option>
            <option value="BH1">Boys' Hostel 1 (BH1)</option>
            <option value="BH2">Boys' Hostel 2 (BH2)</option>
            <option value="GH1">Girls' Hostel 1 (GH1 - Indrayani)</option>
            <option value="GH2">Girls' Hostel 2 (GH2 - Sindhu)</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Floor</label>
          <select
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
          >
            <option value="ALL">All Floors</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
          >
            <option value="all">All Statuses</option>
            <option value="present">Present Only</option>
            <option value="absent">Absent Only</option>
            <option value="on_leave">On Leave Only</option>
            <option value="pending">Pending Only</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Student Search</label>
          <input
            type="text"
            value={studentQuery}
            onChange={(e) => setStudentQuery(e.target.value)}
            placeholder="Name or Roll No..."
            onKeyDown={(e) => { if (e.key === 'Enter') fetchReports(); }}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
          />
        </div>
        <div>
          <button
            onClick={fetchReports}
            className="primary-btn"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13 }}
          >
            <MdSearch size={18} /> Filter
          </button>
        </div>
      </div>

      {/* Selection Info Banner */}
      {selectedIds.length > 0 && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 10,
            padding: '10px 16px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ef4444', fontWeight: 600 }}>
            <MdWarningAmber size={18} />
            <span>{selectedIds.length} of {records.length} record(s) selected for deletion</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="secondary-btn"
              style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6 }}
            >
              Deselect All
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <MdDeleteOutline size={16} /> Delete Selected ({selectedIds.length})
            </button>
          </div>
        </div>
      )}

      {/* Records Table */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <th style={{ width: 44, padding: '12px 14px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={records.length > 0 && selectedIds.length === records.length}
                    onChange={handleToggleSelectAll}
                    style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#ef4444' }}
                    title={selectedIds.length === records.length ? 'Deselect all' : 'Select all'}
                  />
                </th>
                <th style={{ padding: '12px 14px' }}>Date</th>
                <th style={{ padding: '12px 14px' }}>Hostel / Room</th>
                <th style={{ padding: '12px 14px' }}>Student</th>
                <th style={{ padding: '12px 14px' }}>Status</th>
                <th style={{ padding: '12px 14px' }}>Method</th>
                <th style={{ padding: '12px 14px' }}>Verification Time</th>
                <th style={{ padding: '12px 14px' }}>Session / Checks</th>
                <th style={{ padding: '12px 14px' }}>Gate Event</th>
                <th style={{ padding: '12px 14px' }}>Latest Result / Reason</th>
                <th style={{ padding: '12px 14px' }}>Verified By</th>
                <th style={{ padding: '12px 14px', textAlign: 'center', width: 70 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No attendance records found matching the selected filters.
                  </td>
                </tr>
              ) : (
                records.map((r) => {
                  const isPresent = r.status === 'present';
                  const isLeave = r.status === 'on_leave';
                  const isPending = r.status === 'pending';
                  const isSelected = selectedIds.includes(r.id);
                  const isDeleting = deletingId === r.id;
                  const formatDateDisplay = (dStr, fStr) => {
                    if (fStr) return fStr;
                    if (dStr && /^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
                      const [y, m, d] = dStr.split('-');
                      return `${d}/${m}/${y}`;
                    }
                    return dStr || '—';
                  };
                  return (
                    <tr
                      key={r.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.15s',
                        background: isSelected ? 'rgba(239, 68, 68, 0.04)' : undefined,
                      }}
                    >
                      <td style={{ width: 44, padding: '12px 14px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(r.id)}
                          style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#ef4444' }}
                        />
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {formatDateDisplay(r.date, r.formattedDate)}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.hostel}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>Room {r.roomNo}</span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {r.student?.name && r.student.name.trim().toLowerCase() !== 'student'
                            ? r.student.name
                            : r.studentName && r.studentName.trim().toLowerCase() !== 'student'
                              ? r.studentName
                              : (r.roomNo ? `Resident (Room ${r.roomNo})` : 'Campus Resident')}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          {r.student?.rollNo && r.student.rollNo !== '—'
                            ? r.student.rollNo
                            : r.studentRollNo && r.studentRollNo !== '—'
                              ? r.studentRollNo
                              : '-'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: 12,
                            fontSize: 11.5,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: isPresent ? 'rgba(16,185,129,0.12)' : isLeave ? 'rgba(59,130,246,0.12)' : isPending ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
                            color: isPresent ? '#10b981' : isLeave ? '#3b82f6' : isPending ? '#f59e0b' : '#ef4444',
                          }}
                        >
                          {isPresent && <MdCheckCircle size={13} />}
                          {isLeave && <MdHome size={13} />}
                          {!isPresent && !isLeave && !isPending && <MdCancel size={13} />}
                          {r.status ? r.status.toUpperCase() : 'ABSENT'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                        {r.method === 'self_approved'
                          ? 'GPS Geofence'
                          : r.status === 'on_leave'
                          ? 'Approved Leave'
                          : r.status === 'absent'
                          ? 'Unverified'
                          : r.status === 'pending'
                          ? 'Awaiting GPS'
                          : 'Staff Override'}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                        {r.verificationTime || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                        <div>{r.sessionStart && !isNaN(new Date(r.sessionStart).getTime()) ? `Start: ${new Date(r.sessionStart).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}` : 'Start: —'}</div>
                        <div>{r.expiresAt && !isNaN(new Date(r.expiresAt).getTime()) ? `Ends: ${new Date(r.expiresAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}` : 'Ends: —'}</div>
                        <strong>{r.attemptsUsed || 0}/3 checks</strong>
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-primary)', fontSize: 12.5 }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: r.gateEvent && r.gateEvent.startsWith('IN') ? 'rgba(16,185,129,0.08)' : (r.gateEvent && r.gateEvent.startsWith('OUT') ? 'rgba(239,68,68,0.08)' : 'transparent'),
                          color: r.gateEvent && r.gateEvent.startsWith('IN') ? '#10b981' : (r.gateEvent && r.gateEvent.startsWith('OUT') ? '#ef4444' : 'var(--text-muted)'),
                          fontWeight: 600,
                        }}>
                          {r.gateEvent || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.latestVerificationResult || r.finalizationReason || r.remark || ''}>
                        {r.latestVerificationResult || r.finalizationReason || r.remark || '-'}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                        {r.status === 'absent' ? '—' : (r.verifiedBy || 'Self-Approved')}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleDeleteSingle(r)}
                          disabled={isDeleting || bulkDeleting}
                          title={`Delete record for ${r.student?.name || r.studentName || 'Student'}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            background: 'rgba(239, 68, 68, 0.08)',
                            color: '#ef4444',
                            cursor: isDeleting || bulkDeleting ? 'not-allowed' : 'pointer',
                            opacity: isDeleting ? 0.5 : 1,
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isDeleting && !bulkDeleting) {
                              e.currentTarget.style.background = '#ef4444';
                              e.currentTarget.style.color = '#fff';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isDeleting && !bulkDeleting) {
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                              e.currentTarget.style.color = '#ef4444';
                            }
                          }}
                        >
                          <MdDeleteOutline size={17} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {confirmModal.isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '16px',
          }}
        >
          <div
            style={{
              background: 'var(--bg-card, #1e293b)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '16px',
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <MdWarningAmber size={24} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)' }}>
                  {confirmModal.title}
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                  Irreversible Database Deletion
                </p>
              </div>
            </div>

            <p style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--text-secondary)', marginBottom: '16px' }}>
              {confirmModal.description}
            </p>

            {confirmModal.confirmTargetText && (
              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Type <strong style={{ color: '#ef4444' }}>{confirmModal.confirmTargetText}</strong> to confirm:
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={confirmModal.confirmTargetText}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-input, #0f172a)',
                    color: 'var(--text-primary)',
                    fontSize: '13.5px',
                  }}
                  autoFocus
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                  setConfirmInput('');
                }}
                disabled={deletingId || bulkDeleting}
                style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                disabled={
                  deletingId ||
                  bulkDeleting ||
                  (confirmModal.confirmTargetText && confirmInput.trim().toLowerCase() !== confirmModal.confirmTargetText.toLowerCase())
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 18px',
                  borderRadius: '8px',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor:
                    deletingId ||
                    bulkDeleting ||
                    (confirmModal.confirmTargetText && confirmInput.trim().toLowerCase() !== confirmModal.confirmTargetText.toLowerCase())
                      ? 'not-allowed'
                      : 'pointer',
                  opacity:
                    confirmModal.confirmTargetText && confirmInput.trim().toLowerCase() !== confirmModal.confirmTargetText.toLowerCase()
                      ? 0.5
                      : 1,
                  transition: 'background 0.2s',
                }}
              >
                <MdDeleteOutline size={16} />
                {deletingId || bulkDeleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
