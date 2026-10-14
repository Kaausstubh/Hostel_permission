/**
 * StudentAttendancePrompt Component
 * One-Time GPS Verification & Server-Authoritative Two-Attempt Attendance.
 *
 * Implements:
 * 1. Displays GPS verification ONLY when attendance is NOT yet finalized for current session.
 * 2. Strictly enforces max 2 GPS fetching attempts per student per session on server.
 * 3. Successful coordinates immediately finalize attendance as PRESENT (inside geofence) or ABSENT (outside).
 * 4. Failed GPS retrieval (permission denied, timeout, unavailable) counts as an attempt.
 *    - Attempt 1 failure allows Attempt 2 without prematurely marking absent.
 *    - Attempt 2 failure finalizes attendance as ABSENT.
 * 5. Once attendance is finalized (PRESENT or ABSENT):
 *    - The verification card, button, prompt, and marking controls are COMPLETELY REMOVED from the UI.
 *    - Clean "Hostel Attendance" section prominently displays status, date, and time.
 *    - Status persists across page refreshes, logouts, and app reopens.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdGpsFixed,
  MdCheckCircle,
  MdCancel,
  MdWarning,
  MdAccessTime,
  MdHistory,
} from 'react-icons/md';

export default function StudentAttendancePrompt({
  user,
  socket,
  onVerified = () => {},
  onStatusChange = () => {},
  externalOpenTrigger = 0,
  onOpenHistory = () => {},
}) {
  // Today's definitive attendance session status
  const [todaySession, setTodaySession] = useState({
    hostel: user?.hostel || 'BH2',
    hostelName: user?.hostel ? `${user.hostel} Hostel` : 'Assigned Hostel',
    date: new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10),
    formattedDate: new Date(Date.now() + 5.5 * 3600 * 1000).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    time: null,
    status: 'PENDING', // 'PRESENT' | 'ABSENT' | 'PENDING'
    displayStatus: 'Pending Verification',
    method: null,
    verification: 'Pending Verification',
    isMarked: false,
    confirmedByServer: false,
    attemptsCount: 0,
    attemptsRemaining: 2,
    message: null,
  });

  const [verifying, setVerifying] = useState(false);
  const [gpsError, setGpsError] = useState(null);
  const lastExternalTriggerRef = useRef(externalOpenTrigger);

  // ── Handle Server Response for Attendance Status ────────────────────────────
  const handleVerificationResponse = useCallback(
    (data) => {
      if (!data) return;

      const isPresent = data.status === 'PRESENT';
      const isAbsent = data.status === 'ABSENT';
      const isFinalized = isPresent || isAbsent || Boolean(data.isMarked);

      if (isPresent) {
        setTodaySession((prev) => ({
          ...prev,
          status: 'PRESENT',
          displayStatus: 'PRESENT',
          time: data.time || prev.time,
          date: data.date || prev.date,
          formattedDate: data.formattedDate || prev.formattedDate,
          hostel: data.hostel || prev.hostel,
          hostelName: data.hostelName || prev.hostelName,
          isMarked: true,
          confirmedByServer: true,
          attemptsCount: data.attemptsCount || 1,
          attemptsRemaining: 0,
          verification: 'Successful',
        }));

        toast.success(`🎉 Attendance Marked: PRESENT at ${data.time || 'now'} IST!`, {
          icon: '🟢',
          duration: 5000,
        });

        if (onVerified) onVerified();
        if (onStatusChange) onStatusChange({ todayStatus: data, isMarked: true });
      } else if (isAbsent) {
        setTodaySession((prev) => ({
          ...prev,
          status: 'ABSENT',
          displayStatus: 'ABSENT',
          time: data.time || prev.time,
          date: data.date || prev.date,
          formattedDate: data.formattedDate || prev.formattedDate,
          hostel: data.hostel || prev.hostel,
          hostelName: data.hostelName || prev.hostelName,
          isMarked: true,
          confirmedByServer: true,
          attemptsCount: 2,
          attemptsRemaining: 0,
          verification: data.message || 'Outside Hostel Boundary / Failed Attempts',
        }));

        toast.error(`Attendance Recorded: ABSENT (${data.message || 'Outside boundary / attempts failed'})`, {
          icon: '🔴',
          duration: 6000,
        });

        if (onStatusChange) onStatusChange({ todayStatus: data, isMarked: true });
      } else {
        // Still PENDING (Attempt 1 failed)
        setTodaySession((prev) => ({
          ...prev,
          status: 'PENDING',
          displayStatus: 'Pending Verification',
          attemptsCount: data.attempt || data.attemptsCount || 1,
          attemptsRemaining: data.attemptsRemaining || 1,
          isMarked: false,
          message: data.message,
        }));

        if (onStatusChange) onStatusChange({ todayStatus: data, isMarked: false });
      }
    },
    [onVerified, onStatusChange]
  );

  // ── Fetch Latest Attendance Status from Backend ─────────────────────────────
  const fetchAttendanceStatus = useCallback(async () => {
    if (!user || user.role !== 'student') return;

    try {
      const todayRes = await api.get('/attendance/today');
      if (todayRes.data?.success) {
        const d = todayRes.data;
        const isPresent = d.status === 'PRESENT';
        const isAbsent = d.status === 'ABSENT';
        const isMarked = isPresent || isAbsent || Boolean(d.isMarked);

        setTodaySession((prev) => ({
          ...prev,
          hostel: d.hostel || user.hostel || 'BH2',
          hostelName: d.hostelName || `${user.hostel || 'BH2'} Hostel`,
          date: d.date || prev.date,
          formattedDate: d.formattedDate || prev.formattedDate,
          time: d.time || prev.time,
          status: isPresent ? 'PRESENT' : isAbsent ? 'ABSENT' : 'PENDING',
          displayStatus: isPresent ? 'PRESENT' : isAbsent ? 'ABSENT' : 'Pending Verification',
          method: d.method,
          verification: d.verification,
          isMarked,
          confirmedByServer: Boolean(d.confirmedByServer),
          attemptsCount: d.attemptsCount || (isMarked ? 2 : 0),
          attemptsRemaining: isMarked ? 0 : (d.attemptsRemaining ?? 2),
          message: d.message || null,
        }));

        if (onStatusChange) {
          onStatusChange({
            todayStatus: d,
            isMarked,
          });
        }
      }
    } catch {
      // silent fallback on network glitch
    }
  }, [user, onStatusChange]);

  // Initial load and periodic refresh every 8 seconds
  useEffect(() => {
    fetchAttendanceStatus();
    const interval = setInterval(fetchAttendanceStatus, 8000);
    return () => clearInterval(interval);
  }, [fetchAttendanceStatus]);

  // Socket.IO event listeners for live push updates
  useEffect(() => {
    if (!socket) return;

    const handleStudentMarked = (payload) => {
      if (payload?.studentId === user?._id) {
        fetchAttendanceStatus();
      }
    };

    socket.on('student_attendance_marked', handleStudentMarked);
    socket.on('room_attendance_updated', fetchAttendanceStatus);

    return () => {
      socket.off('student_attendance_marked', handleStudentMarked);
      socket.off('room_attendance_updated', fetchAttendanceStatus);
    };
  }, [socket, user?._id, fetchAttendanceStatus]);

  // Trigger from external header button
  useEffect(() => {
    if (externalOpenTrigger > 0 && externalOpenTrigger !== lastExternalTriggerRef.current) {
      lastExternalTriggerRef.current = externalOpenTrigger;
      executePresenceVerification();
    }
  }, [externalOpenTrigger]);

  // ── Core Geolocation & Attendance Verification Logic ─────────────────────────
  const executePresenceVerification = useCallback(async () => {
    if (verifying) return;
    if (todaySession.isMarked || todaySession.status === 'PRESENT' || todaySession.status === 'ABSENT') {
      return;
    }

    setVerifying(true);
    setGpsError(null);

    // Browser Geolocation API check
    if (!navigator.geolocation) {
      const errorMsg = 'Geolocation is not supported by your browser.';
      setGpsError(errorMsg);
      toast.error(errorMsg);

      try {
        const res = await api.post('/attendance/auto-verify', {
          fetchFailed: true,
          code: 'NOT_SUPPORTED',
          reason: errorMsg,
        });
        handleVerificationResponse(res.data);
      } catch (err) {
        toast.error(err.response?.data?.message || err.message);
      } finally {
        setVerifying(false);
      }
      return;
    }

    // Request device GPS coordinates
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude, accuracy } = position.coords;
          const res = await api.post('/attendance/auto-verify', {
            lat: latitude,
            lng: longitude,
            accuracy,
            timestamp: position.timestamp || Date.now(),
            hostel: user?.hostel,
          });

          handleVerificationResponse(res.data);
        } catch (err) {
          const errData = err.response?.data;
          const msg = errData?.message || err.message || 'Geofence verification failed';
          setGpsError(msg);
          toast.error(msg);
          fetchAttendanceStatus();
        } finally {
          setVerifying(false);
        }
      },
      async (error) => {
        let code = 'GPS_FETCH_FAILED';
        let message = 'Unable to retrieve device GPS location.';
        if (error.code === error.PERMISSION_DENIED) {
          code = 'PERMISSION_DENIED';
          message = 'Location permission was denied. Please allow location access in your browser settings.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          code = 'POSITION_UNAVAILABLE';
          message = 'Location signal unavailable. Move near a window or outdoors to acquire GPS satellites.';
        } else if (error.code === error.TIMEOUT) {
          code = 'TIMEOUT';
          message = 'GPS location request timed out. Please try again.';
        }

        setGpsError(message);
        toast.error(message, { icon: '⚠️' });

        // Record failed attempt on the server
        try {
          const res = await api.post('/attendance/auto-verify', {
            fetchFailed: true,
            code,
            reason: message,
          });
          handleVerificationResponse(res.data);
        } catch (apiErr) {
          toast.error(apiErr.response?.data?.message || apiErr.message);
        } finally {
          setVerifying(false);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [verifying, todaySession.isMarked, todaySession.status, user?.hostel, handleVerificationResponse, fetchAttendanceStatus]);

  const isPresent = todaySession.status === 'PRESENT';
  const isAbsent = todaySession.status === 'ABSENT';
  const isFinalized = isPresent || isAbsent || todaySession.isMarked;

  // ── CASE 1: FINALIZED ATTENDANCE (PRESENT or ABSENT) ─────────────────────────
  // Verification component is completely removed from the visible UI.
  // Clean "Hostel Attendance" section permanently displays final status, date, and time.
  if (isFinalized) {
    return (
      <div
        className="hostel-attendance-container"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 44,
          background: 'var(--bg-card, #1e293b)',
          borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.12)',
          backdropFilter: 'blur(12px)',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          transition: 'all 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {/* Prominent Status Icon */}
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: isPresent ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: isPresent ? '#10b981' : '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              flexShrink: 0,
            }}
          >
            {isPresent ? <MdCheckCircle /> : <MdCancel />}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: 'var(--text-primary, #ffffff)',
                  letterSpacing: '-0.01em',
                }}
              >
                Hostel Attendance
              </span>

              {/* Status Badge */}
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  padding: '2px 10px',
                  borderRadius: 99,
                  background: isPresent ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)',
                  color: isPresent ? '#10b981' : '#ef4444',
                  border: isPresent
                    ? '1px solid rgba(16, 185, 129, 0.35)'
                    : '1px solid rgba(239, 68, 68, 0.35)',
                  letterSpacing: '0.04em',
                }}
              >
                {todaySession.status}
              </span>

              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 99,
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-muted, #94a3b8)',
                }}
              >
                {todaySession.hostel}
              </span>
            </div>

            {/* Date and Time Display */}
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary, #94a3b8)',
                marginTop: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <span>📅 {todaySession.formattedDate}</span>
              {todaySession.time && (
                <>
                  <span>•</span>
                  <span>🕒 {todaySession.time} IST</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Attendance History Trigger (Zero verification controls) */}
        <button
          type="button"
          onClick={onOpenHistory}
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            color: 'var(--text-secondary, #cbd5e1)',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <MdHistory size={15} />
          <span>History</span>
        </button>
      </div>
    );
  }

  // ── CASE 2: PENDING VERIFICATION (Maximum 2 Attempts Available) ───────────────
  const attemptsCount = todaySession.attemptsCount || 0;
  const isSecondAttempt = attemptsCount === 1;

  return (
    <>
      <div
        className="hostel-attendance-container"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 44,
          background: 'var(--bg-card, #1e293b)',
          borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
          backdropFilter: 'blur(12px)',
          padding: '10px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          transition: 'all 0.2s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {/* Status Indicator Icon */}
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: verifying ? 'rgba(99, 102, 241, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                color: verifying ? '#818cf8' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                flexShrink: 0,
              }}
            >
              {verifying ? <MdGpsFixed className="animate-spin" /> : <MdAccessTime />}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: 'var(--text-primary, #ffffff)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Hostel Attendance
                </span>

                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    padding: '2px 10px',
                    borderRadius: 99,
                    background: 'rgba(245, 158, 11, 0.18)',
                    color: '#f59e0b',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    letterSpacing: '0.02em',
                  }}
                >
                  Pending Verification
                </span>

                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 99,
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: 'var(--text-muted, #94a3b8)',
                  }}
                >
                  {todaySession.hostel}
                </span>
              </div>

              {/* Date & Attempt Status */}
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary, #94a3b8)',
                  marginTop: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span>📅 {todaySession.formattedDate}</span>
                {isSecondAttempt && (
                  <span style={{ color: '#f87171', fontWeight: 600 }}>
                    • Attempt 1 of 2 failed (1 attempt remaining)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* GPS Verification Action Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={executePresenceVerification}
              disabled={verifying}
              style={{
                background: verifying
                  ? 'rgba(99, 102, 241, 0.3)'
                  : 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 999,
                padding: '8px 18px',
                fontSize: 13,
                fontWeight: 700,
                cursor: verifying ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.35)',
                transition: 'all 0.15s ease',
              }}
            >
              <MdGpsFixed className={verifying ? 'animate-spin' : ''} size={16} />
              <span>
                {verifying
                  ? `Verifying GPS (Attempt ${isSecondAttempt ? 2 : 1}/2)...`
                  : isSecondAttempt
                  ? 'Retry Presence Check (Attempt 2 of 2)'
                  : 'Check Presence'}
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenHistory}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-secondary, #cbd5e1)',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
                borderRadius: 8,
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              History
            </button>
          </div>
        </div>

        {/* Live In-Progress Verification Notice */}
        {verifying && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(99, 102, 241, 0.12)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              color: '#818cf8',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <MdGpsFixed className="animate-spin" size={15} />
            <span>
              Acquiring high-accuracy GPS coordinates to verify {todaySession.hostel} presence (Attempt {isSecondAttempt ? 2 : 1} of 2)...
            </span>
          </div>
        )}

        {/* GPS Failure / Attempt Notice */}
        {gpsError && !verifying && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#f87171',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <MdWarning size={16} style={{ flexShrink: 0 }} />
            <span>{gpsError}</span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </>
  );
}
