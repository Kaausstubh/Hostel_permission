/**
 * GlobalStudentAttendanceModal Component
 *
 * Appears automatically when staff requests attendance for the student's room.
 * Key characteristics:
 * - 5-minute (300-second) synchronized countdown timer.
 * - Simple 1-Click GPS verification (NO biometrics required).
 * - Validates student is physically inside the hostel building geofence.
 * - Clean states: Verifying GPS, Marked Present, Outside Hostel Area, Weak GPS.
 * - Non-blocking minimize option with persistent floating badge.
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdGpsFixed,
  MdLocationOn,
  MdCheckCircle,
  MdWarning,
  MdClose,
  MdAccessTime,
  MdMeetingRoom,
  MdRefresh,
} from 'react-icons/md';

export default function GlobalStudentAttendanceModal({
  request,
  onDismiss,
  onVerified,
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(
    request?.remainingSeconds || 300
  );
  const [verifying, setVerifying] = useState(false);
  const [verifyingStage, setVerifyingStage] = useState('');
  const [resultState, setResultState] = useState(null); // 'SUCCESS' | 'OUTSIDE' | 'LOW_ACCURACY' | 'ERROR' | 'EXPIRED'
  const [resultMessage, setResultMessage] = useState('');
  const [distanceAway, setDistanceAway] = useState(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // Sync timer with request.expiresAt
  useEffect(() => {
    if (!request?.expiresAt) return;

    const calculateRemaining = () => {
      const diffMs = new Date(request.expiresAt).getTime() - Date.now();
      return Math.max(0, Math.floor(diffMs / 1000));
    };

    setRemainingSeconds(calculateRemaining());

    const timer = setInterval(() => {
      const rem = calculateRemaining();
      setRemainingSeconds(rem);
      if (rem <= 0) {
        clearInterval(timer);
        setResultState('EXPIRED');
        setResultMessage('Attendance request has expired.');
        setTimeout(() => {
          if (onDismiss) onDismiss(request.id);
        }, 3000);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [request?.expiresAt, request?.id, onDismiss]);

  const formatTimer = (totalSecs) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // 1-Click GPS Location Verification
  const handleVerifyLocation = useCallback(async () => {
    if (verifying || remainingSeconds <= 0) return;

    if (!navigator.geolocation) {
      setResultState('ERROR');
      setResultMessage('Geolocation is not supported by your browser.');
      return;
    }

    setVerifying(true);
    setResultState(null);
    setResultMessage('');
    setVerifyingStage('Acquiring precise GPS location…');

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude, accuracy } = pos.coords;
          setVerifyingStage(`Checking hostel geofence (Accuracy ±${Math.round(accuracy)}m)…`);

          const payload = {
            nonce: request.nonce,
            gps_lat: latitude,
            gps_lng: longitude,
            gps_accuracy: accuracy,
            timestamp: new Date().toISOString(),
          };

          const res = await api.post(`/attendance/requests/${request.id}/approve`, payload);

          if (res.data?.success) {
            setResultState('SUCCESS');
            setResultMessage(
              res.data.message || 'Attendance verified inside hostel! Marked PRESENT.'
            );
            toast.success('Attendance marked Present! ✅');

            if (onVerified) onVerified(res.data);

            // Auto-close after celebration
            setTimeout(() => {
              if (onDismiss) onDismiss(request.id);
            }, 2500);
          } else {
            setResultState('ERROR');
            setResultMessage(res.data?.message || 'Verification could not be confirmed.');
          }
        } catch (err) {
          const code = err.response?.data?.code;
          const msg = err.response?.data?.message || 'Location verification failed.';

          if (code === 'ALREADY_APPROVED') {
            setResultState('SUCCESS');
            setResultMessage('You are already marked present for this round! ✅');
            setTimeout(() => {
              if (onDismiss) onDismiss(request.id);
            }, 2000);
          } else if (code === 'OUTSIDE_GEOFENCE') {
            setResultState('OUTSIDE');
            setDistanceAway(err.response?.data?.distanceMeters || null);
            setResultMessage(msg);
          } else if (code === 'LOW_GPS_ACCURACY') {
            setResultState('LOW_ACCURACY');
            setResultMessage(msg);
          } else if (code === 'REQUEST_EXPIRED') {
            setResultState('EXPIRED');
            setResultMessage('This attendance request has already expired.');
          } else {
            setResultState('ERROR');
            setResultMessage(msg);
          }
        } finally {
          setVerifying(false);
          setVerifyingStage('');
        }
      },
      (geoErr) => {
        setVerifying(false);
        setVerifyingStage('');
        setResultState('ERROR');
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          setResultMessage('Location access was denied. Please grant location permission in your browser to verify attendance.');
        } else if (geoErr.code === geoErr.POSITION_UNAVAILABLE) {
          setResultMessage('Location unavailable. Please ensure GPS / Location is turned ON.');
        } else if (geoErr.code === geoErr.TIMEOUT) {
          setResultMessage('GPS location timed out. Please retry with a stronger signal.');
        } else {
          setResultMessage('Failed to get GPS location. Please retry.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  }, [verifying, remainingSeconds, request?.nonce, request?.id, onVerified, onDismiss]);

  if (!request) return null;

  // Minimized floating banner
  if (isMinimized) {
    return (
      <div
        onClick={() => setIsMinimized(false)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 99999,
          background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
          color: '#fff',
          padding: '12px 20px',
          borderRadius: 30,
          boxShadow: '0 10px 25px -5px rgba(99, 102, 241, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
          border: '1px solid rgba(129, 140, 248, 0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 14,
          animation: 'pulse 2s infinite',
        }}
      >
        <span style={{ fontSize: 18 }}>📡</span>
        <span>Attendance Pending: <strong>Room {request.roomNo}</strong></span>
        <span
          style={{
            background: remainingSeconds < 60 ? '#ef4444' : 'rgba(255,255,255,0.2)',
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        >
          {formatTimer(remainingSeconds)}
        </span>
      </div>
    );
  }

  // Full Screen Pop-up Modal
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'linear-gradient(145deg, #1e1b4b, #0f172a)',
          border: '1px solid rgba(129, 140, 248, 0.3)',
          borderRadius: 24,
          maxWidth: 440,
          width: '100%',
          padding: 24,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(99, 102, 241, 0.2)',
          color: '#f8fafc',
          position: 'relative',
        }}
      >
        {/* Top bar with Minimize */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.2)',
                color: '#818cf8',
              }}
            >
              <MdMeetingRoom size={18} />
            </span>
            <span style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#a5b4fc', fontWeight: 700 }}>
              Attendance Request
            </span>
          </div>

          <button
            onClick={() => setIsMinimized(true)}
            title="Minimize"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              borderRadius: 8,
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            <MdClose size={16} />
          </button>
        </div>

        {/* Room & Hostel Card */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 16,
            padding: '16px 20px',
            textAlign: 'center',
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
            Room {request.roomNo}
          </div>
          <div style={{ fontSize: 14, color: '#cbd5e1', marginTop: 4 }}>
            {request.hostel} Hostel • {request.sessionName || 'Floor Attendance'}
          </div>

          {/* Countdown Clock */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 12,
              padding: '6px 14px',
              borderRadius: 20,
              background: remainingSeconds < 60 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.15)',
              border: `1px solid ${remainingSeconds < 60 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(99, 102, 241, 0.3)'}`,
              color: remainingSeconds < 60 ? '#fca5a5' : '#c7d2fe',
              fontWeight: 700,
              fontSize: 15,
              fontFamily: 'monospace',
            }}
          >
            <MdAccessTime size={16} />
            <span>Time Left: {formatTimer(remainingSeconds)}</span>
          </div>
        </div>

        {/* Dynamic Status / Feedback Views */}
        {resultState === 'SUCCESS' && (
          <div
            style={{
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              borderRadius: 16,
              padding: 16,
              textAlign: 'center',
              marginBottom: 20,
            }}
          >
            <MdCheckCircle size={36} color="#34d399" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontWeight: 700, fontSize: 16, color: '#6ee7b7' }}>Marked Present!</div>
            <div style={{ fontSize: 13, color: '#a7f3d0', marginTop: 4 }}>{resultMessage}</div>
          </div>
        )}

        {resultState === 'OUTSIDE' && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: 16,
              padding: 16,
              textAlign: 'center',
              marginBottom: 20,
            }}
          >
            <MdWarning size={32} color="#f87171" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontWeight: 700, fontSize: 15, color: '#fca5a5' }}>Outside Hostel Location</div>
            <div style={{ fontSize: 13, color: '#fecaca', marginTop: 4 }}>
              {distanceAway ? `Detected ${distanceAway}m away from the hostel. ` : ''}
              You must be inside your assigned hostel to mark attendance.
            </div>
          </div>
        )}

        {(resultState === 'LOW_ACCURACY' || resultState === 'ERROR') && (
          <div
            style={{
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              borderRadius: 16,
              padding: 16,
              textAlign: 'center',
              marginBottom: 20,
            }}
          >
            <MdWarning size={32} color="#fbbf24" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontWeight: 700, fontSize: 15, color: '#fde68a' }}>Location Verification Failed</div>
            <div style={{ fontSize: 13, color: '#fef3c7', marginTop: 4 }}>{resultMessage}</div>
          </div>
        )}

        {resultState === 'EXPIRED' && (
          <div
            style={{
              background: 'rgba(148, 163, 184, 0.15)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: 16,
              padding: 16,
              textAlign: 'center',
              marginBottom: 20,
            }}
          >
            <MdAccessTime size={32} color="#94a3b8" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontWeight: 700, fontSize: 15, color: '#cbd5e1' }}>Request Expired</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
              The 5-minute window for this room has ended. Staff can override your attendance manually if needed.
            </div>
          </div>
        )}

        {/* Verifying Status Text */}
        {verifying && (
          <div style={{ textAlign: 'center', marginBottom: 16, color: '#a5b4fc', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 14,
                border: '2px solid rgba(165, 180, 252, 0.3)',
                borderTopColor: '#a5b4fc',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <span>{verifyingStage || 'Verifying location…'}</span>
          </div>
        )}

        {/* Action Button: Simple 1-Click Verification (No Biometrics) */}
        {resultState !== 'SUCCESS' && resultState !== 'EXPIRED' && (
          <button
            onClick={handleVerifyLocation}
            disabled={verifying || remainingSeconds <= 0}
            style={{
              width: '100%',
              padding: '14px 20px',
              borderRadius: 14,
              border: 'none',
              background: verifying
                ? '#4338ca'
                : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#fff',
              fontSize: 16,
              fontWeight: 700,
              cursor: verifying ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              boxShadow: '0 4px 15px rgba(16, 185, 129, 0.4)',
              transition: 'all 0.2s ease',
            }}
          >
            {verifying ? (
              <>
                <MdRefresh size={20} className="spin" />
                <span>Checking Location…</span>
              </>
            ) : resultState === 'OUTSIDE' || resultState === 'ERROR' || resultState === 'LOW_ACCURACY' ? (
              <>
                <MdRefresh size={20} />
                <span>Retry Location Check</span>
              </>
            ) : (
              <>
                <MdGpsFixed size={20} />
                <span>Verify Location (I am in Room)</span>
              </>
            )}
          </button>
        )}

        {/* Helper Footer */}
        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12, color: '#64748b' }}>
          Confirms you are inside {request.hostel} Hostel premises using GPS.
        </div>
      </div>
    </div>
  );
}
