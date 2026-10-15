/**
 * StudentAttendanceHistoryModal Component
 * Shows personal attendance ledger history and live today status for the student.
 */

import { useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdClose,
  MdHistory,
  MdCheckCircle,
  MdCancel,
  MdHome,
  MdSchedule,
  MdMyLocation,
  MdRefresh,
} from 'react-icons/md';

export default function StudentAttendanceHistoryModal({
  onClose = () => {},
  todayStatus = null,
  onVerifyNow = null,
}) {
  const [history, setHistory] = useState([]);
  const [serverToday, setServerToday] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const res = await api.get('/attendance/history');
      if (res.data?.success) {
        setHistory(res.data.records || []);
        if (res.data.today) {
          setServerToday(res.data.today);
        }
      }
    } catch {
      toast.error('Failed to load attendance history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // Merge server today info with prompt props
  const effectiveToday = serverToday || {
    isMarked: todayStatus?.isMarked || Boolean(todayStatus?.todayRecord),
    status: todayStatus?.todayRecord?.status || (todayStatus?.hasPending ? 'pending' : 'not_marked'),
    displayStatus: todayStatus?.todayRecord?.status === 'present'
      ? 'Present'
      : todayStatus?.todayRecord?.status === 'absent'
      ? 'Absent'
      : todayStatus?.todayRecord?.status === 'on_leave'
      ? 'On Approved Leave'
      : todayStatus?.hasPending
      ? 'Verification Pending'
      : 'Not Marked Yet',
    time: todayStatus?.todayRecord?.time || null,
    method: todayStatus?.todayRecord?.method || null,
    hasActiveRound: todayStatus?.hasPending || false,
    canVerify: todayStatus?.hasPending || false,
  };

  const isPresent = effectiveToday?.status === 'present' || effectiveToday?.displayStatus === 'Present';
  const isAbsent = effectiveToday?.status === 'absent' || effectiveToday?.displayStatus === 'Absent';
  const isOnLeave = effectiveToday?.status === 'on_leave' || effectiveToday?.displayStatus?.toLowerCase().includes('leave');
  const isPending = effectiveToday?.status === 'pending' || effectiveToday?.hasPending || effectiveToday?.canVerify;

  let todayBadgeBg = 'rgba(148, 163, 184, 0.12)';
  let todayBadgeColor = 'var(--text-muted)';
  let todayBadgeBorder = '1px solid rgba(148, 163, 184, 0.25)';
  let todayIcon = <MdSchedule size={15} />;
  let todayLabel = 'Not Marked Yet';

  if (isPresent) {
    todayBadgeBg = 'rgba(16, 185, 129, 0.15)';
    todayBadgeColor = '#10b981';
    todayBadgeBorder = '1.5px solid rgba(16, 185, 129, 0.4)';
    todayIcon = <MdCheckCircle size={15} />;
    todayLabel = 'Present';
  } else if (isAbsent) {
    todayBadgeBg = 'rgba(239, 68, 68, 0.15)';
    todayBadgeColor = '#ef4444';
    todayBadgeBorder = '1.5px solid rgba(239, 68, 68, 0.4)';
    todayIcon = <MdCancel size={15} />;
    todayLabel = 'Absent';
  } else if (isOnLeave) {
    todayBadgeBg = 'rgba(168, 85, 247, 0.15)';
    todayBadgeColor = '#c084fc';
    todayBadgeBorder = '1.5px solid rgba(168, 85, 247, 0.4)';
    todayIcon = <MdHome size={15} />;
    todayLabel = 'On Approved Leave';
  } else if (isPending) {
    todayBadgeBg = 'rgba(99, 102, 241, 0.18)';
    todayBadgeColor = '#818cf8';
    todayBadgeBorder = '1.5px solid rgba(99, 102, 241, 0.4)';
    todayIcon = <MdMyLocation size={15} />;
    todayLabel = 'Verification Pending';
  }

  // Summary counts
  const presentCount = history.filter((r) => r.status === 'present').length;
  const absentCount = history.filter((r) => r.status === 'absent').length;
  const leaveCount = history.filter((r) => r.status === 'on_leave').length;

  return (
    <div
      className="modal-backdrop show"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--radius-lg, 16px)',
          overflow: 'hidden',
          padding: 0,
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: 'var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(99, 102, 241, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary-light)',
              }}
            >
              <MdHistory size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: 16.5, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                My Attendance & History
              </h3>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Hostel Night Attendance ledger & live status
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={fetchHistory}
              title="Refresh attendance records"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <MdRefresh size={20} />
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
            >
              <MdClose size={22} />
            </button>
          </div>
        </div>

        {/* Scrollable Container */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Today's Status Banner Card */}
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 'var(--radius-md, 12px)',
              background: isPresent
                ? 'rgba(16, 185, 129, 0.08)'
                : isAbsent
                ? 'rgba(239, 68, 68, 0.08)'
                : isOnLeave
                ? 'rgba(168, 85, 247, 0.08)'
                : isPending
                ? 'rgba(99, 102, 241, 0.1)'
                : 'var(--bg-surface)',
              border: todayBadgeBorder,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Today's Attendance Status
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
                  📅 {effectiveToday?.formattedDate || new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
              <span
                style={{
                  padding: '4px 12px',
                  borderRadius: 99,
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: 0.4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: todayBadgeBg,
                  color: todayBadgeColor,
                  textTransform: 'uppercase',
                }}
              >
                {todayIcon} {todayLabel}
              </span>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {effectiveToday?.time && (
                <div>
                  ⏰ Verified at: <strong style={{ color: 'var(--text-primary)' }}>{effectiveToday.time}</strong>
                </div>
              )}
              {effectiveToday?.method && (
                <div>
                  📍 Method:{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {effectiveToday.method === 'self_approved'
                      ? 'Automatic (GPS Geofence)'
                      : effectiveToday.method === 'staff_marked'
                      ? 'Staff Override'
                      : effectiveToday.method}
                  </strong>
                </div>
              )}
              {effectiveToday?.remark && (
                <div style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                  "{effectiveToday.remark}"
                </div>
              )}
              {!effectiveToday?.isMarked && !isPending && (
                <div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>
                  Hostel room verification round will open during scheduled night verification hours.
                </div>
              )}
            </div>

            {isPending && onVerifyNow && (
              <button
                type="button"
                onClick={onVerifyNow}
                style={{
                  marginTop: 4,
                  width: '100%',
                  padding: '9px 14px',
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #4f46e5, #06b6d4)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 12.5,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  boxShadow: '0 4px 12px rgba(79, 70, 229, 0.35)',
                }}
              >
                <MdMyLocation size={16} /> Verify Attendance via GPS Now
              </button>
            )}
          </div>

          {/* Stats Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm, 8px)',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: '#10b981' }}>{presentCount}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Verified Present</div>
            </div>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm, 8px)',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: '#ef4444' }}>{absentCount}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Unverified / Absent</div>
            </div>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm, 8px)',
                background: 'rgba(168, 85, 247, 0.08)',
                border: '1px solid rgba(168, 85, 247, 0.2)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: '#c084fc' }}>{leaveCount}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Approved Leave</div>
            </div>
          </div>

          {/* Ledger Title */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Attendance History Ledger ({history.length})
            </span>
          </div>

          {/* History List */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
              Loading attendance history…
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
              No attendance records found yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map((record) => {
                let chipBg = 'rgba(239,68,68,0.15)';
                let chipColor = '#ef4444';
                let icon = <MdCancel size={14} />;

                if (record.status === 'present') {
                  chipBg = 'rgba(16,185,129,0.15)';
                  chipColor = '#10b981';
                  icon = <MdCheckCircle size={14} />;
                } else if (record.status === 'on_leave') {
                  chipBg = 'rgba(168,85,247,0.15)';
                  chipColor = '#c084fc';
                  icon = <MdHome size={14} />;
                }

                const methodDesc =
                  record.status === 'present'
                    ? record.method === 'self_approved'
                      ? 'Automatic (GPS Geofence)'
                      : `Manual (${record.verifiedBy || 'Staff Verified'})`
                    : record.status === 'on_leave'
                    ? 'Approved Leave (Home Visit)'
                    : record.remark || 'Unverified / Absent during round';

                return (
                  <div
                    key={record.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md, 10px)',
                      background: 'var(--bg-card)',
                      border: 'var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                          📅 {record.formattedDate || record.date}
                        </span>
                        {(record.time || record.markedAt) && record.status === 'present' && (
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: 'var(--primary-light)',
                              background: 'rgba(99, 102, 241, 0.12)',
                              padding: '1px 8px',
                              borderRadius: 6,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            ⏰ {record.time || new Date(record.markedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                          </span>
                        )}
                        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {record.hostel ? `${record.hostel} · ` : ''}{record.session || 'Night Attendance'}
                        </span>
                      </div>

                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        Hostel {record.hostel || 'Assigned'}{record.roomNo ? ` · Room ${record.roomNo}` : ''} · {methodDesc}
                        {record.remark && record.status === 'present' && <span> · "{record.remark}"</span>}
                      </div>
                    </div>

                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 700,
                        background: chipBg,
                        color: chipColor,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        flexShrink: 0,
                      }}
                    >
                      {icon} {record.status.replace('_', ' ')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
