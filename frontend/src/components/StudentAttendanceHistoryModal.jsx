/**
 * StudentAttendanceHistoryModal Component
 * Shows personal attendance ledger history and live today status for the student.
 */

import { useState, useEffect, useRef } from 'react';
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
  user = null,
  onStatusChange = null,
}) {
  const [history, setHistory] = useState([]);
  const [serverToday, setServerToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState(null);
  const autoMinimizeTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (autoMinimizeTimerRef.current) clearTimeout(autoMinimizeTimerRef.current);
    };
  }, []);

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

  const handleGpsVerification = async () => {
    if (verifying) return;
    if (autoMinimizeTimerRef.current) clearTimeout(autoMinimizeTimerRef.current);
    setVerifying(true);
    setVerifyNotice({ type: 'info', text: '🛰️ Requesting device GPS coordinates...' });

    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your device browser.');
      setVerifyNotice({ type: 'error', text: 'Geolocation not supported by device.' });
      setVerifying(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          setVerifyNotice({ type: 'info', text: '📍 Validating hostel geofence coordinates...' });
          const { latitude, longitude, accuracy } = pos.coords;

          const clientNow = Date.now();
          const rawGpsTime = pos.timestamp;
          let safeGpsTime = clientNow;
          if (typeof rawGpsTime === 'number' && Number.isFinite(rawGpsTime)) {
            const ms = rawGpsTime < 1e11 ? rawGpsTime * 1000 : rawGpsTime;
            if (Math.abs(clientNow - ms) < 300_000) {
              safeGpsTime = ms;
            }
          }

          const res = await api.post('/attendance/auto-verify', {
            lat: latitude,
            lng: longitude,
            accuracy,
            timestamp: safeGpsTime,
            clientNow,
            hostel: effectiveToday?.hostel || user?.hostel || 'BH2',
          });

          await fetchHistory();

          if (res.data?.success && (res.data?.status === 'PRESENT' || res.data?.isMarked)) {
            toast.success('🎉 Attendance verified successfully! Marked PRESENT.');
            setServerToday(res.data);
            setVerifyNotice({
              type: 'success',
              text: `✅ Attendance verified: Marked PRESENT at ${res.data?.time || 'now'}! Minimizing in 2s...`,
              canCancel: false,
            });
            if (onStatusChange) {
              onStatusChange({
                isMarked: true,
                hasPending: false,
                todayRecord: {
                  status: 'present',
                  time: res.data?.time || new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }),
                  date: res.data?.date,
                  method: 'self_approved',
                },
              });
            }
            autoMinimizeTimerRef.current = setTimeout(() => {
              onClose();
            }, 2000);
          } else {
            const count = res.data?.attemptsCount || 0;
            const remaining = res.data?.attemptsRemaining ?? Math.max(0, 3 - count);
            const msg = res.data?.message || (res.data?.locationStatus === 'OUTSIDE HOSTEL' ? 'Outside hostel geofence.' : 'Verification check completed.');
            if (res.data) setServerToday(res.data);

            const isTechnical = Boolean(res.data?.technicalError || count === 0);
            if (isTechnical) {
              toast.error(msg);
            } else {
              toast.error(`Attempt ${count}/3 recorded: ${msg}`);
            }

            setVerifyNotice({
              type: 'warning',
              text: isTechnical
                ? `⚠️ Location Check Notice — ${msg} (${remaining}/3 checks left). Minimizing in 2s...`
                : `⚠️ Attempt ${count}/3 recorded — ${msg} (${remaining}/3 checks left). Minimizing in 2s...`,
              canCancel: true,
            });
            if (onStatusChange) {
              onStatusChange({
                isMarked: false,
                hasPending: Boolean(res.data?.hasActiveSession ?? true),
                pendingRequest: { remainingSeconds: res.data?.remainingSeconds || 7200 },
                todayStatus: res.data,
              });
            }
            autoMinimizeTimerRef.current = setTimeout(() => {
              onClose();
            }, 2200);
          }
        } catch (err) {
          const msg = err.response?.data?.message || err.message || 'GPS verification failed.';
          toast.error(msg);
          setVerifyNotice({
            type: 'error',
            text: `❌ ${msg}. Minimizing in 2.5s...`,
            canCancel: true,
          });
          autoMinimizeTimerRef.current = setTimeout(() => {
            onClose();
          }, 2500);
        } finally {
          setVerifying(false);
        }
      },
      (err) => {
        let msg = 'Could not acquire GPS position. Enable device location.';
        if (err.code === 1) msg = 'Location access denied. Please allow location permissions in your browser or device settings.';
        else if (err.code === 2) msg = 'GPS signal unavailable. Turn on high accuracy location services and move near an open window.';
        else if (err.code === 3) msg = 'GPS acquisition timed out after 15s. Try again in an open space.';
        toast.error(msg);
        setVerifyNotice({
          type: 'error',
          text: `❌ ${msg}. Minimizing in 3s...`,
          canCancel: true,
        });
        setVerifying(false);
        autoMinimizeTimerRef.current = setTimeout(() => {
          onClose();
        }, 3000);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

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

  const formatDateDisplay = (dStr, fStr) => {
    if (fStr && !fStr.includes('NaN')) return fStr;
    if (dStr && /^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
      const [y, m, d] = dStr.split('-');
      return `${d}/${m}/${y}`;
    }
    return dStr || new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' });
  };
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
              onClick={() => {
                if (autoMinimizeTimerRef.current) clearTimeout(autoMinimizeTimerRef.current);
                onClose();
              }}
              title="Minimize to dashboard"
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 11.5,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              Minimize
            </button>
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
              onClick={() => {
                if (autoMinimizeTimerRef.current) clearTimeout(autoMinimizeTimerRef.current);
                onClose();
              }}
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
                <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                  📅 {formatDateDisplay(effectiveToday?.date, effectiveToday?.formattedDate)}
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

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* 4 Core Attendance Fields (Requirement 10) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>ATTENDANCE STATUS</div>
                  <div style={{ fontWeight: 800, color: todayBadgeColor }}>{effectiveToday.status ? effectiveToday.status.replace(/_/g, ' ').toUpperCase() : todayLabel.toUpperCase()}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>VERIFICATION TIME</div>
                  <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                    {isPending ? `Open (${todayStatus?.todayStatus?.remainingSeconds ? Math.floor(todayStatus.todayStatus.remainingSeconds / 60) + 'm left' : 'Active'})` : (effectiveToday?.time || '—')}
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>CHECKS REMAINING</div>
                  <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                    {todayStatus?.todayStatus?.attemptsRemaining !== undefined ? `${todayStatus.todayStatus.attemptsRemaining}/3` : (effectiveToday?.isMarked ? '0/3' : '3/3')}
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>LOCATION STATUS</div>
                  <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                    {todayStatus?.todayStatus?.locationStatus || (isPresent ? 'INSIDE HOSTEL' : isAbsent ? 'OUTSIDE HOSTEL' : 'NOT CHECKED')}
                  </div>
                </div>
              </div>

              {effectiveToday?.time && (
                <div>
                  ⏰ {isPresent ? 'Verified at:' : 'Marked at:'} <strong style={{ color: 'var(--text-primary)' }}>{effectiveToday.time}</strong>
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

            {isPending && (
              <>
                <button
                  type="button"
                  onClick={handleGpsVerification}
                  disabled={verifying}
                  style={{
                    marginTop: 6,
                    width: '100%',
                    padding: '11px 16px',
                    borderRadius: 10,
                    background: verifying
                      ? 'rgba(99, 102, 241, 0.5)'
                      : 'linear-gradient(135deg, #4f46e5, #06b6d4)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: verifying ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <MdMyLocation size={17} style={{ animation: verifying ? 'spin 1s linear infinite' : 'none' }} />
                  {verifying ? 'Verifying GPS Location…' : 'Verify Attendance via GPS Now'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (autoMinimizeTimerRef.current) clearTimeout(autoMinimizeTimerRef.current);
                    onClose();
                  }}
                  style={{
                    marginTop: 6,
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--text-muted)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  Minimize to Background Banner
                </button>
              </>
            )}

            {verifyNotice && (
              <div
                style={{
                  marginTop: 8,
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  background: verifyNotice.type === 'success'
                    ? 'rgba(16, 185, 129, 0.15)'
                    : verifyNotice.type === 'warning'
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                  color: verifyNotice.type === 'success'
                    ? '#10b981'
                    : verifyNotice.type === 'warning'
                    ? '#fbbf24'
                    : '#ef4444',
                  border: `1px solid ${
                    verifyNotice.type === 'success'
                      ? 'rgba(16, 185, 129, 0.3)'
                      : verifyNotice.type === 'warning'
                      ? 'rgba(245, 158, 11, 0.3)'
                      : 'rgba(239, 68, 68, 0.3)'
                  }`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: 1, minWidth: 180 }}>{verifyNotice.text}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {verifyNotice.canCancel && (
                    <button
                      type="button"
                      onClick={() => {
                        if (autoMinimizeTimerRef.current) clearTimeout(autoMinimizeTimerRef.current);
                        setVerifyNotice((prev) => (prev ? { ...prev, text: prev.text.replace(/\. Minimizing.*$/, ''), canCancel: false } : null));
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: 'inherit',
                        borderRadius: 6,
                        padding: '3px 8px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Keep Open
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (autoMinimizeTimerRef.current) clearTimeout(autoMinimizeTimerRef.current);
                      onClose();
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.18)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      color: 'inherit',
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Minimize Now
                  </button>
                </div>
              </div>
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

                // Extract timestamp consistently for present, absent, and leave
                let recordTime = record.time;
                if (!recordTime) {
                  const rawTs =
                    record.markedAt ||
                    record.verification_timestamp ||
                    record.createdAt ||
                    record.updatedAt ||
                    (record.id && String(record.id).length >= 8
                      ? new Date(parseInt(String(record.id).substring(0, 8), 16) * 1000)
                      : null);
                  if (rawTs) {
                    const d = new Date(rawTs);
                    if (!isNaN(d.getTime())) {
                      recordTime = d.toLocaleTimeString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true,
                      });
                    }
                  }
                }

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
                      {/* Row 1: Date & Time Pill (Uniformly displayed across all records) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                          📅 {formatDateDisplay(record.date, record.formattedDate)}
                        </span>
                        {recordTime ? (
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: 'var(--primary-light)',
                              background: 'rgba(99, 102, 241, 0.12)',
                              padding: '2px 8px',
                              borderRadius: 6,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            ⏰ {recordTime}
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 11.5,
                              color: 'var(--text-muted)',
                              background: 'rgba(255, 255, 255, 0.05)',
                              padding: '2px 8px',
                              borderRadius: 6,
                            }}
                          >
                            ⏰ Recorded during round
                          </span>
                        )}
                      </div>

                      {/* Row 2: Hostel & Session Name */}
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 2 }}>
                        {record.hostel ? `${record.hostel} · ` : ''}{record.session || 'Night Attendance'}
                      </div>

                      {/* Row 3: Room, Method & Remark */}
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
