/**
 * Student Onboarding Page — Smart Access Portal
 *
 * Appears exactly once when a new student logs in and has missing profile details
 * (Roll/MIS number, phone, parent phone, or hostel selection).
 *
 * Collects critical data securely and stores it before directing them to their dashboard.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdPerson, MdSchool, MdPhone, MdPeople, MdHome, MdLightMode, MdDarkMode } from 'react-icons/md';
import iiitLogo from '../assets/iiitpune-logo.png';

export default function Onboarding() {
  const { user, loginWithOAuth } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name || '');
  const [rollNo, setRollNo] = useState('');
  const [phone, setPhone] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [hostel, setHostel] = useState(''); // BH1 | BH2 | GH
  const [submitting, setSubmitting] = useState(false);

  // Simple validation helpers
  const isValidName = (val) => val.trim().length >= 2 && val.trim().length <= 80;
  const isValidRoll = (val) => val.trim().length >= 3 && val.trim().length <= 20;
  const isValidPhone = (val) => {
    // Basic check: must contain numbers and length between 10-15
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
      return toast.error('Please enter a valid phone number (e.g. +919876543210).');
    }
    if (!isValidPhone(parentPhone)) {
      return toast.error('Please enter a valid parent phone number.');
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
    <div className="login-page">
      {/* Theme toggle */}
      <button
        type="button"
        className="login-theme-toggle"
        onClick={toggleTheme}
        aria-label={`Switch to ${theme === 'light' ? 'dark' : 'bright'} mode`}
      >
        <span className="login-theme-toggle-icon">
          {theme === 'light' ? <MdDarkMode size={18} /> : <MdLightMode size={18} />}
        </span>
        <span>{theme === 'light' ? 'Dark Mode' : 'Bright Mode'}</span>
      </button>

      {/* Main glassmorphic onboarding card */}
      <form
        onSubmit={handleSubmit}
        className="login-card fade-in"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          maxWidth: '520px',
          padding: '40px',
          boxSizing: 'border-box',
          gap: '24px',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          {/* Logo */}
          <div
            className="login-mark"
            style={{
              width: 76,
              height: 76,
              margin: '0 auto 16px',
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

          <div className="login-eyebrow" style={{ marginBottom: '8px' }}>First-time Setup</div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-0.5px', marginBottom: '8px' }}>
            Complete Your Profile
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: '380px', margin: '0 auto' }}>
            Hi {user?.name || 'Student'}, please confirm your details once to access gate permissions and outpasses.
          </p>
        </div>

        {/* Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Official Name Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Official Name (for college records)
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <MdPerson size={18} style={{ position: 'absolute', left: '14px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Enter your full official name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 42px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                  background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease',
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))'}
              />
            </div>
          </div>
          {/* Roll Number Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Roll / MIS Number
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <MdSchool size={18} style={{ position: 'absolute', left: '14px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="e.g. 11241509X"
                value={rollNo}
                onChange={(e) => setRollNo(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 42px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                  background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease',
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))'}
              />
            </div>
          </div>

          {/* Personal Phone Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Your Phone Number
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <MdPhone size={18} style={{ position: 'absolute', left: '14px', color: 'var(--text-muted)' }} />
              <input
                type="tel"
                placeholder="e.g. +919876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 42px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                  background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease',
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))'}
              />
            </div>
          </div>

          {/* Parent Phone Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Parent's Phone Number (for Home Visit Permission)
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <MdPeople size={18} style={{ position: 'absolute', left: '14px', color: 'var(--text-muted)' }} />
              <input
                type="tel"
                placeholder="e.g. +919988776655"
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 42px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                  background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease',
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))'}
              />
            </div>
          </div>

          {/* Hostel Selection Dropdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Select Hostel Block
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <MdHome size={18} style={{ position: 'absolute', left: '14px', color: 'var(--text-muted)' }} />
              <select
                value={hostel}
                onChange={(e) => setHostel(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 42px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                  background: 'var(--bg-input, rgba(255, 255, 255, 0.03))',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  appearance: 'none',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s ease',
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.08))'}
              >
                <option value="" disabled style={{ background: 'var(--bg-card, #13192c)' }}>Choose Hostel</option>
                <option value="BH1" style={{ background: 'var(--bg-card, #13192c)' }}>Boys Hostel 1 (BH1)</option>
                <option value="BH2" style={{ background: 'var(--bg-card, #13192c)' }}>Boys Hostel 2 (BH2)</option>
                <option value="GH" style={{ background: 'var(--bg-card, #13192c)' }}>Girls Hostel (GH)</option>
              </select>
              <div style={{
                position: 'absolute',
                right: '16px',
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
            padding: '14px 20px',
            borderRadius: '12px',
            border: '2px solid rgba(59, 130, 246, 0.55)',
            background: 'rgba(59, 130, 246, 0.08)',
            color: '#fff',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            letterSpacing: '0.01em',
            boxShadow: '0 4px 24px rgba(59, 130, 246, 0.2)',
          }}
          onMouseEnter={(e) => {
            if (!submitting) {
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.18)';
              e.currentTarget.style.borderColor = '#3b82f6';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!submitting) {
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.55)';
              e.currentTarget.style.transform = 'none';
            }
          }}
        >
          {submitting ? 'Setting up Profile...' : 'Complete Registration'}
        </button>
      </form>
    </div>
  );
}
