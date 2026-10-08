/**
 * StudentAttendancePrompt Component
 * In-app notification banner and biometric approval modal with WebAuthn & GPS geofencing.
 * Provides clear user feedback: Success, Outside hostel area, Weak GPS signal, Request expired.
 */

import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdFingerprint,
  MdLocationOn,
  MdGpsFixed,
  MdCheckCircle,
  MdWarning,
  MdClose,
  MdRefresh,
  MdShield,
  MdSecurity,
  MdMeetingRoom,
} from 'react-icons/md';
import {
  registerPlatformAuthenticator,
  verifyBiometricAssertion,
} from '../utils/webauthn';

export default function StudentAttendancePrompt({ user, socket, onVerified = () => {} }) {
  const [pendingRequest, setPendingRequest] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Device status
  const [deviceStatus, setDeviceStatus] = useState(null);
  const [deviceLoading, setDeviceLoading] = useState(false);

  // Enrollment consent state
  const [consentAgreed, setConsentAgreed] = useState(false);
  const [enrollingDevice, setEnrollingDevice] = useState(false);

  // Verification state
  const [verifying, setVerifying] = useState(false);
  const [gpsData, setGpsData] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const [verificationResult, setVerificationResult] = useState(null); // { type: 'success'|'error', code, message }

  const remainingSeconds = pendingRequest?.remainingSeconds ?? 0;

  // Poll for pending requests every 3.5s
  const checkPending = async () => {
    if (!user || user.role !== 'student') return;
    try {
      const res = await api.get('/attendance/pending');
      if (res.data?.success && res.data.hasPending && !res.data.request?.alreadyApproved) {
        setPendingRequest(res.data.request);
      } else {
        setPendingRequest(null);
      }
    } catch {
      // silent fallback
    }
  };

  const fetchDeviceStatus = async () => {
    try {
      setDeviceLoading(true);
      const res = await api.get('/attendance/devices/status');
      if (res.data?.success) {
        setDeviceStatus(res.data);
      }
    } catch {
      // silent fallback
    } finally {
      setDeviceLoading(false);
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
    const handleReq = (data) => {
      toast('Staff requested attendance for your room!', {
        icon: '🏛️',
        duration: 6000,
      });
      checkPending();
    };
    socket.on('attendance_requested', handleReq);
    return () => socket.off('attendance_requested', handleReq);
  }, [socket]);

  // Open modal and load device status & GPS
  const handleOpenPrompt = () => {
    setModalOpen(true);
    setVerificationResult(null);
    fetchDeviceStatus();
    acquireGPS();
  };

  // Acquire high accuracy GPS location
  const acquireGPS = () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsData({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        setGpsError(`Unable to acquire GPS: ${err.message}. Please enable location permissions.`);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  // Device Enrollment Handler
  const handleEnrollDevice = async () => {
    if (!consentAgreed) {
      toast.error('You must accept the biometric & location consent to enroll this device');
      return;
    }

    try {
      setEnrollingDevice(true);
      const cred = await registerPlatformAuthenticator({
        userId: user._id,
        userName: user.email,
        userDisplayName: user.name,
      });

      const res = await api.post('/attendance/devices/register', {
        deviceId: cred.deviceId,
        credentialId: cred.credentialId,
        publicKey: cred.publicKey,
        deviceModel: cred.deviceModel,
        consentGiven: true,
      });

      if (res.data?.success) {
        toast.success('Device registered successfully!');
        fetchDeviceStatus();
      }
    } catch (err) {
      toast.error(err.message || 'Device registration failed');
    } finally {
      setEnrollingDevice(false);
    }
  };

  // Biometric Attendance Approval Handler
  const handleApproveAttendance = async () => {
    if (!gpsData) {
      acquireGPS();
      toast.error('Acquiring GPS location… please wait a moment');
      return;
    }

    try {
      setVerifying(true);
      setVerificationResult(null);

      // 1. Get request challenge / nonce
      const challengeRes = await api.get(`/attendance/challenge/${pendingRequest.id}`);
      const nonce = challengeRes.data?.nonce;

      // 2. Trigger platform authenticator (TouchID / FaceID / Fingerprint)
      const assertion = await verifyBiometricAssertion({
        credentialId: deviceStatus?.device?.device_id || pendingRequest.nonce,
        challengeNonce: nonce,
      });

      // 3. Submit approval payload to server
      const approveRes = await api.post(`/attendance/requests/${pendingRequest.id}/approve`, {
        nonce,
        deviceId: deviceStatus?.device?.device_id || 'web_device',
        credentialId: assertion.credentialId,
        signature: assertion.signature,
        gps_lat: gpsData.lat,
        gps_lng: gpsData.lng,
        gps_accuracy: gpsData.accuracy,
        timestamp: Date.now(),
      });

      if (approveRes.data?.success) {
        setVerificationResult({
          type: 'success',
          message: 'Attendance successfully verified! Your presence in this room is confirmed.',
        });
        toast.success('Attendance verified!');
        onVerified();
        setTimeout(() => {
          setModalOpen(false);
          setPendingRequest(null);
        }, 3000);
      }
    } catch (err) {
      const data = err.response?.data;
      const code = data?.code || 'ERROR';
      const msg = data?.message || err.message || 'Verification failed';

      setVerificationResult({
        type: 'error',
        code,
        message: msg,
      });

      if (code === 'LOW_GPS_ACCURACY') {
        toast.error('Weak GPS signal. Move near a window and retry.');
      } else if (code === 'OUTSIDE_GEOFENCE') {
        toast.error('Outside hostel boundary area. Rejected.');
      } else {
        toast.error(msg);
      }
    } finally {
      setVerifying(false);
    }
  };

  if (!pendingRequest || pendingRequest.alreadyApproved) return null;

  return (
    <>
      {/* Floating In-App Top Notification Banner */}
      <div
        className="student-attendance-banner"
        onClick={handleOpenPrompt}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 45,
          background: 'linear-gradient(135deg, rgba(139,92,246,0.95) 0%, rgba(34,211,238,0.9) 100%)',
          color: '#fff',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(139,92,246,0.4)',
          backdropFilter: 'blur(10px)',
          animation: 'slideDown 0.3s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            <MdFingerprint />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>
              Attendance Requested for Room {pendingRequest.roomNo}!
            </div>
            <div style={{ fontSize: 11.5, opacity: 0.9 }}>
              Tap to verify with biometrics &amp; location ({remainingSeconds}s remaining)
            </div>
          </div>
        </div>

        <button
          type="button"
          style={{
            background: '#fff',
            color: '#6366f1',
            border: 'none',
            borderRadius: 99,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          Verify Now
        </button>
      </div>

      {/* Biometric Verification Modal */}
      {modalOpen && (
        <div
          className="modal-backdrop show"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 460,
              padding: 24,
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-surface)',
              border: 'var(--border)',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MdMeetingRoom size={20} style={{ color: 'var(--primary-light)' }} />
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Room {pendingRequest.roomNo} Attendance
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <MdClose size={22} />
              </button>
            </div>

            {/* If Device Not Registered: Show Consent & Enrollment Screen */}
            {!deviceStatus?.registered ? (
              <div>
                <div
                  style={{
                    padding: 14,
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(139,92,246,0.08)',
                    border: '1px solid rgba(139,92,246,0.2)',
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14, color: 'var(--primary-light)', marginBottom: 6 }}>
                    <MdShield /> Device Enrollment Consent
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                    To verify attendance securely without paper lists or cards, this device will be registered as your personal authenticator.
                  </p>
                  <ul style={{ fontSize: 11.5, color: 'var(--text-secondary)', paddingLeft: 18, marginTop: 8, lineHeight: 1.5 }}>
                    <li><strong>Privacy-First:</strong> Biometric scans stay on your phone secure hardware. Only a cryptographic public key is saved.</li>
                    <li><strong>Hostel Geofence:</strong> Location is checked exclusively during approval to confirm presence inside the hostel.</li>
                  </ul>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-primary)', cursor: 'pointer', marginBottom: 20 }}>
                  <input
                    type="checkbox"
                    checked={consentAgreed}
                    onChange={(e) => setConsentAgreed(e.target.checked)}
                  />
                  I consent to device binding and location verification for attendance.
                </label>

                <button
                  type="button"
                  onClick={handleEnrollDevice}
                  disabled={!consentAgreed || enrollingDevice}
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--gradient-primary)',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: !consentAgreed || enrollingDevice ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <MdFingerprint size={18} />
                  {enrollingDevice ? 'Enrolling Authenticator…' : 'Register This Device'}
                </button>
              </div>
            ) : (
              /* If Device Is Registered: Show Biometric & GPS Approval Screen */
              <div>
                {/* Result Alert Box (if submitted) */}
                {verificationResult && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 'var(--radius-md)',
                      marginBottom: 16,
                      background: verificationResult.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                      border: verificationResult.type === 'success' ? '1px solid #10b981' : '1px solid #ef4444',
                      color: verificationResult.type === 'success' ? '#10b981' : '#f87171',
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {verificationResult.type === 'success' ? <MdCheckCircle size={18} /> : <MdWarning size={18} />}
                    <span>{verificationResult.message}</span>
                  </div>
                )}

                {/* Status Chips */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                  {/* GPS Status */}
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-input)',
                      border: 'var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MdLocationOn style={{ color: gpsData ? 'var(--success)' : 'var(--warning)' }} />
                      <span style={{ color: 'var(--text-primary)' }}>Hostel Geofence GPS</span>
                    </div>

                    {gpsData ? (
                      <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                        Accuracy ±{Math.round(gpsData.accuracy)}m
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={acquireGPS}
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11.5 }}
                      >
                        Acquire GPS…
                      </button>
                    )}
                  </div>

                  {gpsError && (
                    <div style={{ fontSize: 11.5, color: '#f87171', paddingLeft: 4 }}>
                      ⚠️ {gpsError}
                    </div>
                  )}

                  {/* Authenticator Status */}
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-input)',
                      border: 'var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MdSecurity style={{ color: 'var(--primary)' }} />
                      <span style={{ color: 'var(--text-primary)' }}>Registered Authenticator</span>
                    </div>
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>Ready</span>
                  </div>
                </div>

                {/* Primary Action Button */}
                <button
                  type="button"
                  onClick={handleApproveAttendance}
                  disabled={verifying || Boolean(verificationResult?.type === 'success')}
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--gradient-primary)',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: 15,
                    cursor: verifying ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    boxShadow: 'var(--shadow-md)',
                  }}
                >
                  <MdFingerprint size={22} />
                  {verifying ? 'Verifying Biometrics…' : 'Approve with Biometrics'}
                </button>

                {verificationResult?.code === 'LOW_GPS_ACCURACY' && (
                  <button
                    type="button"
                    onClick={() => {
                      acquireGPS();
                      setVerificationResult(null);
                    }}
                    style={{
                      width: '100%',
                      marginTop: 10,
                      padding: '10px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--accent)',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <MdRefresh /> Refresh GPS &amp; Retry
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
