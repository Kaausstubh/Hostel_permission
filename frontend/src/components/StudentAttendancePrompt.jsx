/**
 * StudentAttendancePrompt Component
 * Production-ready Attendance Pop-up & Verification for HEIMDALL.
 *
 * Implements:
 * 1. ATTENDANCE POP-UP MODAL:
 *    - Automatically opens on app open / login when there is an active pending attendance round.
 *    - Automatically initiates GPS location verification and displays live real-time progress.
 *    - Displays celebratory PRESENT or final ABSENT card on verification completion before smoothly auto-closing.
 *    - Never opens uninvited after attendance is already finalized (persists across refreshes).
 * 2. 2-HOUR VERIFICATION WINDOW: Live countdown in HH:MM:SS format
 *    calculated from reliable server timestamp (expiresAt) and persisted across reloads.
 * 3. MAXIMUM 3 ACCEPTED GPS CHECKS: "Location checks remaining: X/3".
 * 4. UI CARD / MODAL FIELDS:
 *    - Field 1: Attendance Status (VERIFYING / PENDING / PRESENT / ABSENT / ON APPROVED LEAVE)
 *    - Field 2: Verification Time Remaining (HH:MM:SS)
 *    - Field 3: Location Checks Remaining (X/3 with visual indicator dots)
 *    - Field 4: Location Status (VERIFYING / INSIDE HOSTEL / OUTSIDE HOSTEL / LOCATION UNAVAILABLE)
 *    - Field 5: Action Button with live spinning GPS indicator
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdGpsFixed,
  MdWarning,
  MdAccessTime,
  MdClose,
  MdCheckCircle,
  MdCancel,
  MdLocationOn,
  MdShield,
} from 'react-icons/md';

const normalizeHostelCode = (hostel) => {
  if (!hostel) return 'BH2';
  const upper = String(hostel).toUpperCase();
  if (upper.includes('BH2') || upper.includes('KRISHNA') || upper.includes('BH-2')) return 'BH2';
  if (upper.includes('BH1') || upper.includes('BRAHMAPUTRA') || upper.includes('BH-1')) return 'BH1';
  if (upper.includes('GH1') || upper.includes('INDRAYANI') || upper.includes('GH-1')) return 'GH1';
  if (upper.includes('GH2') || upper.includes('SINDHU') || upper.includes('GH-2')) return 'GH2';
  return 'BH2';
};

const formatCountdown = (totalSeconds) => {
  if (isNaN(totalSeconds) || totalSeconds <= 0) return '00:00:00';
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export default function StudentAttendancePrompt({
  user,
  socket,
  onVerified = () => {},
  onStatusChange = () => {},
  externalOpenTrigger = 0,
  onOpenHistory = () => {},
}) {
  const assignedHostel = normalizeHostelCode(user?.hostel);

  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const onOpenHistoryRef = useRef(onOpenHistory);
  onOpenHistoryRef.current = onOpenHistory;

  const [sessionData, setSessionData] = useState({
    status: 'PENDING',
    displayStatus: 'Pending Verification',
    isMarked: false,
    isFinalized: false,
    hostel: assignedHostel,
    hostelName: `${assignedHostel} Hostel`,
    date: new Date().toISOString().slice(0, 10),
    formattedDate: 'Today',
    time: null,
    attemptsCount: 0,
    maxAttempts: 3,
    attemptsRemaining: 3,
    sessionStart: null,
    expiresAt: null,
    remainingSeconds: 7200,
    locationStatus: 'NOT CHECKED',
    message: null,
    hasActiveSession: false,
    verificationSessionId: null,
  });

  const [isOpen, setIsOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyingStage, setVerifyingStage] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);
  const [closingNotice, setClosingNotice] = useState(null);

  const lastExternalTriggerRef = useRef(externalOpenTrigger);
  const autoFinalizeTriggeredRef = useRef(false);
  const autoVerifyStartedRef = useRef(false);
  const finalizationNoticeRef = useRef(null);

  const isFinalized =
    sessionData.isFinalized ||
    sessionData.isMarked ||
    sessionData.status === 'PRESENT' ||
    sessionData.status === 'ABSENT' ||
    sessionData.status === 'ON_LEAVE';

  // ── Handle Server Response ──────────────────────────────────────────────────
  const handleServerResponse = useCallback(
    (data, { isUserAction = false, showClosingDelay = false } = {}) => {
      const statusUpper = String(data.status || 'PENDING').toUpperCase();
      const isPresent = statusUpper === 'PRESENT';
      const isAbsent = statusUpper === 'ABSENT';
      const isOnLeave = statusUpper === 'ON_LEAVE' || statusUpper === 'ON APPROVED LEAVE';
      const isFinal = isPresent || isAbsent || isOnLeave || Boolean(data.isFinalized || data.isMarked);

      const count = typeof data.attemptsCount === 'number'
        ? data.attemptsCount
        : typeof data.attemptsUsed === 'number'
          ? data.attemptsUsed
          : typeof data.attempt === 'number'
            ? data.attempt
            : 0;
      const remaining = typeof data.attemptsRemaining === 'number' ? data.attemptsRemaining : Math.max(0, 3 - count);

      setSessionData((prev) => ({
        ...prev,
        ...data,
        status: statusUpper,
        displayStatus: data.displayStatus || statusUpper,
        isFinalized: isFinal,
        isMarked: isFinal,
        attemptsCount: count,
        maxAttempts: 3,
        attemptsRemaining: remaining,
        locationStatus: data.locationStatus || (isPresent ? 'INSIDE HOSTEL' : count > 0 ? 'OUTSIDE HOSTEL' : 'NOT CHECKED'),
        expiresAt: data.expiresAt || prev.expiresAt,
        remainingSeconds: typeof data.remainingSeconds === 'number' ? data.remainingSeconds : prev.remainingSeconds,
        hasActiveSession: Boolean(data.hasActiveSession),
        verificationSessionId: data.verificationSessionId || prev.verificationSessionId,
      }));

      if (data.locationStatus === 'OUTSIDE HOSTEL' || data.locationStatus === 'LOCATION UNAVAILABLE') {
        setErrorMessage(data.message);
      } else if (data.status !== 'PENDING') {
        setErrorMessage(null);
      }

      if (isFinal) {
        if (showClosingDelay || isUserAction) {
          // Keep modal open to show celebratory / final result banner before auto-closing
          setClosingNotice({
            status: statusUpper,
            time: data.time || 'now',
            hostel: data.hostel || assignedHostel,
            message: isPresent
              ? `Attendance Verified: PRESENT at ${data.time || 'now'}`
              : isAbsent
              ? `Attendance Finalized: ABSENT (${data.message || data.remark || '3 checks exhausted or window expired'})`
              : 'Attendance Status: ON APPROVED LEAVE',
          });

          const noticeKey = data.recordId || `${data.date || ''}:${statusUpper}:${data.markedAt || data.time || ''}`;
          if (finalizationNoticeRef.current !== noticeKey) {
            finalizationNoticeRef.current = noticeKey;
            if (isPresent) {
              toast.success(`🎉 Attendance Verified: PRESENT at ${data.time || 'now'}!`, { id: 'attendance-status-toast', duration: 5000 });
              if (onVerifiedRef.current) onVerifiedRef.current();
            } else if (isOnLeave) {
              toast.success('Attendance Status: ON APPROVED LEAVE', { id: 'attendance-status-toast', duration: 5000 });
            } else if (isAbsent) {
              toast.error(`Attendance Finalized: ABSENT (${data.message || data.remark || 'Verification window expired or 3 checks exhausted'})`, { id: 'attendance-status-toast', duration: 6000 });
            }
          }

          // Smoothly close modal after showing result
          setTimeout(() => {
            setClosingNotice(null);
            setIsOpen(false);
          }, 2600);
        } else {
          // If already finalized on initial page load, never open popup
          setClosingNotice(null);
          setIsOpen(false);
        }
      } else {
        if (isUserAction) {
          if (data.locationStatus === 'OUTSIDE HOSTEL') {
            toast.error(`Outside hostel geofence! Location checks remaining: ${remaining}/3`, { id: 'attendance-geofence-toast', icon: '⚠️' });
          } else if (data.locationStatus === 'LOCATION UNAVAILABLE') {
            toast.error(`Location unavailable! Location checks remaining: ${remaining}/3`, { id: 'attendance-geofence-toast', icon: '⚠️' });
          }
        }
      }

      if (onStatusChangeRef.current) {
        onStatusChangeRef.current({
          isMarked: isFinal,
          status: statusUpper,
          hasPending: Boolean(data.hasActiveSession) && !isFinal,
          pendingRequest: !isFinal ? { remainingSeconds: data.remainingSeconds || 7200 } : null,
          todayRecord: isFinal
            ? {
                status: isPresent ? 'present' : isOnLeave ? 'on_leave' : 'absent',
                time: data.time,
                date: data.date,
                hostel: data.hostel || assignedHostel,
              }
            : null,
          todayStatus: data,
        });
      }
    },
    [assignedHostel]
  );

  // ── Sync with Server on Mount ───────────────────────────────────────────────
  const fetchAttendanceStatus = useCallback(async () => {
    if (!user || user.role !== 'student') return;

    try {
      const res = await api.get('/attendance/today').catch(() => null);
      if (res?.data?.success) {
        handleServerResponse(res.data, { isUserAction: false, showClosingDelay: false });
        // If there is an active pending session, open modal automatically so user sees live process
        if (res.data.hasActiveSession && !res.data.isFinalized && !res.data.isMarked && res.data.status === 'PENDING') {
          setIsOpen(true);
        }
      }
    } catch (_) {}
  }, [user, handleServerResponse]);

  useEffect(() => {
    fetchAttendanceStatus();
  }, [fetchAttendanceStatus]);

  // ── Real-time Socket.IO trigger: open prompt & verify when staff initiates a round ──
  useEffect(() => {
    if (!socket) return;

    const handleAttendanceRequested = () => {
      autoVerifyStartedRef.current = false;
      setClosingNotice(null);
      setIsOpen(true);
      fetchAttendanceStatus();
      toast('📍 Night attendance verification requested by hostel staff. Verifying location...', {
        id: 'attendance-request-toast',
        icon: '🔔',
        duration: 5000,
      });
    };

    socket.on('attendance_requested', handleAttendanceRequested);
    socket.on('room_attendance_requested', handleAttendanceRequested);

    return () => {
      socket.off('attendance_requested', handleAttendanceRequested);
      socket.off('room_attendance_requested', handleAttendanceRequested);
    };
  }, [socket, fetchAttendanceStatus]);

  // ── Reopen Modal on External Trigger (e.g. Header Pill Click) ────────────────
  useEffect(() => {
    if (externalOpenTrigger > 0 && externalOpenTrigger !== lastExternalTriggerRef.current) {
      lastExternalTriggerRef.current = externalOpenTrigger;
      if (!isFinalized && sessionData.hasActiveSession) {
        setIsOpen(true);
      } else {
        if (onOpenHistoryRef.current) onOpenHistoryRef.current();
      }
    }
  }, [externalOpenTrigger, isFinalized, sessionData.hasActiveSession]);

  // ── Countdown Timer — always ticks once session is active ───────────────────
  useEffect(() => {
    if (isFinalized || !sessionData.hasActiveSession) return;

    const timer = setInterval(() => {
      setSessionData((prev) => {
        let secLeft = prev.remainingSeconds;
        if (prev.expiresAt) {
          secLeft = Math.max(0, Math.floor((new Date(prev.expiresAt).getTime() - Date.now()) / 1000));
        } else {
          secLeft = Math.max(0, prev.remainingSeconds - 1);
        }
        return { ...prev, remainingSeconds: secLeft };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isFinalized, sessionData.hasActiveSession]);

  // ── When countdown hits 0 or attempts exhausted → finalize via server ───────
  useEffect(() => {
    if (isFinalized || !sessionData.hasActiveSession || !sessionData.verificationSessionId) return;
    const expired = sessionData.remainingSeconds <= 0;
    const exhausted = sessionData.attemptsRemaining <= 0;
    if ((expired || exhausted) && sessionData.status === 'PENDING' && !autoFinalizeTriggeredRef.current) {
      autoFinalizeTriggeredRef.current = true;
      // Ask server to finalize as ABSENT
      api.post('/attendance/auto-verify', {
        fetchFailed: false,
        exhausted: true,
        expired,
        hostel: assignedHostel,
        verificationSessionId: sessionData.verificationSessionId,
      })
        .then((res) => { if (res.data) handleServerResponse(res.data, { isUserAction: true, showClosingDelay: true }); })
        .catch(() => fetchAttendanceStatus());
    }
  }, [sessionData.remainingSeconds, sessionData.attemptsRemaining, sessionData.status, isFinalized, assignedHostel, fetchAttendanceStatus, handleServerResponse, sessionData.verificationSessionId]);

  // ── Handle GPS Retrieval Failure (Atomic Server Log) ────────────────────────
  const handleGpsFailure = useCallback(
    async (msg, code = 'GPS_FETCH_FAILED') => {
      try {
        const res = await api.post('/attendance/auto-verify', {
          fetchFailed: true,
          gpsError: true,
          code,
          reason: msg,
          hostel: assignedHostel,
          verificationSessionId: sessionData.verificationSessionId,
        });
        if (res.data) {
          handleServerResponse(res.data, { isUserAction: true, showClosingDelay: Boolean(res.data.isFinalized || res.data.status === 'ABSENT') });
        }
      } catch (err) {
        const serverMsg = err.response?.data?.message || msg;
        setErrorMessage(serverMsg);
        toast.error(serverMsg, { id: 'attendance-error-toast' });
      } finally {
        setVerifying(false);
        setVerifyingStage('');
      }
    },
    [assignedHostel, handleServerResponse, sessionData.verificationSessionId]
  );

  // ── Core Presence Verification Logic ────────────────────────────────────────
  const executePresenceVerification = useCallback(async () => {
    if (
      verifying || isFinalized || !sessionData.hasActiveSession || !sessionData.verificationSessionId ||
      sessionData.attemptsRemaining <= 0 || sessionData.remainingSeconds <= 0
    ) {
      return;
    }

    setVerifying(true);
    setErrorMessage(null);
    setVerifyingStage('🛰️ Acquiring GPS coordinates from device...');
    setSessionData((prev) => ({ ...prev, locationStatus: 'VERIFYING' }));

    if (!navigator.geolocation) {
      await handleGpsFailure('Geolocation is not supported by your browser or device.', 'GEO_NOT_SUPPORTED');
      setVerifying(false);
      setVerifyingStage('');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          setVerifyingStage('📍 Validating coordinates with hostel geofence...');
          const { latitude, longitude, accuracy } = position.coords;
          const res = await api.post('/attendance/auto-verify', {
            lat: latitude,
            lng: longitude,
            accuracy,
            timestamp: position.timestamp,
            hostel: assignedHostel,
            verificationSessionId: sessionData.verificationSessionId,
          });

          if (res.data?.success) {
            handleServerResponse(res.data, { isUserAction: true, showClosingDelay: true });
          } else {
            await handleGpsFailure(res.data?.message || 'Geofence check failed.', 'OUTSIDE_GEOFENCE');
          }
        } catch (err) {
          const msg = err.response?.data?.message || err.message || 'Verification failed.';
          setErrorMessage(msg);
          fetchAttendanceStatus();
        } finally {
          setVerifying(false);
          setVerifyingStage('');
        }
      },
      async (error) => {
        let msg = 'Unable to acquire device location.';
        let code = 'GPS_FETCH_FAILED';

        if (error.code === error.PERMISSION_DENIED) {
          msg = 'Location permission was denied. Please allow location access in your browser settings.';
          code = 'PERMISSION_DENIED';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          msg = 'Location signal unavailable. Move near a window or open space.';
          code = 'POSITION_UNAVAILABLE';
        } else if (error.code === error.TIMEOUT) {
          msg = 'GPS location request timed out. Please try again.';
          code = 'TIMEOUT';
        }

        await handleGpsFailure(msg, code);
        setVerifying(false);
        setVerifyingStage('');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [verifying, isFinalized, sessionData, assignedHostel, handleGpsFailure, handleServerResponse, fetchAttendanceStatus]);

  // ── AUTOMATIC VERIFICATION ON OPEN / LOGIN ──────────────────────────────────
  useEffect(() => {
    if (
      sessionData.hasActiveSession &&
      !isFinalized &&
      sessionData.status === 'PENDING' &&
      sessionData.verificationSessionId &&
      sessionData.attemptsRemaining > 0 &&
      sessionData.remainingSeconds > 0 &&
      !verifying &&
      !autoVerifyStartedRef.current
    ) {
      autoVerifyStartedRef.current = true;
      setIsOpen(true);
      const timer = setTimeout(() => {
        executePresenceVerification();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [
    sessionData.hasActiveSession,
    sessionData.status,
    sessionData.verificationSessionId,
    sessionData.attemptsRemaining,
    sessionData.remainingSeconds,
    isFinalized,
    verifying,
    executePresenceVerification,
  ]);

  // ── RENDER GUARDS ──
  // If finalized and no closing celebration notice is running, do NOT render modal
  if ((isFinalized && !closingNotice) || (!sessionData.hasActiveSession && !closingNotice)) {
    return null;
  }

  // If student closed the pop-up modal, render only a discreet sticky prompt banner
  if (!isOpen && !closingNotice) {
    return (
      <div
        style={{
          background: 'linear-gradient(90deg, #1e1b4b, #312e81)',
          color: '#ffffff',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(129, 140, 248, 0.3)',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.25)',
          zIndex: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ fontSize: 18 }}>📍</span>
          <span>
            <strong>Night Attendance Pending:</strong> Attendance verification expires in{' '}
            <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#fbbf24' }}>
              {formatCountdown(sessionData.remainingSeconds)}
            </span>
            . Checks remaining: {sessionData.attemptsRemaining}/3.
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            if (!verifying) executePresenceVerification();
          }}
          style={{
            background: 'linear-gradient(135deg, #0284c7, #2563eb)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            fontSize: 12.5,
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <MdGpsFixed size={14} /> Open Verification Modal
        </button>
      </div>
    );
  }

  // ── Location Status Helpers ──
  const locStatus = sessionData.locationStatus || 'NOT CHECKED';
  let locBadgeBg = 'rgba(148, 163, 184, 0.12)';
  let locBadgeColor = '#94a3b8';
  let locBadgeBorder = '1px solid rgba(148, 163, 184, 0.25)';

  if (locStatus === 'INSIDE HOSTEL' || closingNotice?.status === 'PRESENT') {
    locBadgeBg = 'rgba(16, 185, 129, 0.15)';
    locBadgeColor = '#10b981';
    locBadgeBorder = '1px solid rgba(16, 185, 129, 0.35)';
  } else if (locStatus === 'OUTSIDE HOSTEL') {
    locBadgeBg = 'rgba(239, 68, 68, 0.15)';
    locBadgeColor = '#ef4444';
    locBadgeBorder = '1px solid rgba(239, 68, 68, 0.35)';
  } else if (locStatus === 'LOCATION UNAVAILABLE') {
    locBadgeBg = 'rgba(245, 158, 11, 0.15)';
    locBadgeColor = '#f59e0b';
    locBadgeBorder = '1px solid rgba(245, 158, 11, 0.35)';
  } else if (locStatus === 'VERIFYING' || verifying) {
    locBadgeBg = 'rgba(56, 189, 248, 0.15)';
    locBadgeColor = '#38bdf8';
    locBadgeBorder = '1px solid rgba(56, 189, 248, 0.35)';
  }

  const isExpired = sessionData.remainingSeconds <= 0;
  const isExhausted = sessionData.attemptsRemaining <= 0;
  const isButtonDisabled = verifying || locStatus === 'VERIFYING' || isExpired || isExhausted || isFinalized || Boolean(closingNotice);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !closingNotice) {
          setIsOpen(false);
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendance-modal-title"
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--bg-card, #1e293b)',
          color: 'var(--text-primary, #ffffff)',
          borderRadius: 18,
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
          boxShadow: '0 20px 45px rgba(0, 0, 0, 0.45)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'fadeInUp 0.22s ease-out',
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(99, 102, 241, 0.25)',
                color: '#818cf8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              <MdShield />
            </div>
            <div>
              <h2
                id="attendance-modal-title"
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  margin: 0,
                  color: '#ffffff',
                  letterSpacing: '-0.01em',
                }}
              >
                Hostel Night Attendance
              </h2>
              <div style={{ fontSize: 11.5, color: '#cbd5e1', marginTop: 2 }}>
                Assigned Hostel: <strong>{sessionData.hostelName || sessionData.hostel}</strong>
              </div>
            </div>
          </div>

          {!closingNotice && (
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title="Minimize to banner"
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: 'none',
                borderRadius: 8,
                color: '#cbd5e1',
                padding: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MdClose size={18} />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* CELEBRATION / FINALIZATION CARD (When status is marked) */}
          {closingNotice ? (
            <div
              style={{
                background: closingNotice.status === 'PRESENT'
                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(5, 150, 105, 0.3) 100%)'
                  : 'linear-gradient(135deg, rgba(239, 68, 68, 0.18) 0%, rgba(185, 28, 28, 0.3) 100%)',
                border: closingNotice.status === 'PRESENT'
                  ? '1.5px solid rgba(16, 185, 129, 0.6)'
                  : '1.5px solid rgba(239, 68, 68, 0.6)',
                borderRadius: 14,
                padding: '18px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                animation: 'fadeInUp 0.25s ease-out',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: closingNotice.status === 'PRESENT' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  color: closingNotice.status === 'PRESENT' ? '#10b981' : '#ef4444',
                }}
              >
                {closingNotice.status === 'PRESENT' ? <MdCheckCircle /> : <MdCancel />}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#ffffff' }}>
                {closingNotice.status === 'PRESENT' ? '🎉 Attendance Verified: PRESENT' : 'Attendance Finalized: ABSENT'}
              </div>
              <div style={{ fontSize: 13, color: closingNotice.status === 'PRESENT' ? '#a7f3d0' : '#fca5a5' }}>
                {closingNotice.status === 'PRESENT'
                  ? `Marked at ${closingNotice.time || 'now'} inside ${sessionData.hostelName || sessionData.hostel}`
                  : closingNotice.message}
              </div>
              <div style={{ fontSize: 11.5, color: closingNotice.status === 'PRESENT' ? '#6ee7b7' : '#f87171', marginTop: 4 }}>
                Closing automatically...
              </div>
            </div>
          ) : verifying ? (
            /* LIVE VERIFICATION PROGRESS CARD */
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(37, 99, 235, 0.18) 100%)',
                border: '1.5px solid rgba(56, 189, 248, 0.45)',
                borderRadius: 14,
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                animation: 'fadeInUp 0.2s ease-out',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#38bdf8', fontWeight: 800, fontSize: 14 }}>
                <MdGpsFixed className="animate-spin" size={20} />
                <span>{verifyingStage || 'Acquiring GPS location & verifying geofence...'}</span>
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
                📡 Acquiring high-accuracy coordinates to verify presence inside <strong>{sessionData.hostelName || sessionData.hostel}</strong>.
              </div>
              <div style={{ height: 4, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
                <div
                  style={{
                    height: '100%',
                    width: '100%',
                    background: 'linear-gradient(90deg, #38bdf8, #818cf8, #38bdf8)',
                    animation: 'shimmer 1.5s infinite linear',
                    backgroundSize: '200% 100%',
                  }}
                />
              </div>
            </div>
          ) : (
            /* Instructions */
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.5,
                color: 'var(--text-secondary, #cbd5e1)',
                background: 'rgba(255, 255, 255, 0.04)',
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              📍 <strong>Verification Instructions:</strong> You must be physically present inside your designated hostel
              building (<strong>{sessionData.hostel}</strong>). Make sure your browser has location permission enabled.
            </div>
          )}

          {/* 4 EXACT FIELDS SPECIFICATION */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
            }}
          >
            {/* Field 1: Attendance Status */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>
                Attendance Status
              </div>
              <div>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 10px',
                    borderRadius: 99,
                    fontSize: 12,
                    fontWeight: 800,
                    background: verifying
                      ? 'rgba(56, 189, 248, 0.15)'
                      : (closingNotice?.status === 'PRESENT' || sessionData.status === 'PRESENT')
                      ? 'rgba(16, 185, 129, 0.15)'
                      : (closingNotice?.status === 'ABSENT' || sessionData.status === 'ABSENT')
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'rgba(245, 158, 11, 0.15)',
                    color: verifying
                      ? '#38bdf8'
                      : (closingNotice?.status === 'PRESENT' || sessionData.status === 'PRESENT')
                      ? '#10b981'
                      : (closingNotice?.status === 'ABSENT' || sessionData.status === 'ABSENT')
                      ? '#ef4444'
                      : '#f59e0b',
                    border: verifying
                      ? '1px solid rgba(56, 189, 248, 0.35)'
                      : (closingNotice?.status === 'PRESENT' || sessionData.status === 'PRESENT')
                      ? '1px solid rgba(16, 185, 129, 0.35)'
                      : (closingNotice?.status === 'ABSENT' || sessionData.status === 'ABSENT')
                      ? '1px solid rgba(239, 68, 68, 0.35)'
                      : '1px solid rgba(245, 158, 11, 0.35)',
                  }}
                >
                  {verifying ? (
                    <>
                      <MdGpsFixed className="animate-spin" size={14} /> FETCHING GPS...
                    </>
                  ) : closingNotice?.status === 'PRESENT' || sessionData.status === 'PRESENT' ? (
                    <>
                      <MdCheckCircle size={14} /> PRESENT
                    </>
                  ) : closingNotice?.status === 'ABSENT' || sessionData.status === 'ABSENT' ? (
                    <>
                      <MdCancel size={14} /> ABSENT
                    </>
                  ) : (
                    <>
                      <MdAccessTime size={14} /> {sessionData.status}
                    </>
                  )}
                </span>
              </div>
            </div>

            {/* Field 2: Verification Time Remaining */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>
                Verification Time Remaining
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 16,
                  fontWeight: 800,
                  color: isExpired ? '#ef4444' : '#38bdf8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <MdAccessTime size={16} />
                {formatCountdown(sessionData.remainingSeconds)}
              </div>
            </div>

            {/* Field 3: Location Checks Remaining */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>
                Location Checks Remaining
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: sessionData.attemptsRemaining > 0 ? '#10b981' : '#ef4444',
                  }}
                >
                  {sessionData.attemptsRemaining}/3
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3].map((num) => {
                    const isUsed = num <= sessionData.attemptsCount;
                    return (
                      <span
                        key={num}
                        title={`Check ${num}: ${isUsed ? 'Used' : 'Available'}`}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: isUsed ? '#ef4444' : '#10b981',
                          opacity: isUsed ? 0.7 : 1,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Field 4: Location Status */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>
                Location Status
              </div>
              <div>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 8px',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 800,
                    background: locBadgeBg,
                    color: locBadgeColor,
                    border: locBadgeBorder,
                  }}
                >
                  {verifying ? (
                    <>
                      <MdLocationOn className="animate-spin" size={13} /> VERIFYING GEOFENCE...
                    </>
                  ) : closingNotice?.status === 'PRESENT' || locStatus === 'INSIDE HOSTEL' ? (
                    <>
                      <MdCheckCircle size={13} /> INSIDE HOSTEL
                    </>
                  ) : (
                    <>
                      <MdLocationOn size={13} /> {locStatus}
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Time Expired Notice */}
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-secondary, #94a3b8)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(56, 189, 248, 0.06)',
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid rgba(56, 189, 248, 0.18)',
            }}
          >
            <MdAccessTime size={14} style={{ color: '#38bdf8' }} />
            <span>
              Attendance verification expires in{' '}
              <strong style={{ color: '#38bdf8' }}>{formatCountdown(sessionData.remainingSeconds)}</strong>
            </span>
          </div>

          {/* Error / Outside Geofence Feedback Banner */}
          {errorMessage && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                fontSize: 12.5,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                lineHeight: 1.4,
              }}
            >
              <MdWarning size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>{errorMessage}</div>
            </div>
          )}

          {/* Field 5: Action Button to trigger verification */}
          <div>
            <button
              type="button"
              onClick={executePresenceVerification}
              disabled={isButtonDisabled}
              style={{
                width: '100%',
                background: isButtonDisabled
                  ? 'rgba(255, 255, 255, 0.08)'
                  : 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
                color: isButtonDisabled ? 'var(--text-muted, #94a3b8)' : '#ffffff',
                border: 'none',
                borderRadius: 12,
                padding: '12px 20px',
                fontSize: 14,
                fontWeight: 800,
                cursor: isButtonDisabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: isButtonDisabled ? 'none' : '0 4px 16px rgba(37, 99, 235, 0.4)',
                transition: 'all 0.15s ease',
              }}
            >
              <MdGpsFixed className={verifying ? 'animate-spin' : ''} size={18} />
              <span>
                {verifying
                  ? `Verifying GPS Location (${sessionData.attemptsCount + 1}/3)...`
                  : closingNotice?.status === 'PRESENT'
                  ? 'Verified: PRESENT'
                  : closingNotice?.status === 'ABSENT'
                  ? 'Finalized: ABSENT'
                  : isExhausted
                  ? 'All 3 Checks Exhausted (Marked Absent)'
                  : isExpired
                  ? 'Verification Window Expired'
                  : `Verify Location (${sessionData.attemptsRemaining}/3 checks left)`}
              </span>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
