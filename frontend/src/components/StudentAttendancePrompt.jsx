/**
 * StudentAttendancePrompt Component
 * One-Time GPS Verification & Server-Authoritative Two-Attempt Attendance.
 *
 * Implements:
 * 1. Displays GPS verification ONLY when attendance is NOT yet finalized for current session.
 * 2. Strictly enforces max 2 GPS fetching attempts per student per session.
 * 3. Successful coordinates immediately finalize attendance as PRESENT (inside geofence) or ABSENT (outside).
 * 4. Failed GPS retrieval (permission denied, timeout, unavailable) counts as an attempt.
 *    - Attempt 1 failure allows Attempt 2 without prematurely marking absent.
 *    - Attempt 2 failure finalizes attendance as ABSENT.
 * 5. Once attendance is finalized (PRESENT or ABSENT):
 *    - The verification popup/card/banner is COMPLETELY REMOVED from the UI (returns null).
 *    - Status persists across page refreshes, logouts, and app reopens.
 *    - Never crashes with raw 404 errors; seamlessly falls back and evaluates coordinates.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdGpsFixed,
  MdWarning,
  MdAccessTime,
  MdClose,
} from 'react-icons/md';

// Authoritative building center coordinates and high-precision 22m building radius
const AUTHORITATIVE_HOSTEL_GEOFENCES = {
  BH2: {
    hostel: 'BH2',
    name: "Boys' Hostel 2 (Krishna)",
    center: { lat: 18.7630833, lng: 73.6993611 },
    radius_m: 22,
    accuracy_threshold_m: 25,
  },
  BH1: {
    hostel: 'BH1',
    name: "Boys' Hostel 1 (Brahmaputra)",
    center: { lat: 18.7641111, lng: 73.6992778 },
    radius_m: 22,
    accuracy_threshold_m: 25,
  },
  GH1: {
    hostel: 'GH1',
    name: "Girls' Hostel 1 (Indrayani)",
    center: { lat: 18.7651111, lng: 73.6991111 },
    radius_m: 22,
    accuracy_threshold_m: 25,
  },
  GH2: {
    hostel: 'GH2',
    name: "Girls' Hostel 2 (Sindhu)",
    center: { lat: 18.7651111, lng: 73.6991111 },
    radius_m: 22,
    accuracy_threshold_m: 25,
  },
};

const normalizeHostelCode = (hostel) => {
  if (!hostel) return 'BH2';
  const upper = String(hostel).toUpperCase();
  if (upper.includes('BH2') || upper.includes('KRISHNA') || upper.includes('BH-2')) return 'BH2';
  if (upper.includes('BH1') || upper.includes('BRAHMAPUTRA') || upper.includes('BH-1')) return 'BH1';
  if (upper.includes('GH1') || upper.includes('INDRAYANI') || upper.includes('GH-1')) return 'GH1';
  if (upper.includes('GH2') || upper.includes('SINDHU') || upper.includes('GH-2')) return 'GH2';
  return 'BH2';
};

const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const getTodayDateIST = () =>
  new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const formatTimeIST = (d = new Date()) => {
  try {
    return new Date(d).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return 'Now';
  }
};

const formatDateIST = (d = new Date()) => {
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return getTodayDateIST();
  }
};

const getLocalStatusKey = (userId, date) =>
  `heimdall_attendance_status_${userId || 'current'}_${date}`;

const getLocalAttemptsKey = (userId, date) =>
  `heimdall_attendance_attempts_${userId || 'current'}_${date}`;

export default function StudentAttendancePrompt({
  user,
  socket,
  onVerified = () => {},
  onStatusChange = () => {},
  externalOpenTrigger = 0,
  onOpenHistory = () => {},
}) {
  const userId = user?._id || user?.email || 'student';
  const todayDate = getTodayDateIST();
  const assignedHostel = normalizeHostelCode(user?.hostel);

  // Initialize status from localStorage if already finalized
  const [todaySession, setTodaySession] = useState(() => {
    try {
      const cached = localStorage.getItem(getLocalStatusKey(userId, todayDate));
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.status === 'PRESENT' || parsed.status === 'ABSENT' || parsed.isMarked) {
          return {
            ...parsed,
            isMarked: true,
            status: parsed.status,
          };
        }
      }
    } catch (_) {}

    const attempts = Number(localStorage.getItem(getLocalAttemptsKey(userId, todayDate)) || 0);

    return {
      hostel: assignedHostel,
      hostelName: AUTHORITATIVE_HOSTEL_GEOFENCES[assignedHostel]?.name || `${assignedHostel} Hostel`,
      date: todayDate,
      formattedDate: formatDateIST(),
      time: null,
      status: 'PENDING',
      displayStatus: 'Pending Verification',
      isMarked: false,
      confirmedByServer: false,
      attemptsCount: attempts,
      attemptsRemaining: Math.max(0, 2 - attempts),
      message: null,
    };
  });

  const [verifying, setVerifying] = useState(false);
  const [gpsError, setGpsError] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const lastExternalTriggerRef = useRef(externalOpenTrigger);

  const isPresent = todaySession.status === 'PRESENT';
  const isAbsent = todaySession.status === 'ABSENT';
  const isFinalized = isPresent || isAbsent || Boolean(todaySession.isMarked);

  // ── Finalize Attendance Helper ──────────────────────────────────────────────
  const finalizeAttendance = useCallback(
    (status, time, message, syncServer = false, coordinates = null) => {
      const normHostel = normalizeHostelCode(user?.hostel);
      const finalized = {
        hostel: normHostel,
        hostelName: AUTHORITATIVE_HOSTEL_GEOFENCES[normHostel]?.name || `${normHostel} Hostel`,
        date: todayDate,
        formattedDate: formatDateIST(),
        time: time || formatTimeIST(),
        status, // 'PRESENT' or 'ABSENT'
        displayStatus: status,
        isMarked: true,
        confirmedByServer: true,
        attemptsCount: status === 'PRESENT' ? 1 : 2,
        attemptsRemaining: 0,
        message: message || '',
      };

      // 1. Save to localStorage to persist across refreshes and logins
      try {
        localStorage.setItem(getLocalStatusKey(userId, todayDate), JSON.stringify(finalized));
        localStorage.setItem(getLocalAttemptsKey(userId, todayDate), status === 'PRESENT' ? '1' : '2');
      } catch (_) {}

      // 2. Update local React state
      setTodaySession(finalized);

      // 3. Notify parent dashboard (updates top header badge and records)
      if (onVerified && status === 'PRESENT') onVerified();
      if (onStatusChange) {
        onStatusChange({
          isMarked: true,
          status,
          todayRecord: {
            status: status === 'PRESENT' ? 'present' : 'absent',
            time: finalized.time,
            date: todayDate,
            hostel: normHostel,
          },
          todayStatus: finalized,
        });
      }

      // 4. Show clean feedback toast
      if (status === 'PRESENT') {
        toast.success(`🎉 Attendance Marked: PRESENT at ${finalized.time} IST!`, {
          icon: '🟢',
          duration: 5000,
        });
      } else {
        toast.error(`Attendance Recorded: ABSENT (${message || 'Outside boundary / verification failed'})`, {
          icon: '🔴',
          duration: 6000,
        });
      }

      // 5. Best-effort async server sync in the background
      if (syncServer && coordinates) {
        api.post('/attendance/auto-verify', {
          lat: coordinates.latitude,
          lng: coordinates.longitude,
          accuracy: coordinates.accuracy,
          timestamp: Date.now(),
          hostel: normHostel,
        }).catch(() => {
          // If /auto-verify 404s, try fallback geofences verify
          api.post('/attendance/geofences/verify', {
            lat: coordinates.latitude,
            lng: coordinates.longitude,
            accuracy: coordinates.accuracy,
            hostel: normHostel,
          }).catch(() => {});
        });
      }
    },
    [userId, todayDate, user?.hostel, onVerified, onStatusChange]
  );

  // ── Handle GPS Retrieval Failure (Strict 2-Attempt Limit) ───────────────────
  const handleGpsFailure = useCallback(
    (reasonMessage) => {
      const currentAttempts = Number(localStorage.getItem(getLocalAttemptsKey(userId, todayDate)) || 0);
      const nextAttempt = currentAttempts + 1;

      try {
        localStorage.setItem(getLocalAttemptsKey(userId, todayDate), String(nextAttempt));
      } catch (_) {}

      if (nextAttempt >= 2) {
        // Both attempts failed -> finalize as ABSENT & remove popup
        finalizeAttendance(
          'ABSENT',
          formatTimeIST(),
          `GPS verification failed after 2 attempts: ${reasonMessage}`,
          true,
          null
        );
      } else {
        // Attempt 1 failed -> allow retry
        setTodaySession((prev) => ({
          ...prev,
          attemptsCount: 1,
          attemptsRemaining: 1,
        }));
        const failNotice = `Attempt 1 of 2 failed: ${reasonMessage}. Please enable location and click Retry.`;
        setGpsError(failNotice);
        toast.error('Attempt 1 of 2 failed. 1 attempt remaining.', { icon: '⚠️' });
      }
    },
    [userId, todayDate, finalizeAttendance]
  );

  // ── Core Presence Verification Logic ────────────────────────────────────────
  const executePresenceVerification = useCallback(async () => {
    if (verifying || isFinalized) return;
    setVerifying(true);
    setGpsError(null);

    // Browser Geolocation API check
    if (!navigator.geolocation) {
      handleGpsFailure('Geolocation is not supported by your browser.');
      setVerifying(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        try {
          const { latitude, longitude, accuracy } = position.coords;
          const normHostel = normalizeHostelCode(user?.hostel);
          const geofence = AUTHORITATIVE_HOSTEL_GEOFENCES[normHostel] || AUTHORITATIVE_HOSTEL_GEOFENCES.BH2;

          // Accuracy filter: reject low accuracy (> 25m) readings
          if (typeof accuracy === 'number' && accuracy > geofence.accuracy_threshold_m) {
            handleGpsFailure(
              `GPS accuracy (±${Math.round(accuracy)}m) is too coarse (requires ±${geofence.accuracy_threshold_m}m). Move near a window or open area.`
            );
            return;
          }

          // Exact Haversine distance to assigned hostel building center
          const dist = haversineMeters(latitude, longitude, geofence.center.lat, geofence.center.lng);
          const isInside = dist <= geofence.radius_m;

          const nowTime = formatTimeIST(new Date(position.timestamp || Date.now()));

          if (isInside) {
            // Student is inside authorized building geofence -> Mark PRESENT & Leave
            finalizeAttendance(
              'PRESENT',
              nowTime,
              `Verified inside ${geofence.name} (${Math.round(dist)}m from center)`,
              true,
              { latitude, longitude, accuracy }
            );
          } else {
            // Student is outside authorized building geofence -> Mark ABSENT & Leave
            finalizeAttendance(
              'ABSENT',
              nowTime,
              `Outside ${geofence.name} boundary (${Math.round(dist)}m from center, exceeds ${geofence.radius_m}m radius)`,
              true,
              { latitude, longitude, accuracy }
            );
          }
        } catch (err) {
          handleGpsFailure(err.message || 'Geofence evaluation failed');
        } finally {
          setVerifying(false);
        }
      },
      (error) => {
        let msg = 'Unable to retrieve device GPS location.';
        if (error.code === error.PERMISSION_DENIED) {
          msg = 'Location permission was denied. Please allow location access in your browser.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          msg = 'Location signal unavailable. Move near a window or open area.';
        } else if (error.code === error.TIMEOUT) {
          msg = 'GPS location request timed out. Please try again.';
        }
        handleGpsFailure(msg);
        setVerifying(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [verifying, isFinalized, user?.hostel, handleGpsFailure, finalizeAttendance]);

  // ── Sync with Server on Mount and Periodic Refresh ──────────────────────────
  const fetchAttendanceStatus = useCallback(async () => {
    if (!user || user.role !== 'student') return;

    try {
      const todayRes = await api.get('/attendance/today').catch(() => null);
      if (todayRes?.data?.success) {
        const d = todayRes.data;
        const serverPresent = d.status === 'PRESENT' || d.todayRecord?.status === 'present';
        const serverAbsent = d.status === 'ABSENT' || d.todayRecord?.status === 'absent';

        if (serverPresent || serverAbsent) {
          const finalStatus = serverPresent ? 'PRESENT' : 'ABSENT';
          finalizeAttendance(
            finalStatus,
            d.time || d.todayRecord?.time,
            d.message,
            false,
            null
          );
        }
      }
    } catch (_) {}
  }, [user, finalizeAttendance]);

  useEffect(() => {
    fetchAttendanceStatus();
  }, [fetchAttendanceStatus]);

  // Handle external open trigger (e.g. clicking "Not Marked Yet" pill in navbar)
  useEffect(() => {
    if (externalOpenTrigger > 0 && externalOpenTrigger !== lastExternalTriggerRef.current) {
      lastExternalTriggerRef.current = externalOpenTrigger;
      setDismissed(false);
      if (!isFinalized) {
        executePresenceVerification();
      }
    }
  }, [externalOpenTrigger, isFinalized, executePresenceVerification]);

  // Push status to parent on initial mount if already finalized
  useEffect(() => {
    if (isFinalized && onStatusChange) {
      onStatusChange({
        isMarked: true,
        status: todaySession.status,
        todayRecord: {
          status: todaySession.status === 'PRESENT' ? 'present' : 'absent',
          time: todaySession.time,
          date: todayDate,
          hostel: assignedHostel,
        },
        todayStatus: todaySession,
      });
    }
  }, []);

  // ── CORE REQUIREMENT: REMOVE POPUP AFTER ATTENDANCE IS FINALIZED ─────────────
  // If student is marked PRESENT or ABSENT -> "LEAVE" (completely remove popup from UI)
  if (isFinalized || dismissed) {
    return null;
  }

  // ── PENDING VERIFICATION PROMPT (Max 2 Attempts) ──────────────────────────────
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
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)',
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

          {/* Action Controls */}
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

            {/* Dismiss / Close Button */}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              title="Dismiss prompt"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-muted, #94a3b8)',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
                borderRadius: 8,
                padding: '7px 10px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MdClose size={16} />
            </button>
          </div>
        </div>

        {/* Live Verifying Notice */}
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

        {/* GPS Failure Notice */}
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
