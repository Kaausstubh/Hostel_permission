/**
 * Student Onboarding Page — Smart Access Portal
 *
 * Appears exactly once when a new student logs in and has missing profile details
 * (Roll/MIS number, phone, parent phone, or hostel selection).
 *
 * Collects critical data securely and stores it before directing them to their dashboard.
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api, { prewarmApiConnection } from '../services/api';
import toast from 'react-hot-toast';

import {
  MdPerson,
  MdSchool,
  MdPhone,
  MdPeople,
  MdHome,
  MdMeetingRoom,
  MdLightMode,
  MdDarkMode,
  MdLock,
  MdArrowBack,
  MdPhotoCamera,
  MdUpload,
  MdClose,
  MdCheckCircle,
  MdErrorOutline,
  MdLogout,
} from 'react-icons/md';
import { verifyHumanFace } from '../utils/faceDetector';
import { validateIndianPhone } from '../utils/phone';

const extractMisFromEmail = (email = '') => {
  if (!email || typeof email !== 'string') return '';
  const localPart = (email.split('@')[0] || '').trim();
  const numMatch = localPart.match(/\d+/);
  return numMatch ? numMatch[0] : localPart.toUpperCase();
};

export default function Onboarding() {
  const { user, loginWithOAuth, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleBackToPortals = async () => {
    try {
      await logout();
    } catch (e) {
      console.error(e);
    } finally {
      navigate('/login', { replace: true });
    }
  };

  const autoMis = extractMisFromEmail(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [rollNo, setRollNo] = useState(autoMis || user?.rollNo || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [parentPhone, setParentPhone] = useState(user?.parentPhone || '');
  const [parentPhone2, setParentPhone2] = useState(user?.parentPhone2 || '');
  const [hostel, setHostel] = useState(user?.hostel || ''); // BH1 | BH2 | GH1 | GH2
  const [roomNo, setRoomNo] = useState(user?.roomNo || '');

  // Face photo states: compulsory and human face only
  const [photo, setPhoto] = useState('');
  const [faceVerified, setFaceVerified] = useState(false);
  const [verifyingFace, setVerifyingFace] = useState(false);
  const [faceError, setFaceError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [showTermsModal, setShowTermsModal] = useState(false);

  // Prewarm backend on mount while student is completing profile details
  useEffect(() => {
    prewarmApiConnection();
  }, []);

  // Live camera states
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);

  useEffect(() => {
    if (user?.email) {
      const extracted = extractMisFromEmail(user.email);
      if (extracted) {
        setRollNo(extracted);
      }
    }
  }, [user?.email]);

  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    setFaceError('');
    setCameraLoading(true);
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 640 },
        },
        audio: false,
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error(err);
      toast.error('Unable to access camera. Please allow camera permissions or upload a photo.');
      stopCamera();
    } finally {
      setCameraLoading(false);
    }
  };

  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setCameraOpen(false);
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    const size = Math.min(video.videoWidth || 360, video.videoHeight || 360);
    const sx = ((video.videoWidth || 360) - size) / 2;
    const sy = ((video.videoHeight || 360) - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 360, 360);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

    setVerifyingFace(true);
    setFaceError('');
    try {
      const verification = await verifyHumanFace(canvas);
      if (!verification.ok) {
        setFaceError(verification.message || 'No human face detected. Please face the camera directly in good lighting.');
        toast.error(verification.message || 'No human face detected! Only real human face photos are accepted.');
        setFaceVerified(false);
        return;
      }

      setPhoto(dataUrl);
      setFaceVerified(true);
      setFaceError('');
      stopCamera();
      toast.success('Human face verified & captured! ✓');
    } catch (err) {
      console.error(err);
      toast.error('Face verification failed. Please try again.');
    } finally {
      setVerifyingFace(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      return toast.error('Please upload an image file (JPG or PNG).');
    }

    setVerifyingFace(true);
    setFaceError('');

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 360, 360);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

        try {
          const verification = await verifyHumanFace(canvas);
          if (!verification.ok) {
            setPhoto('');
            setFaceVerified(false);
            setFaceError(verification.message || 'No human face detected! Only clear human face photos are accepted.');
            toast.error(verification.message || 'No human face detected. Only genuine human face photos are accepted.');
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }

          setPhoto(dataUrl);
          setFaceVerified(true);
          setFaceError('');
          toast.success('Human face verified & recorded! ✓');
        } catch (err) {
          console.error(err);
          toast.error('Failed to verify face photo. Please try again.');
        } finally {
          setVerifyingFace(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      img.onerror = () => {
        setVerifyingFace(false);
        toast.error('Invalid image file. Please upload a clear JPG/PNG photo.');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Simple validation helpers
  const isValidName = (val) => val.trim().length >= 2 && val.trim().length <= 80;
  const isValidRoll = (val) => val.trim().length >= 3 && val.trim().length <= 20;
  const isValidPhone = (val) => {
    const digits = val.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!photo || !faceVerified) {
      return toast.error('Student face photo is compulsory! Only a verified human face is accepted for hostel & gate records.');
    }
    if (!isValidName(name)) {
      return toast.error('Please enter your official name (min 2 characters).');
    }
    if (!isValidRoll(rollNo)) {
      return toast.error('Please enter a valid Roll/MIS number.');
    }
    // Validate all three phone numbers individually
    const phoneCheck = validateIndianPhone(phone, 'Your Phone Number');
    if (!phoneCheck.valid) {
      return toast.error(phoneCheck.error);
    }

    const parentCheck = validateIndianPhone(parentPhone, 'Parent Contact 1');
    if (!parentCheck.valid) {
      return toast.error(parentCheck.error);
    }

    const parent2Check = validateIndianPhone(parentPhone2, 'Parent Contact 2');
    if (!parent2Check.valid) {
      return toast.error(parent2Check.error);
    }

    // All three phone numbers student enters should be different
    if (phoneCheck.digits10 === parentCheck.digits10) {
      return toast.error('Your Phone Number cannot be the same as Parent Contact 1. All 3 phone numbers must be unique.');
    }
    if (phoneCheck.digits10 === parent2Check.digits10) {
      return toast.error('Your Phone Number cannot be the same as Parent Contact 2. All 3 phone numbers must be unique.');
    }
    if (parentCheck.digits10 === parent2Check.digits10) {
      return toast.error('Parent Contact 1 and Parent Contact 2 cannot be the same number. All 3 phone numbers must be unique.');
    }

    if (!hostel) {
      return toast.error('Please select your hostel.');
    }

    if (!roomNo || !roomNo.trim()) {
      return toast.error('Please enter your room number.');
    }

    if (!agreeTerms) {
      return toast.error('Please accept the Hostel Terms and Conditions to complete registration.');
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await api.put(
        '/student/onboard',
        {
          name: name.trim(),
          rollNo: rollNo.trim().toUpperCase(),
          phone: phoneCheck.e164,
          parentPhone: parentCheck.e164,
          parentPhone2: parent2Check.e164,
          hostel,
          roomNo: roomNo.trim(),
          photo,
        },
        { timeout: 60000 }
      );

      if (res.data?.success) {
        // Update user state globally in AuthContext
        const token = localStorage.getItem('token');
        loginWithOAuth(token, res.data.user);
        
        toast.success('Profile setup completed successfully! 🎉');
        navigate('/student', { replace: true });
      }
    } catch (err) {
      console.error(err);
      let errorMsg = err.response?.data?.message;
      if (!errorMsg) {
        if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
          errorMsg = 'Request timed out while connecting to the server. The server was waking up — please try again now.';
        } else if (!err.response) {
          errorMsg = 'Network error or backend waking up. Please wait a moment and try tapping Submit again.';
        } else {
          errorMsg = 'Failed to submit onboarding details. Please try again.';
        }
      }
      setSubmitError(errorMsg);
      toast.error(errorMsg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  };

  return (
      <div className="login-page">
      {/* Top action navigation bar */}
      <div
        style={{
          position: 'fixed',
          top: 20,
          left: 20,
          right: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 100,
          pointerEvents: 'none',
        }}
      >
        <button
          type="button"
          className="login-back-btn"
          onClick={handleBackToPortals}
          title="Return to Login Page"
        >
          <span className="login-back-btn-icon">
            <MdArrowBack size={16} />
          </span>
          <span>Back to Login</span>
        </button>

        <button
          type="button"
          className="login-theme-toggle"
          onClick={toggleTheme}
          style={{ position: 'static', pointerEvents: 'auto', margin: 0, padding: '8px 16px' }}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'bright'} mode`}
        >
          <span className="login-theme-toggle-icon">
            {theme === 'light' ? <MdDarkMode size={17} /> : <MdLightMode size={17} />}
          </span>
          <span style={{ fontSize: '12.5px' }}>{theme === 'light' ? 'Dark Mode' : 'Bright Mode'}</span>
        </button>
      </div>

      {/* Main Single Box Onboarding Card — Exact same size as Login card */}
      <form
        onSubmit={handleSubmit}
        className="login-card login-card-oauth fade-in"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          maxWidth: '560px',
          height: 'calc(var(--app-viewport-height, 100dvh) - 48px)',
          maxHeight: '780px',
          minHeight: '580px',
          padding: '24px 38px 20px',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <span className="login-eyebrow" style={{ margin: 0, fontSize: 11, letterSpacing: '0.06em' }}>
              IIIT Pune · Student Registration
            </span>
          </div>

          {/* Student Face Photo Capture Area (Compulsory & Human Face Only) */}
          <div style={{ position: 'relative', margin: '2px auto 6px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              style={{
                position: 'relative',
                width: 76,
                height: 76,
                borderRadius: '50%',
                padding: 3,
                background: verifyingFace
                  ? 'linear-gradient(135deg, #6366f1, #06b6d4)'
                  : photo && faceVerified
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : 'linear-gradient(135deg, #ef4444, #f59e0b)',
                boxShadow: photo && faceVerified
                  ? '0 0 18px rgba(16, 185, 129, 0.45)'
                  : verifyingFace
                  ? '0 0 18px rgba(99, 102, 241, 0.4)'
                  : '0 0 16px rgba(239, 68, 68, 0.35)',
                transition: 'all 0.3s ease',
              }}
            >
              {photo ? (
                <img
                  src={photo}
                  alt="Student face preview"
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    background: 'var(--card-bg, #1a2234)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--primary-light, #93c5fd)',
                    border: '1.5px dashed rgba(239, 68, 68, 0.6)',
                  }}
                >
                  <MdPhotoCamera size={26} />
                </div>
              )}

              {/* Status Indicator Badge */}
              <div
                style={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: verifyingFace ? '#6366f1' : photo && faceVerified ? '#10b981' : '#ef4444',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 900,
                  border: '2px solid var(--card-bg, #13192c)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                }}
                title={photo && faceVerified ? 'Human Face Verified' : 'Face Photo Compulsory'}
              >
                {verifyingFace ? '…' : photo && faceVerified ? '✓' : '!'}
              </div>
            </div>

            {/* Quick Action Buttons for Photo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <button
                type="button"
                onClick={startCamera}
                disabled={verifyingFace}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 12px',
                  borderRadius: 9999,
                  border: theme === 'light' ? '1px solid rgba(37, 99, 235, 0.4)' : '1px solid rgba(59, 130, 246, 0.4)',
                  background: theme === 'light' ? 'rgba(37, 99, 235, 0.12)' : 'rgba(59, 130, 246, 0.18)',
                  color: theme === 'light' ? '#1d4ed8' : '#93c5fd',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: verifyingFace ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: theme === 'light' ? '0 1px 3px rgba(37, 99, 235, 0.1)' : 'none',
                }}
              >
                <MdPhotoCamera size={13} />
                <span>{photo ? 'Retake Photo' : 'Live Camera *'}</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={verifyingFace}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 12px',
                  borderRadius: 9999,
                  border: theme === 'light' ? '1px solid rgba(15, 23, 42, 0.22)' : '1px solid rgba(255, 255, 255, 0.18)',
                  background: theme === 'light' ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.06)',
                  color: theme === 'light' ? '#0f172a' : '#e2e8f0',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: verifyingFace ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <MdUpload size={13} />
                <span>Upload Photo *</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/jpg"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </div>
          </div>

          <h1 style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.3px', margin: '2px 0 2px', color: 'var(--text-primary)' }}>
            Complete Your Profile
          </h1>
          <p
            style={{
              fontSize: '12px',
              color: verifyingFace ? '#38bdf8' : photo && faceVerified ? '#10b981' : '#f87171',
              margin: 0,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            {verifyingFace ? (
              <span>🔍 Scanning & verifying human face...</span>
            ) : photo && faceVerified ? (
              <span>✓ Face photo recorded for gate verification & records</span>
            ) : (
              <span>⚠️ Upload face photo (Compulsory · Only human face accepted)</span>
            )}
          </p>
          {faceError && (
            <div
              style={{
                fontSize: '11px',
                color: '#f87171',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '6px',
                padding: '3px 10px',
                marginTop: '4px',
                maxWidth: '420px',
                textAlign: 'center',
                lineHeight: 1.35,
              }}
            >
              {faceError}
            </div>
          )}
        </div>

        {/* Form Inputs Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {/* Official Name Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Official Name (for college records)
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <MdPerson size={17} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Enter your full official name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '10px 14px 10px 38px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                  background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                  color: 'var(--text-primary)',
                  fontSize: '13.5px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease',
                }}
                onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))')}
              />
            </div>
          </div>

          {/* Roll / MIS (Locked) & Personal Phone in 2-Columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* Roll / MIS Number */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  MIS Number *
                </label>
                {autoMis && (
                  <span style={{ fontSize: '10px', fontWeight: 600, color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    <MdLock size={10} /> Locked
                  </span>
                )}
              </div>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <MdSchool size={16} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="e.g. 112415098"
                  value={rollNo}
                  readOnly={Boolean(autoMis)}
                  onChange={(e) => !autoMis && setRollNo(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                    background: autoMis ? 'rgba(255, 255, 255, 0.03)' : 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                    color: autoMis ? 'var(--primary-light, #93c5fd)' : 'var(--text-primary)',
                    fontSize: '13.5px',
                    fontWeight: autoMis ? 700 : 400,
                    outline: 'none',
                    cursor: autoMis ? 'not-allowed' : 'text',
                  }}
                />
              </div>
            </div>

            {/* Personal Phone */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Your Phone *
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <MdPhone size={16} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
                <input
                  type="tel"
                  placeholder="e.g. +919876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                    background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                    color: 'var(--text-primary)',
                    fontSize: '13.5px',
                    outline: 'none',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))')}
                />
              </div>
            </div>
          </div>

          {/* Parent Contact 1 & Parent Contact 2 in 2-Columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* Parent Phone 1 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Parent 1 (Primary) *
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <MdPeople size={16} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
                <input
                  type="tel"
                  placeholder="+919988776655"
                  value={parentPhone}
                  onChange={(e) => setParentPhone(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                    background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                    color: 'var(--text-primary)',
                    fontSize: '13.5px',
                    outline: 'none',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))')}
                />
              </div>
            </div>

            {/* Parent Phone 2 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Parent 2 (Alternate) *
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <MdPeople size={16} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
                <input
                  type="tel"
                  placeholder="+919877665544"
                  value={parentPhone2}
                  onChange={(e) => setParentPhone2(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                    background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                    color: 'var(--text-primary)',
                    fontSize: '13.5px',
                    outline: 'none',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))')}
                />
              </div>
            </div>
          </div>

          {/* Phone requirements reminder */}
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '8px',
              padding: '8px 12px',
              lineHeight: 1.45,
            }}
          >
            📌 <strong>Rule:</strong> All 3 phone numbers must be unique, valid 10-digit Indian numbers (Accepted: <code>9876543210</code>, <code>+919876543210</code>, or <code>+91 9876543210</code>).
          </div>

          {/* Hostel Selection & Room Number in 2-Columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '12px' }}>
            {/* Hostel Selection Dropdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Select Hostel Block *
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <MdHome size={17} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
                <select
                  value={hostel}
                  onChange={(e) => setHostel(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 14px 10px 38px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                    background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                    color: 'var(--text-primary)',
                    fontSize: '13.5px',
                    outline: 'none',
                    appearance: 'none',
                    cursor: 'pointer',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))')}
                >
                  <option value="" disabled style={{ background: 'var(--bg-card, #13192c)' }}>Choose Hostel</option>
                  <option value="BH1" style={{ background: 'var(--bg-card, #13192c)' }}>Brahmaputra (BH1)</option>
                  <option value="BH2" style={{ background: 'var(--bg-card, #13192c)' }}>Krishna (BH2)</option>
                  <option value="GH1" style={{ background: 'var(--bg-card, #13192c)' }}>Indrayani (GH1)</option>
                  <option value="GH2" style={{ background: 'var(--bg-card, #13192c)' }}>Sindhu (GH2)</option>
                </select>
                <div style={{
                  position: 'absolute',
                  right: '15px',
                  pointerEvents: 'none',
                  border: 'solid var(--text-muted)',
                  borderWidth: '0 2px 2px 0',
                  display: 'inline-block',
                  padding: '3px',
                  transform: 'rotate(45deg)',
                }} />
              </div>
            </div>

            {/* Room Number Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Room Number *
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <MdMeetingRoom size={17} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="e.g. 101"
                  value={roomNo}
                  onChange={(e) => setRoomNo(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 14px 10px 38px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                    background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                    color: 'var(--text-primary)',
                    fontSize: '13.5px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))')}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Warning Note */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.28)',
            color: '#ef4444',
            fontSize: '12.5px',
            lineHeight: '1.45',
            fontWeight: 600,
          }}
        >
          <span style={{ fontSize: '17px', flexShrink: 0 }}>⚠️</span>
          <span>
            <strong>Note:</strong> Any wrong or false information provided during registration will result in immediate removal from the hostel.
          </span>
        </div>

        {/* Terms and Conditions Tick Box */}
        <div
          style={{
            marginTop: '10px',
            marginBottom: '10px',
            padding: '12px 14px',
            borderRadius: '12px',
            background: agreeTerms ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.04)',
            border: agreeTerms ? '1.5px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color, rgba(255,255,255,0.1))',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            transition: 'all 0.2s ease',
          }}
        >
          <input
            id="onboard-terms-checkbox"
            type="checkbox"
            checked={agreeTerms}
            onChange={(e) => setAgreeTerms(e.target.checked)}
            style={{
              marginTop: '3px',
              width: '18px',
              height: '18px',
              cursor: 'pointer',
              accentColor: 'var(--primary, #3b82f6)',
              flexShrink: 0,
            }}
            required
          />
          <label
            htmlFor="onboard-terms-checkbox"
            style={{
              fontSize: '12.5px',
              lineHeight: '1.45',
              color: 'var(--text-secondary, #cbd5e1)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            I agree to the{' '}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowTermsModal(true);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--primary-light, #818cf8)',
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
                fontSize: '12.5px',
                fontWeight: 700,
                display: 'inline',
              }}
            >
              Hostel Terms & Conditions
            </button>
            , Curfew Rules (8:00 PM), mandatory biometric / QR gate scanning protocol, and student code of conduct.
          </label>
        </div>

        {/* Submission Error Banner */}
        {submitError && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fca5a5',
              fontSize: '12px',
              lineHeight: '1.4',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '4px',
              marginBottom: '2px',
            }}
          >
            <MdErrorOutline size={18} style={{ flexShrink: 0, color: '#ef4444' }} />
            <span>{submitError}</span>
          </div>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={!agreeTerms || submitting}
          title={!agreeTerms ? 'Tick the Terms and Conditions box to enable completion' : 'Complete Registration'}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '13px 20px',
            borderRadius: '12px',
            border: 'none',
            background: (!agreeTerms || submitting) ? '#475569' : 'var(--primary, #3b82f6)',
            color: '#ffffff',
            fontSize: '14.5px',
            fontWeight: 700,
            cursor: (!agreeTerms || submitting) ? 'not-allowed' : 'pointer',
            opacity: (!agreeTerms || submitting) ? 0.45 : 1,
            pointerEvents: (!agreeTerms || submitting) ? 'none' : 'auto',
            filter: (!agreeTerms || submitting) ? 'grayscale(0.7)' : 'none',
            transition: 'all 0.2s ease',
            letterSpacing: '0.01em',
            boxShadow: (!agreeTerms || submitting) ? 'none' : '0 4px 20px rgba(59, 130, 246, 0.35)',
            marginTop: '3px',
          }}
          onMouseEnter={(e) => {
            if (!submitting && agreeTerms) {
              e.currentTarget.style.filter = 'brightness(1.1)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!submitting && agreeTerms) {
              e.currentTarget.style.filter = 'none';
              e.currentTarget.style.transform = 'none';
            }
          }}
        >
          {submitting
            ? 'Setting up Profile...'
            : (!agreeTerms ? '🔒 Accept Terms to Complete Registration' : 'Complete Registration & Enter Portal 🚀')}
        </button>

        {/* Terms and Conditions Modal */}
        {showTermsModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.82)',
              backdropFilter: 'blur(5px)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div
              style={{
                background: 'var(--card-bg, #1a2234)',
                border: '1px solid var(--border-color, #334155)',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '540px',
                maxHeight: '80vh',
                overflowY: 'auto',
                padding: '24px',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #fff)' }}>
                  📜 Hostel Terms & Conditions
                </h3>
                <button
                  type="button"
                  onClick={() => setShowTermsModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted, #94a3b8)',
                    fontSize: '18px',
                    cursor: 'pointer',
                    padding: '4px',
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary, #cbd5e1)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p>
                  <strong>1. Contact Verification:</strong> Both student and primary/secondary parent contacts provided must be genuine and active Indian phone numbers.
                </p>
                <p>
                  <strong>2. Curfew Policy:</strong> Daily campus entry curfew is strictly 8:00 PM. Gate exits and entries are recorded and monitored in real-time.
                </p>
                <p>
                  <strong>3. Gate Scanning:</strong> Every movement through the institutional gate requires scanning your verified dynamic QR pass.
                </p>
                <p>
                  <strong>4. Parental Notification:</strong> Outpass approvals and home leave requests involve automatic parent notification and verification.
                </p>
                <p>
                  <strong>5. Zero Tolerance:</strong> Any submission of false details, proxy scanning, or non-compliance will lead to disciplinary expulsion from the hostel.
                </p>
              </div>
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    background: 'var(--primary, #3b82f6)',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setAgreeTerms(true);
                    setShowTermsModal(false);
                  }}
                >
                  I Understand & Agree
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Back to portal selection / Sign out link */}
        <div style={{ textAlign: 'center', marginTop: '2px' }}>
          <button
            type="button"
            onClick={handleBackToPortals}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted, #64748b)',
              fontSize: '11.5px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '3px 8px',
              borderRadius: '6px',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary, #0f172a)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted, #64748b)')}
          >
            <MdLogout size={13} />
            <span>Wrong account or portal? Back to Login</span>
          </button>
        </div>
      </form>

      {/* Live Camera Viewfinder Modal */}
      {cameraOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0, 0, 0, 0.88)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 400,
              background: 'var(--card-bg, #1a2234)',
              border: '1px solid var(--border-color)',
              borderRadius: 24,
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.7)',
            }}
          >
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
                  Record Student Face
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Position your face clearly within the circle
                </div>
              </div>
              <button
                type="button"
                onClick={stopCamera}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                <MdClose size={22} />
              </button>
            </div>

            {/* Video Viewfinder with Circular Face Guide */}
            <div
              style={{
                position: 'relative',
                width: 260,
                height: 260,
                borderRadius: '50%',
                overflow: 'hidden',
                background: '#000',
                border: '3px solid #3b82f6',
                boxShadow: '0 0 30px rgba(59, 130, 246, 0.35)',
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)', // mirror selfie
                }}
              />
              {cameraLoading && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 13,
                    background: 'rgba(0,0,0,0.6)',
                  }}
                >
                  Starting camera...
                </div>
              )}
            </div>

            {faceError && (
              <div
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: '#f87171',
                  fontSize: 12,
                  textAlign: 'center',
                  fontWeight: 600,
                  lineHeight: 1.4,
                }}
              >
                ⚠️ {faceError}
              </div>
            )}

            {/* Capture & Cancel Action Buttons */}
            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
              <button
                type="button"
                onClick={capturePhoto}
                disabled={verifyingFace || cameraLoading}
                style={{
                  flex: 1,
                  padding: '12px 18px',
                  borderRadius: 12,
                  border: 'none',
                  background: verifyingFace
                    ? 'linear-gradient(135deg, #6366f1, #3b82f6)'
                    : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: verifyingFace || cameraLoading ? 'not-allowed' : 'pointer',
                  opacity: cameraLoading ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <MdPhotoCamera size={18} />
                <span>{verifyingFace ? 'Verifying Human Face...' : 'Snap Face Photo'}</span>
              </button>
              <button
                type="button"
                onClick={stopCamera}
                disabled={verifyingFace}
                style={{
                  padding: '12px 18px',
                  borderRadius: 12,
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: verifyingFace ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
  );
}
