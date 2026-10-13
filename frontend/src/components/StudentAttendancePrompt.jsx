/**
 * StudentAttendancePrompt Component
 * Automatic geofence-based attendance detection.
 * When hostel staff requests attendance, the student opens their device:
 * - If inside hostel geofence: automatically detects and marks attendance PRESENT.
 * - Else (outside hostel boundary or no location): marks ABSENT.
 * No biometric or fingerprint hardware authentication required.
 */

import { useState, useEffect, useRef } from 'react';
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
  MdEventNote,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
} from 'react-icons/md';

export default function StudentAttendancePrompt({
  user,
  socket,
  onVerified = () => {},
  onStatusChange = () => {},
  externalOpenTrigger = 0,
  onOpenHistory = () => {},
}) {
  const [pendingRequest, setPendingRequest] = useState(null);
  const [todayRecord, setTodayRecord] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Verification state
  const [verifying, setVerifying] = useState(false);
  const [gpsData, setGpsData] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const [verificationResult, setVerificationResult] = useState(null); // { type: 'present'|'absent'|'error', message, distanceMeters, accuracy }
  const hasAutoTriggeredRef = useRef(false);
  const lastExternalTriggerRef = useRef(externalOpenTrigger);

  const remainingSeconds = pendingRequest?.remainingSeconds ?? 0;

  // Poll for pending requests every 3.5s
  const checkPending = async () => {
    if (!user || user.role !== 'student') return;
    try {
      const res = await api.get('/attendance/pending');
      const reqData = res.data?.request;
      const todayRec = res.data?.todayRecord || null;
      const hasActive = Boolean(res.data?.success && res.data.hasPending && !reqData?.alreadyApproved);

      if (hasActive) {
        setPendingRequest(reqData);
      } else {
        setPendingRequest(null);
      }
      setTodayRecord(todayRec);

      if (onStatusChange) {
        onStatusChange({
          hasPending: hasActive,
          pendingRequest: hasActive ? reqData : null,
          todayRecord: todayRec,
        });
      }
    } catch {
      // silent fallback
    }
  };

  useEffect(() => {
    checkPending();
    const timer = setInterval(checkPending, 3500);
    return () => clearInterval(timer);
  }, [user]);

  // Listen to Socket.IO for instant zero-latency push
  useEffect(() => {
    if (!socket) return;
    const handleReq = () => {
      toast('Hostel staff requested attendance for your room!', {
        icon: '🏛️',
        duration: 6000,
      });
      hasAutoTriggeredRef.current = false;
      checkPending();
    };
    socket.on('attendance_requested', handleReq);
    return () => socket.off('attendance_requested', handleReq);
  }, [socket]);

  // Support external button click trigger from dashboard header
  useEffect(() => {
    if (externalOpenTrigger > 0 && externalOpenTrigger !== lastExternalTriggerRef.current) {
      lastExternalTriggerRef.current = externalOpenTrigger;
      setModalOpen(true);
      setVerificationResult(null);
      detectAndMarkAttendance();
    }
  }, [externalOpenTrigger]);

  // Automatically open popup modal & trigger GPS check as soon as an active request is detected
  useEffect(() => {
    if (pendingRequest?.id && !hasAutoTriggeredRef.current) {
      hasAutoTriggeredRef.current = true;
      setModalOpen(true);
      toast(`📍 Attendance request detected for Room ${pendingRequest.roomNo}! Checking hostel geofence...`, {
        icon: '🛰️',
        duration: 4000,
      });
      detectAndMarkAttendance(null, pendingRequest);
    }
  }, [pendingRequest?.id]);

  // Execute Geofence Attendance Detection
  const detectAndMarkAttendance = (coordsOverride = null, reqObj = null) => {
    const targetReq = reqObj || pendingRequest;
    if (!targetReq?.id) return;
    setVerifying(true);
    setVerificationResult(null);
    setGpsError(null);

    const submitWithCoords = async (coords) => {
      try {
        const res = await api.post(`/attendance/requests/${targetReq.id}/approve`, {
          gps_lat: coords.lat,
          gps_lng: coords.lng,
          gps_accuracy: coords.accuracy,
          timestamp: Date.now(),
        });

        const data = res.data;
        const nowStr = new Date().toISOString();
        const timeStr = data.time || new Date().toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });
        const dateStr = data.formattedDate || new Date().toLocaleDateString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

        if (data?.status === 'present' || data?.code === 'PRESENT') {
          setVerificationResult({
            type: 'present',
            message: data.message || 'Inside hostel geofence! Attendance marked PRESENT.',
            accuracy: data.accuracy ?? Math.round(coords.accuracy),
            time: timeStr,
            formattedDate: dateStr,
            markedAt: data.markedAt || nowStr,
          });
          toast.success(`Attendance Marked: PRESENT at ${timeStr} IST! (Inside hostel geofence)`, {
            icon: '🟢',
            duration: 5000,
          });

          // Update todayRecord
          setTodayRecord((prev) => ({
            ...prev,
            status: 'present',
            date: nowStr.slice(0, 10),
            formattedDate: dateStr,
            time: timeStr,
            markedAt: data.markedAt || nowStr,
            roomNo: targetReq.roomNo,
            method: 'self_approved',
          }));

          // Trigger browser notification if supported
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification('Attendance Marked: PRESENT', {
                body: `Room ${targetReq.roomNo}: Verified inside hostel geofence at ${timeStr}!`,
                icon: '/favicon.ico',
              });
            } catch (_) {}
          }

          onVerified();
          checkPending();
          setTimeout(() => {
            setModalOpen(false);
            setPendingRequest(null);
          }, 3200);
        } else {
          // Outside geofence -> Marked ABSENT
          setVerificationResult({
            type: 'absent',
            message: data.message || 'Outside hostel geofence. Attendance marked ABSENT.',
            distanceMeters: data.distanceMeters,
            time: timeStr,
            formattedDate: dateStr,
            markedAt: data.markedAt || nowStr,
          });
          toast.error(`Attendance Marked: ABSENT at ${timeStr} IST (Outside hostel boundary)`, {
            icon: '🔴',
            duration: 6000,
          });

          setTodayRecord((prev) => ({
            ...prev,
            status: 'absent',
            date: nowStr.slice(0, 10),
            formattedDate: dateStr,
            time: timeStr,
            markedAt: data.markedAt || nowStr,
            roomNo: targetReq.roomNo,
            method: 'self_approved',
            remark: data.message || 'Outside hostel geofence',
          }));

          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification('Attendance Marked: ABSENT', {
                body: `Device outside hostel geofence (${data.distanceMeters || 0}m away) at ${timeStr}`,
                icon: '/favicon.ico',
              });
            } catch (_) {}
          }

          onVerified();
          checkPending();
        }
      } catch (err) {
        const errData = err.response?.data;
        const msg = errData?.message || err.message || 'Verification failed';
        setVerificationResult({
          type: 'error',
          message: msg,
          code: errData?.code,
          distanceMeters: errData?.distanceMeters,
        });
        toast.error(msg);
      } finally {
        setVerifying(false);
      }
    };

    if (coordsOverride) {
      submitWithCoords(coordsOverride);
      return;
    }

    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      setVerifying(false);
      setVerificationResult({
        type: 'absent',
        message: 'Geolocation unavailable. Attendance marked ABSENT.',
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setGpsData(coords);
        submitWithCoords(coords);
      },
      (err) => {
        setGpsError(`Location error: ${err.message}. Please enable location permissions.`);
        setVerifying(false);
        setVerificationResult({
          type: 'absent',
          message: 'Location access denied or unavailable. Attendance marked ABSENT.',
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Open modal and auto-run geofence detection
  const handleOpenPrompt = () => {
    setModalOpen(true);
    setVerificationResult(null);
    detectAndMarkAttendance();
  };

  const hasActivePending = Boolean(pendingRequest && !pendingRequest.alreadyApproved);
  const isPresentToday = todayRecord?.status === 'present';
  const isAbsentToday = todayRecord?.status === 'absent';
  const todayDateFormatted = new Date(Date.now() + 5.5 * 3600 * 1000).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <>
      {/* ── REAL-TIME ATTENDANCE STATUS & NOTIFICATION BANNER ── */}
      {hasActivePending ? (
        /* State 1: Active Attendance Request In Progress */
        <div
          className="student-attendance-banner active-prompt"
          onClick={handleOpenPrompt}
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 45,
            background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
            color: '#fff',
            padding: '11px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(79, 70, 229, 0.35)',
            backdropFilter: 'blur(10px)',
            animation: 'slideDown 0.3s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.22)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}
            >
              <MdGpsFixed />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.01em' }}>
                Hostel Attendance Requested: Room {pendingRequest?.roomNo || user?.roomNo}!
              </div>
              <div style={{ fontSize: 12, opacity: 0.92, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>📍 Tap to detect geofence &amp; mark attendance</span>
                <span style={{ opacity: 0.75 }}>•</span>
                <span style={{ fontWeight: 700, background: 'rgba(0,0,0,0.2)', padding: '1px 6px', borderRadius: 99 }}>
                  {remainingSeconds}s remaining
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenPrompt();
            }}
            style={{
              background: '#fff',
              color: '#4f46e5',
              border: 'none',
              borderRadius: 99,
              padding: '7px 16px',
              fontSize: 12.5,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            Detect &amp; Mark Attendance
          </button>
        </div>
      ) : isPresentToday ? (
        /* State 2: Marked PRESENT Today */
        <div
          className="student-attendance-banner present-status"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 44,
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(5, 150, 105, 0.22) 100%)',
            borderBottom: '1.5px solid rgba(16, 185, 129, 0.45)',
            color: 'var(--text-primary)',
            padding: '10px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.22)',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              <MdCheckCircle />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#10b981', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Today's Attendance: MARKED PRESENT</span>
                <span style={{ fontSize: 11, background: 'rgba(16, 185, 129, 0.18)', padding: '2px 8px', borderRadius: 99, fontWeight: 700 }}>
                  Verified
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>📅 {todayRecord?.formattedDate || todayRecord?.date || todayDateFormatted}</span>
                <span>•</span>
                <span>⏰ Marked at <strong>{todayRecord?.time || 'Recorded'} IST</strong></span>
                <span>•</span>
                <span>Room {todayRecord?.roomNo || user?.roomNo || 'Assigned'} (Hostel Geofence Verified)</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenHistory}
            style={{
              background: 'rgba(16, 185, 129, 0.16)',
              color: '#10b981',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: 99,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            📋 View Attendance Records
          </button>
        </div>
      ) : isAbsentToday ? (
        /* State 3: Marked ABSENT Today */
        <div
          className="student-attendance-banner absent-status"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 44,
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.14) 0%, rgba(220, 38, 38, 0.22) 100%)',
            borderBottom: '1.5px solid rgba(239, 68, 68, 0.45)',
            color: 'var(--text-primary)',
            padding: '10px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.22)',
                color: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              <MdCancel />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Today's Attendance: MARKED ABSENT</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>📅 {todayRecord?.formattedDate || todayRecord?.date || todayDateFormatted}</span>
                <span>•</span>
                <span>⏰ Recorded at <strong>{todayRecord?.time || 'Night Round'} IST</strong></span>
                <span>•</span>
                <span>{todayRecord?.remark || 'Outside hostel geofence or missed round'}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenHistory}
            style={{
              background: 'rgba(239, 68, 68, 0.16)',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 99,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            📋 View Attendance Records
          </button>
        </div>
      ) : (
        /* State 4: Unmarked Today (Informs student at any login hour) */
        <div
          className="student-attendance-banner unmarked-status"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 44,
            background: 'var(--bg-card, rgba(30, 41, 59, 0.65))',
            borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.12))',
            color: 'var(--text-primary)',
            padding: '9px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.14)',
                color: '#6366f1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}
            >
              <MdAccessTime />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Today's Attendance: NOT MARKED YET</span>
                <span style={{ fontSize: 10.5, opacity: 0.85, background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1', padding: '1px 7px', borderRadius: 99, fontWeight: 700 }}>
                  Round Scheduled 9:00 PM – 11:30 PM
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                📅 {todayDateFormatted} · Attendance verification activates during hostel night rounds. You will be prompted here when staff opens your room.
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenHistory}
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color, rgba(255,255,255,0.16))',
              borderRadius: 99,
              padding: '5px 13px',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            📋 Records &amp; History
          </button>
        </div>
      )}


      {/* Geofence Detection Modal */}
      {modalOpen && (
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
        >
          <div
            className="card student-attendance-modal-card"
            style={{
              width: '100%',
              maxWidth: 480,
              padding: 24,
              borderRadius: 20,
              background: 'var(--bg-surface, #ffffff)',
              border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
              boxShadow: '0 24px 48px -12px rgba(0,0,0,0.3)',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'rgba(99, 102, 241, 0.12)',
                    color: '#6366f1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MdMeetingRoom size={22} />
                </div>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    Room {pendingRequest.roomNo} Attendance
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Hostel Geofence Verification
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
              >
                <MdClose size={24} />
              </button>
            </div>

            {/* Explanation card */}
            <div
              style={{
                background: 'rgba(99, 102, 241, 0.06)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                borderRadius: 14,
                padding: '12px 16px',
                marginBottom: 16,
                fontSize: 12.5,
                lineHeight: 1.5,
                color: 'var(--text-secondary)',
              }}
            >
              📍 <strong>Accurate Building Geofencing Check:</strong> Attendance is marked <strong>PRESENT</strong> only when your device is physically inside your hostel building (within 30m of building center). If you are outside the building, attendance is marked <strong>ABSENT</strong>.
            </div>

            {/* Target Building Spec */}
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                marginBottom: 14,
                padding: '8px 12px',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>Target: <strong>{pendingRequest?.hostel || user?.hostel || 'Hostel'}</strong> (Room {pendingRequest?.roomNo || user?.roomNo})</span>
              <span>Allowed Radius: <strong>30 meters</strong></span>
            </div>

            {/* Result Status Display */}
            {verificationResult && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 14,
                  marginBottom: 18,
                  background:
                    verificationResult.type === 'present'
                      ? 'rgba(16, 185, 129, 0.12)'
                      : 'rgba(239, 68, 68, 0.12)',
                  border:
                    verificationResult.type === 'present'
                      ? '1.5px solid #10b981'
                      : '1.5px solid #ef4444',
                  color: verificationResult.type === 'present' ? '#10b981' : '#ef4444',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <div style={{ flexShrink: 0, marginTop: 2 }}>
                  {verificationResult.type === 'present' ? (
                    <MdCheckCircle size={24} />
                  ) : (
                    <MdCancel size={24} />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>
                    {verificationResult.type === 'present'
                      ? 'ATTENDANCE MARKED: PRESENT'
                      : 'ATTENDANCE MARKED: ABSENT'}
                  </div>
                  <div style={{ fontSize: 12.5, opacity: 0.95, lineHeight: 1.4 }}>
                    {verificationResult.message}
                  </div>
                  {verificationResult.accuracy && (
                    <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
                      Verified with GPS Accuracy: ±{verificationResult.accuracy}m
                    </div>
                  )}
                  {verificationResult.distanceMeters !== undefined && verificationResult.distanceMeters !== null && (
                    <div style={{ fontSize: 11.5, opacity: 0.95, marginTop: 4, fontWeight: 700 }}>
                      Distance to hostel center: {verificationResult.distanceMeters}m {verificationResult.type === 'present' ? '(Inside 30m building boundary)' : '(Outside 30m boundary)'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* GPS Diagnostic Pill */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'var(--bg-input, rgba(0,0,0,0.04))',
                border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 12.5,
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MdLocationOn
                  size={18}
                  style={{
                    color: gpsData ? '#10b981' : verifying ? '#6366f1' : '#f59e0b',
                  }}
                />
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Hostel Geofence GPS</span>
              </div>

              {verifying ? (
                <span style={{ color: '#6366f1', fontWeight: 700, fontSize: 12 }}>
                  Detecting location…
                </span>
              ) : gpsData ? (
                <span style={{ color: '#10b981', fontWeight: 700, fontSize: 12 }}>
                  Detected (±{Math.round(gpsData.accuracy)}m)
                </span>
              ) : (
                <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 12 }}>
                  Waiting for GPS
                </span>
              )}
            </div>

            {gpsError && (
              <div
                style={{
                  fontSize: 12,
                  color: '#ef4444',
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(239,68,68,0.08)',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <MdWarning size={16} />
                <span>{gpsError}</span>
              </div>
            )}

            {/* Primary Action Button */}
            <button
              type="button"
              onClick={() => detectAndMarkAttendance()}
              disabled={verifying || Boolean(verificationResult?.type === 'present')}
              style={{
                width: '100%',
                padding: '13px 20px',
                borderRadius: 12,
                background:
                  verificationResult?.type === 'present'
                    ? '#10b981'
                    : 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                color: '#fff',
                border: 'none',
                fontWeight: 800,
                fontSize: 14.5,
                cursor: verifying ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: '0 4px 16px rgba(79, 70, 229, 0.3)',
                transition: 'all 0.18s ease',
              }}
            >
              <MdMyLocation size={18} />
              {verifying
                ? 'Detecting Location & Marking...'
                : verificationResult?.type === 'present'
                ? 'Attendance Verified (Present)'
                : verificationResult?.type === 'absent'
                ? 'Re-check Geofence Location'
                : 'Detect Location & Mark Attendance'}
            </button>

            {/* View Attendance Records Ledger Button */}
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                onOpenHistory();
              }}
              style={{
                width: '100%',
                marginTop: 10,
                padding: '10px 16px',
                borderRadius: 12,
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                fontWeight: 700,
                fontSize: 12.5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
            >
              <span>📋</span>
              <span>View My Attendance Records</span>
            </button>
          </div>
        </div>
      )}

      {/* Mobile Responsive Styles */}
      <style>{`
        @media (max-width: 640px) {
          .student-attendance-banner {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
            padding: 12px 14px !important;
          }
          .student-attendance-banner button {
            width: 100% !important;
            justify-content: center !important;
            text-align: center !important;
            padding: 9px 14px !important;
            font-size: 13px !important;
          }
          .student-attendance-modal-card {
            padding: 18px 16px !important;
            border-radius: 18px !important;
            margin: 0 4px !important;
          }
        }
      `}</style>
    </>
  );
}
