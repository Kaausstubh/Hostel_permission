/**
 * StudentAttendancePrompt Component
 * Precision Hostel Geofencing & Automatic Attendance Detection.
 *
 * Implements:
 * 1. Configurable, high-precision building geofencing (15-25m radius, Haversine formula).
 * 2. Strict hostel-specific validation:
 *    - BH1 students cannot mark at BH2; BH2 students cannot mark at BH1.
 *    - Student assigned hostel strictly validated against server identity.
 * 3. Automatic attendance for BH2 students (and any hostel with auto_attendance enabled) on app open.
 * 4. Real-time attendance state synchronization (immediate frontend-to-backend-to-DB sync without page reloads).
 * 5. Exact attendance date & time display in IST with seconds (e.g. "13 October 2026", "08:42:17 PM").
 * 6. Clear distinction between NOT MARKED and ABSENT.
 * 7. Low GPS accuracy detection and retry guidance.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdLocationOn,
  MdGpsFixed,
  MdCheckCircle,
  MdCancel,
  MdWarning,
  MdClose,
  MdRefresh,
  MdMeetingRoom,
  MdMyLocation,
  MdAccessTime,
  MdInfoOutline,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
  MdHistory,
  MdSecurity,
  MdSignalCellularAlt,
} from 'react-icons/md';

export default function StudentAttendancePrompt({
  user,
  socket,
  onVerified = () => {},
  onStatusChange = () => {},
  externalOpenTrigger = 0,
  onOpenHistory = () => {},
}) {
  // Pending room-round request (for legacy staff round roll calls)
  const [pendingRequest, setPendingRequest] = useState(null);

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
    status: 'NOT MARKED', // 'PRESENT' | 'NOT MARKED' | 'ABSENT'
    method: null, // 'Automatic' | 'Manual'
    verification: 'Pending Presence Verification',
    confirmedByServer: false,
    reason: null,
    autoAttendanceEnabled: true,
    permittedRadiusMeters: 22,
    accuracyThresholdMeters: 25,
  });

  const [cardExpanded, setCardExpanded] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // GPS & verification state
  const [verifying, setVerifying] = useState(false);
  const [gpsData, setGpsData] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const [verificationFeedback, setVerificationFeedback] = useState(null);

  const hasAutoVerifiedOnOpenRef = useRef(false);
  const lastExternalTriggerRef = useRef(externalOpenTrigger);

  const remainingSeconds = pendingRequest?.remainingSeconds ?? 0;

  // ── Fetch Latest Attendance Status & Active Requests ──────────────────────
  const fetchAttendanceStatus = useCallback(async () => {
    if (!user || user.role !== 'student') return;

    try {
      // 1. Fetch today's official attendance session record
      const todayRes = await api.get('/attendance/today');
      if (todayRes.data?.success) {
        const d = todayRes.data;
        setTodaySession((prev) => ({
          ...prev,
          hostel: d.hostel || user.hostel || 'BH2',
          hostelName: d.hostelName || `${user.hostel || 'BH2'} Hostel`,
          date: d.date,
          formattedDate: d.formattedDate,
          time: d.time,
          status: d.status, // 'PRESENT' | 'NOT MARKED' | 'ABSENT'
          method: d.method,
          verification: d.verification,
          confirmedByServer: Boolean(d.confirmedByServer),
          reason: d.remark || d.message || null,
          autoAttendanceEnabled: d.autoAttendanceEnabled !== false,
          permittedRadiusMeters: d.permittedRadiusMeters || 22,
          accuracyThresholdMeters: d.accuracyThresholdMeters || 25,
        }));

        if (onStatusChange) {
          onStatusChange({
            todayStatus: d,
            isMarked: d.isMarked,
          });
        }
      }

      // 2. Fetch active room-level requests (if staff started a night round)
      const pendingRes = await api.get('/attendance/pending');
      const reqData = pendingRes.data?.request;
      const hasActive = Boolean(pendingRes.data?.success && pendingRes.data.hasPending && !reqData?.alreadyApproved);

      if (hasActive) {
        setPendingRequest(reqData);
      } else {
        setPendingRequest(null);
      }
    } catch {
      // silent fallback on network hiccup
    }
  }, [user, onStatusChange]);

  // Initial load and periodic refresh every 4 seconds
  useEffect(() => {
    fetchAttendanceStatus();
    const interval = setInterval(fetchAttendanceStatus, 4000);
    return () => clearInterval(interval);
  }, [fetchAttendanceStatus]);

  // Socket.IO event listeners for instantaneous push updates
  useEffect(() => {
    if (!socket) return;

    const handleReq = () => {
      toast('Hostel staff requested attendance for your room!', {
        icon: '🏛️',
        duration: 5000,
      });
      fetchAttendanceStatus();
    };

    const handleStudentMarked = (payload) => {
      if (payload?.studentId === user?._id) {
        fetchAttendanceStatus();
      }
    };

    socket.on('attendance_requested', handleReq);
    socket.on('student_attendance_marked', handleStudentMarked);
    socket.on('room_attendance_updated', fetchAttendanceStatus);

    return () => {
      socket.off('attendance_requested', handleReq);
      socket.off('student_attendance_marked', handleStudentMarked);
      socket.off('room_attendance_updated', fetchAttendanceStatus);
    };
  }, [socket, user?._id, fetchAttendanceStatus]);

  // Trigger from external header button
  useEffect(() => {
    if (externalOpenTrigger > 0 && externalOpenTrigger !== lastExternalTriggerRef.current) {
      lastExternalTriggerRef.current = externalOpenTrigger;
      setCardExpanded(true);
      executePresenceVerification({ silentOnSuccess: false });
    }
  }, [externalOpenTrigger]);

  // ── Automatic Attendance Evaluation on App Open for BH2 Students ──────────
  useEffect(() => {
    if (!user || user.role !== 'student') return;
    if (hasAutoVerifiedOnOpenRef.current) return;

    // Trigger auto-verification when student opens app if not already marked PRESENT
    const canAutoVerify =
      todaySession.status !== 'PRESENT' &&
      (user.hostel === 'BH2' || todaySession.autoAttendanceEnabled);

    if (canAutoVerify) {
      hasAutoVerifiedOnOpenRef.current = true;
      executePresenceVerification({ silentOnSuccess: false, isAutoTrigger: true });
    }
  }, [user, todaySession.status, todaySession.autoAttendanceEnabled]);

  // ── Core Geolocation & Presence Verification Function ─────────────────────
  const executePresenceVerification = useCallback(
    async ({ silentOnSuccess = false, isAutoTrigger = false } = {}) => {
      if (verifying) return;

      setVerifying(true);
      setGpsError(null);
      setVerificationFeedback(null);

      if (!navigator.geolocation) {
        setGpsError('Geolocation is not supported by your browser.');
        setVerifying(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const coords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp || Date.now(),
          };

          setGpsData(coords);

          try {
            // Send fresh coordinates to authoritative backend auto-verify endpoint
            const res = await api.post('/attendance/auto-verify', {
              lat: coords.lat,
              lng: coords.lng,
              accuracy: coords.accuracy,
              timestamp: coords.timestamp,
              hostel: user?.hostel,
            });

            const data = res.data;
            if (data?.status === 'PRESENT') {
              setTodaySession((prev) => ({
                ...prev,
                hostel: data.hostel,
                hostelName: data.hostelName,
                date: data.date,
                formattedDate: data.formattedDate,
                time: data.time,
                status: 'PRESENT',
                method: data.method || 'Automatic',
                verification: 'Successful',
                confirmedByServer: true,
                reason: data.message,
              }));

              setVerificationFeedback({
                type: 'success',
                message: data.message || `Verified inside ${data.hostelName || 'hostel'}! Attendance marked PRESENT.`,
                time: data.time,
                date: data.formattedDate,
              });

              toast.success(`🎉 Attendance Marked: PRESENT at ${data.time} IST!`, {
                icon: '🟢',
                duration: 5000,
              });

              onVerified();
              fetchAttendanceStatus();
            }
          } catch (err) {
            const errData = err.response?.data;
            const code = errData?.code || 'VERIFICATION_FAILED';
            const msg = errData?.message || err.message || 'Geofence verification failed';

            if (code === 'LOW_GPS_ACCURACY') {
              setGpsError(msg);
              setVerificationFeedback({
                type: 'warning',
                message: msg,
                code,
              });
              toast.error(msg, { icon: '🛰️', duration: 6000 });
            } else if (code === 'OUTSIDE_GEOFENCE') {
              setTodaySession((prev) => ({
                ...prev,
                status: 'NOT MARKED',
                reason: msg,
                verification: 'Outside Hostel Boundary',
              }));
              setVerificationFeedback({
                type: 'error',
                message: msg,
                code,
                distanceMeters: errData?.distanceMeters,
              });
              if (!silentOnSuccess) {
                toast.error(msg, { icon: '📍', duration: 5000 });
              }
            } else if (code === 'CROSS_HOSTEL_FORBIDDEN') {
              toast.error(msg, { icon: '🚫', duration: 6000 });
              setVerificationFeedback({
                type: 'error',
                message: msg,
                code,
              });
            } else {
              setGpsError(msg);
              setVerificationFeedback({
                type: 'error',
                message: msg,
                code,
              });
            }
          } finally {
            setVerifying(false);
          }
        },
        (error) => {
          setVerifying(false);
          let message = 'Unable to retrieve device GPS location.';
          if (error.code === error.PERMISSION_DENIED) {
            message = 'Location permission was denied. Please allow location access in your browser settings to verify attendance.';
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            message = 'Location signal unavailable. Move near a window or outdoors to acquire GPS satellites.';
          } else if (error.code === error.TIMEOUT) {
            message = 'GPS location request timed out. Please try again.';
          }
          setGpsError(message);
          toast.error(message, { icon: '⚠️' });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    },
    [user, verifying, onVerified, fetchAttendanceStatus]
  );

  const isPresent = todaySession.status === 'PRESENT';
  const isAbsent = todaySession.status === 'ABSENT';
  const isNotMarked = !isPresent && !isAbsent;

  return (
    <>
      {/* ── TOP STICKY ATTENDANCE STATUS CARD & NOTIFICATION ── */}
      <div
        className="hostel-attendance-container"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 44,
          background: 'var(--bg-card, #1e293b)',
          borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
          backdropFilter: 'blur(12px)',
          transition: 'all 0.2s ease',
        }}
      >
        {/* Compact Header Summary Bar */}
        <div
          onClick={() => setCardExpanded((prev) => !prev)}
          style={{
            padding: '10px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            userSelect: 'none',
            background: isPresent
              ? 'linear-gradient(90deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.08) 100%)'
              : pendingRequest
              ? 'linear-gradient(90deg, rgba(79, 70, 229, 0.2) 0%, rgba(6, 182, 212, 0.15) 100%)'
              : 'transparent',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {/* Status Indicator Icon */}
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: isPresent
                  ? 'rgba(16, 185, 129, 0.22)'
                  : isAbsent
                  ? 'rgba(239, 68, 68, 0.22)'
                  : verifying
                  ? 'rgba(99, 102, 241, 0.22)'
                  : 'rgba(245, 158, 11, 0.22)',
                color: isPresent
                  ? '#10b981'
                  : isAbsent
                  ? '#ef4444'
                  : verifying
                  ? '#6366f1'
                  : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                flexShrink: 0,
              }}
            >
              {isPresent ? (
                <MdCheckCircle />
              ) : isAbsent ? (
                <MdCancel />
              ) : verifying ? (
                <MdGpsFixed className="animate-spin" />
              ) : (
                <MdAccessTime />
              )}
            </div>

            {/* Quick Text Summary */}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 800,
                  color: isPresent
                    ? '#10b981'
                    : isAbsent
                    ? '#ef4444'
                    : 'var(--text-primary, #ffffff)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span>HOSTEL ATTENDANCE: {todaySession.status}</span>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 99,
                    fontWeight: 700,
                    background: isPresent
                      ? 'rgba(16, 185, 129, 0.2)'
                      : 'rgba(255, 255, 255, 0.1)',
                    color: isPresent ? '#10b981' : 'var(--text-muted, #94a3b8)',
                  }}
                >
                  {todaySession.hostel}
                </span>
                {todaySession.confirmedByServer && (
                  <span
                    style={{
                      fontSize: 10.5,
                      padding: '2px 7px',
                      borderRadius: 99,
                      fontWeight: 700,
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: '#10b981',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <MdSecurity size={12} /> Server Confirmed
                  </span>
                )}
              </div>

              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--text-secondary, #cbd5e1)',
                  marginTop: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span>📅 {todaySession.formattedDate}</span>
                {todaySession.time && (
                  <>
                    <span>•</span>
                    <span>
                      Marked at <strong>{todaySession.time} IST</strong>
                    </span>
                  </>
                )}
                {todaySession.method && (
                  <>
                    <span>•</span>
                    <span>Method: {todaySession.method}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right Header Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Quick Action Button */}
            {!isPresent && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  executePresenceVerification({ silentOnSuccess: false });
                }}
                disabled={verifying}
                style={{
                  background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 99,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: verifying ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
                  whiteSpace: 'nowrap',
                }}
              >
                <MdMyLocation size={14} />
                {verifying ? 'Verifying...' : 'Check Presence'}
              </button>
            )}

            <button
              type="button"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted, #94a3b8)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: 4,
              }}
            >
              {cardExpanded ? <MdKeyboardArrowUp size={22} /> : <MdKeyboardArrowDown size={22} />}
            </button>
          </div>
        </div>

        {/* ── EXPANDED EXACT ATTENDANCE DETAIL SECTION (Requirement 5 Spec) ── */}
        {cardExpanded && (
          <div
            style={{
              padding: '14px 18px 18px',
              borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
              background: 'rgba(0, 0, 0, 0.12)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
                marginBottom: 14,
              }}
            >
              {/* Field 1: Hostel */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Hostel
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary, #ffffff)', marginTop: 2 }}>
                  {todaySession.hostel} {todaySession.hostelName ? `(${todaySession.hostelName})` : ''}
                </div>
              </div>

              {/* Field 2: Date */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Attendance Date
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary, #ffffff)', marginTop: 2 }}>
                  {todaySession.formattedDate}
                </div>
              </div>

              {/* Field 3: Status */}
              <div
                style={{
                  background: isPresent
                    ? 'rgba(16, 185, 129, 0.08)'
                    : isAbsent
                    ? 'rgba(239, 68, 68, 0.08)'
                    : 'rgba(245, 158, 11, 0.08)',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: isPresent
                    ? '1px solid rgba(16, 185, 129, 0.3)'
                    : isAbsent
                    ? '1px solid rgba(239, 68, 68, 0.3)'
                    : '1px solid rgba(245, 158, 11, 0.3)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Attendance Status
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 900,
                    color: isPresent ? '#10b981' : isAbsent ? '#ef4444' : '#f59e0b',
                    marginTop: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {todaySession.status}
                </div>
              </div>

              {/* Field 4: Exact Marked Time */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Exact Marked Time
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary, #ffffff)', marginTop: 2 }}>
                  {todaySession.time ? `${todaySession.time} IST` : 'Not recorded yet'}
                </div>
              </div>

              {/* Field 5: Method */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Attendance Method
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary, #ffffff)', marginTop: 2 }}>
                  {todaySession.method || (todaySession.autoAttendanceEnabled ? 'Automatic (GPS Geofence)' : 'Manual')}
                </div>
              </div>

              {/* Field 6: Verification Status */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Verification
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: isPresent ? '#10b981' : 'var(--text-secondary, #cbd5e1)',
                    marginTop: 2,
                  }}
                >
                  {verifying
                    ? 'Verifying GPS signal...'
                    : todaySession.verification || (isPresent ? 'Successful' : 'Pending Presence Verification')}
                </div>
              </div>
            </div>

            {/* Verification In-Progress Indicator */}
            {verifying && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'rgba(99, 102, 241, 0.12)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  color: '#818cf8',
                  fontSize: 12.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <MdGpsFixed className="animate-spin" size={18} />
                <span>
                  Acquiring high-accuracy GPS coordinates and evaluating {todaySession.hostel} geofence boundary (permitted radius: {todaySession.permittedRadiusMeters}m)...
                </span>
              </div>
            )}

            {/* Rejection / Accuracy / Location Reason Box */}
            {todaySession.reason && !isPresent && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  color: '#fbbf24',
                  fontSize: 12.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <MdInfoOutline size={18} style={{ flexShrink: 0 }} />
                <span>{todaySession.reason}</span>
              </div>
            )}

            {/* GPS Accuracy Warning */}
            {gpsError && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: 12.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <MdWarning size={18} style={{ flexShrink: 0 }} />
                <span>{gpsError}</span>
              </div>
            )}

            {/* Action Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => executePresenceVerification({ silentOnSuccess: false })}
                  disabled={verifying}
                  style={{
                    background: isPresent
                      ? 'rgba(16, 185, 129, 0.18)'
                      : 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                    color: isPresent ? '#10b981' : '#fff',
                    border: isPresent ? '1px solid rgba(16, 185, 129, 0.4)' : 'none',
                    borderRadius: 10,
                    padding: '8px 16px',
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: verifying ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: isPresent ? 'none' : '0 2px 10px rgba(79, 70, 229, 0.25)',
                  }}
                >
                  <MdRefresh className={verifying ? 'animate-spin' : ''} size={16} />
                  {verifying
                    ? 'Verifying Location...'
                    : isPresent
                    ? 'Re-verify GPS Presence'
                    : 'Verify My Presence Now'}
                </button>

                <button
                  type="button"
                  onClick={onOpenHistory}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: 'var(--text-secondary, #cbd5e1)',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
                    borderRadius: 10,
                    padding: '8px 16px',
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <MdHistory size={16} />
                  View Attendance History
                </button>
              </div>

              {/* GPS Diagnostic Tag */}
              {gpsData && (
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-muted, #94a3b8)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <MdSignalCellularAlt size={14} style={{ color: gpsData.accuracy <= 25 ? '#10b981' : '#f59e0b' }} />
                  <span>
                    Reported GPS Accuracy: <strong>±{Math.round(gpsData.accuracy)}m</strong>{' '}
                    {gpsData.accuracy <= 25 ? '(High Precision)' : '(Fair Precision)'}
                  </span>
                </div>
              )}
            </div>

            {/* Platform Limitation Notice (Requirement 3 & 9) */}
            <div
              style={{
                marginTop: 14,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px dashed rgba(255, 255, 255, 0.08)',
                fontSize: 11,
                color: 'var(--text-muted, #94a3b8)',
                lineHeight: 1.45,
              }}
            >
              ℹ️ <strong>Mobile Geofence Operation:</strong> Web applications verify location while active in the foreground when you open the portal. Background location tracking when the browser is closed is restricted by OS privacy policies; install the native application package for background geofence services.
            </div>
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
        @media (max-width: 640px) {
          .hostel-attendance-container {
            font-size: 13px;
          }
        }
      `}</style>
    </>
  );
}
