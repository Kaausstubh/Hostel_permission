/**
 * Student Onboarding Page — Smart Access Portal
 *
 * Appears exactly once when a new student logs in and has missing profile details
 * (Roll/MIS number, phone, parent phone, or hostel selection).
 *
 * Collects critical data securely and stores it before directing them to their dashboard.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdPerson, MdSchool, MdPhone, MdPeople, MdHome, MdLightMode, MdDarkMode, MdLock, MdArrowBack, MdLogout } from 'react-icons/md';
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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.email) {
      const extracted = extractMisFromEmail(user.email);
      if (extracted) {
        setRollNo(extracted);
      }
    }
  }, [user?.email]);

  // Simple validation helpers
  const isValidName = (val) => val.trim().length >= 2 && val.trim().length <= 80;
  const isValidRoll = (val) => val.trim().length >= 3 && val.trim().length <= 20;
  const isValidPhone = (val) => {
    const digits = val.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

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
    <div
      className="login-page"
      style={{
        height: '100vh',
        minHeight: '100vh',
        maxHeight: '100vh',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Top action navigation bar */}
      <div
        style={{
          position: 'fixed',
          top: 16,
          left: 18,
          right: 18,
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

      {/* Main glassmorphic onboarding card */}
      <form
        onSubmit={handleSubmit}
        className="login-card fade-in"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '520px',
          margin: '0 auto',
          padding: '28px 30px 22px',
          boxSizing: 'border-box',
          gap: '14px',
          borderRadius: '24px',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          {/* Logo */}
          <div
            className="login-mark"
            style={{
              width: 58,
              height: 58,
              margin: '0 auto 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={iiitLogo}
              alt="IIIT Pune logo"
              style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '50%' }}
            />
          </div>

          <div
            className="login-eyebrow"
            style={{
              display: 'inline-block',
              fontSize: '10.5px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              padding: '3px 11px',
              borderRadius: '9999px',
              background: 'rgba(99, 102, 241, 0.1)',
              color: 'var(--primary, #6366f1)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              marginBottom: '5px',
            }}
          >
            First-time Setup
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.3px', margin: '0 0 4px', color: 'var(--text-primary)' }}>
            Complete Your Profile
          </h1>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.4, margin: 0 }}>
            Hi <strong>{user?.name || 'Student'}</strong>, please confirm your details once to access gate permissions.
          </p>
        </div>

        {/* Form Inputs Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
    </div>
  );
}
