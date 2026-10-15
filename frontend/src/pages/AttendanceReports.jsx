/**
 * Attendance Reports Screen
 * Comprehensive date range filters, hostel/floor/status filters,
 * live tabular breakdown, and direct one-click CSV export.
 */

import { useState, useEffect } from 'react';
import api from '../services/api';
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
} from 'react-icons/md';
import Navbar from '../components/Navbar';
import { downloadAttendanceReportPDF } from '../utils/pdfReportGenerator';
import { exportAttendanceToExcel } from '../utils/excelReportGenerator';

export default function AttendanceReports() {
  const { user } = useAuth();
  const todayStr = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [hostel, setHostel] = useState('ALL');
  const [floor, setFloor] = useState('ALL');
  const [status, setStatus] = useState('all');
  const [studentQuery, setStudentQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [records, setRecords] = useState([]);

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
  }, []);

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
        <div style={{ display: 'flex', gap: 10 }}>
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

      {/* Records Table */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
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
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No attendance records found matching the selected filters.
                  </td>
                </tr>
              ) : (
                records.map((r) => {
                  const isPresent = r.status === 'present';
                  const isLeave = r.status === 'on_leave';
                  const isPending = r.status === 'pending';
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>{r.date}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.hostel}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>Room {r.roomNo}</span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.student?.name || 'Unknown'}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{r.student?.rollNo || '-'}</div>
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
                          {r.status.toUpperCase()}
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
                        <div>{r.sessionStart ? `Start: ${new Date(r.sessionStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Start: —'}</div>
                        <div>{r.expiresAt ? `Ends: ${new Date(r.expiresAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Ends: —'}</div>
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
    </div>
  );
}
