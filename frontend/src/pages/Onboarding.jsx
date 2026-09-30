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
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdPerson,
  MdSchool,
  MdPhone,
  MdPeople,
  MdHome,
  MdLightMode,
  MdDarkMode,
  MdLock,
  MdArrowBack,
  MdPhotoCamera,
  MdUpload,
  MdClose,
} from 'react-icons/md';
import iiitLogo from '../assets/iiitpune-logo.png';

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
    }
    navigate('/login');
  };

  const autoMis = extractMisFromEmail(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [rollNo, setRollNo] = useState(autoMis || user?.rollNo || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [parentPhone, setParentPhone] = useState(user?.parentPhone || '');
  const [parentPhone2, setParentPhone2] = useState(user?.parentPhone2 || '');
  const [hostel, setHostel] = useState(user?.hostel || ''); // BH1 | BH2 | GH
  const [photo, setPhoto] = useState(user?.picture || '');
  const [submitting, setSubmitting] = useState(false);

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

  const capturePhoto = () => {
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
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setPhoto(dataUrl);
    stopCamera();
    toast.success('Face photo captured! ✓');
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      return toast.error('Please upload an image file (JPG or PNG).');
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 360, 360);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setPhoto(dataUrl);
        toast.success('Face photo recorded! ✓');
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

    if (!photo) {
      return toast.error('Student face photo is compulsory for gate security and hostel records. Please take or upload a photo.');
    }
    if (!isValidName(name)) {
      return toast.error('Please enter your official name (min 2 characters).');
    }
    if (!isValidRoll(rollNo)) {
      return toast.error('Please enter a valid Roll/MIS number.');
    }
    if (!isValidPhone(phone)) {
      return toast.error('Please enter a valid personal phone number (e.g. +919876543210).');
    }
    if (!isValidPhone(parentPhone)) {
      return toast.error('Please enter a valid Parent Contact 1 phone number.');
    }
    if (!isValidPhone(parentPhone2)) {
      return toast.error('Please enter a valid Parent Contact 2 phone number.');
    }
    if (parentPhone.replace(/\D/g, '') === parentPhone2.replace(/\D/g, '')) {
      return toast.error('Parent Contact 1 and Parent Contact 2 must be different numbers.');
    }
    if (!hostel) {
      return toast.error('Please select your hostel.');
    }

    setSubmitting(true);
    try {
      const res = await api.put('/student/onboard', {
        name: name.trim(),
        rollNo: rollNo.trim().toUpperCase(),
        phone: phone.trim(),
        parentPhone: parentPhone.trim(),
        parentPhone2: parentPhone2.trim(),
        hostel,
        photo,
      });

      if (res.data?.success) {
        // Update user state globally in AuthContext
        const token = localStorage.getItem('token');
        loginWithOAuth(token, res.data.user);
        
        toast.success('Profile setup completed successfully! 🎉');
        navigate('/student', { replace: true });
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to submit onboarding details. Please try again.');
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
          onClick={handleBackToPortals}
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderRadius: 9999,
            border: '1px solid var(--border-color)',
            background: 'var(--card-bg, rgba(255, 255, 255, 0.85))',
            backdropFilter: 'blur(12px)',
            color: 'var(--text-primary)',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: 'var(--card-shadow, 0 4px 12px rgba(0,0,0,0.06))',
            transition: 'all 0.2s ease',
          }}
          title="Return to the Three Portals Login Page"
        >
          <MdArrowBack size={16} />
          <span>Back to Portals</span>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <img src={iiitLogo} alt="IIIT Pune" style={{ width: 20, height: 20, objectFit: 'contain' }} />
            <span className="login-eyebrow" style={{ margin: 0, fontSize: 11, letterSpacing: '0.06em' }}>
              IIIT Pune · Student Registration
            </span>
          </div>

          {/* Student Face Photo Capture Area (Compulsory) */}
          <div style={{ position: 'relative', margin: '2px auto 6px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              style={{
                position: 'relative',
                width: 72,
                height: 72,
                borderRadius: '50%',
                padding: 3,
                background: photo
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                boxShadow: photo
                  ? '0 0 16px rgba(16, 185, 129, 0.35)'
                  : '0 0 16px rgba(59, 130, 246, 0.25)',
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
                    border: '1.5px dashed rgba(59, 130, 246, 0.6)',
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
                  background: photo ? '#10b981' : '#f59e0b',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 900,
                  border: '2px solid var(--card-bg, #13192c)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                }}
              >
                {photo ? '✓' : '*'}
              </div>
            </div>

            {/* Quick Action Buttons for Photo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <button
                type="button"
                onClick={startCamera}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  borderRadius: 9999,
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  background: 'rgba(59, 130, 246, 0.12)',
                  color: 'var(--primary-light, #93c5fd)',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <MdPhotoCamera size={13} />
                <span>{photo ? 'Retake' : 'Live Camera *'}</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  borderRadius: 9999,
                  border: '1px solid var(--border-color)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <MdUpload size={13} />
                <span>Upload</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </div>
          </div>

          <h1 style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.3px', margin: '2px 0 2px', color: 'var(--text-primary)' }}>
            Complete Your Profile
          </h1>
          <p style={{ fontSize: '12px', color: photo ? '#10b981' : '#f59e0b', margin: 0, fontWeight: 600 }}>
            {photo
              ? '✓ Face photo recorded for gate verification & records'
              : '⚠️ Face photo is compulsory for gate security records'}
          </p>
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
                <option value="BH1" style={{ background: 'var(--bg-card, #13192c)' }}>Boys Hostel 1 (BH1)</option>
                <option value="BH2" style={{ background: 'var(--bg-card, #13192c)' }}>Boys Hostel 2 (BH2)</option>
                <option value="GH" style={{ background: 'var(--bg-card, #13192c)' }}>Girls Hostel (GH)</option>
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
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '13px 20px',
            borderRadius: '12px',
            border: 'none',
            background: 'var(--primary, #3b82f6)',
            color: '#ffffff',
            fontSize: '14.5px',
            fontWeight: 700,
            cursor: submitting ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            letterSpacing: '0.01em',
            boxShadow: '0 4px 20px rgba(59, 130, 246, 0.35)',
            marginTop: '3px',
          }}
          onMouseEnter={(e) => {
            if (!submitting) {
              e.currentTarget.style.filter = 'brightness(1.1)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!submitting) {
              e.currentTarget.style.filter = 'none';
              e.currentTarget.style.transform = 'none';
            }
          }}
        >
          {submitting ? 'Setting up Profile...' : 'Complete Registration & Enter Portal 🚀'}
        </button>

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
            <span>Wrong account or portal? Back to Three Portals</span>
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

            {/* Capture & Cancel Action Buttons */}
            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
              <button
                type="button"
                onClick={capturePhoto}
                style={{
                  flex: 1,
                  padding: '12px 18px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <MdPhotoCamera size={18} />
                <span>Snap Face Photo</span>
              </button>
              <button
                type="button"
                onClick={stopCamera}
                style={{
                  padding: '12px 18px',
                  borderRadius: 12,
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
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
