/**
 * Student Onboarding Page — Smart Access Portal
 *
 * Appears exactly once when a new student logs in and has missing profile details
 * (Roll/MIS number, phone, parent phone, or hostel selection).
 *
 * Compact single-view layout on desktop (no vertical scrolling needed)
 * and fully responsive for mobile screens.
 */
import { useState, useEffect } from 'react';
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
  MdLogout,
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
  const [hostel, setHostel] = useState(user?.hostel || '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.email) {
      const extracted = extractMisFromEmail(user.email);
      if (extracted) {
        setRollNo(extracted);
      }
    }
  }, [user?.email]);

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
      return toast.error('Please enter a valid personal phone number (10 digits).');
    }
    if (!isValidPhone(parentPhone)) {
      return toast.error('Please enter a valid Parent Contact 1 phone number (10 digits).');
    }
    if (!isValidPhone(parentPhone2)) {
      return toast.error('Please enter a valid Parent Contact 2 phone number (10 digits).');
    }
    if (parentPhone.replace(/\D/g, '') === parentPhone2.replace(/\D/g, '')) {
      return toast.error('Parent Contact 1 and Parent Contact 2 must be different numbers.');
    }
    if (!hostel) {
      return toast.error('Please select your hostel block.');
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
        const token = localStorage.getItem('token');
        loginWithOAuth(token, res.data.user);
        toast.success('Registration complete! Entering Student Portal 🎉');
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
    <div className="onboard-viewport">
      <style>{`
        .onboard-viewport {
          min-height: 100vh;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 60px 16px 20px;
          box-sizing: border-box;
          background: var(--bg-main, #0b0f19);
          overflow-y: auto;
          position: relative;
        }
        .onboard-card-container {
          width: 100%;
          max-width: 660px;
          background: var(--card-bg, rgba(255, 255, 255, 0.98));
          border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
          border-radius: 18px;
          box-shadow: 0 20px 45px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          padding: 22px 26px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin: auto;
        }
        .onboard-header-section {
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
        }
        .onboard-logo-badge {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          padding: 3px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 2px;
        }
        .onboard-logo-badge img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: 50%;
        }
        .onboard-title-text {
          font-size: 19px;
          font-weight: 800;
          color: var(--text-primary, #0f172a);
          letter-spacing: -0.3px;
          margin: 0;
        }
        .onboard-subtitle-text {
          font-size: 12px;
          color: var(--text-muted, #64748b);
          line-height: 1.4;
          margin: 0;
          max-width: 480px;
        }
        .onboard-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 14px;
        }
        .onboard-field-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .onboard-field-label {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-secondary, #475569);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .onboard-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }
        .onboard-icon-left {
          position: absolute;
          left: 11px;
          color: var(--text-muted, #94a3b8);
          font-size: 16px;
          pointer-events: none;
        }
        .onboard-input-control {
          width: 100%;
          height: 38px;
          padding: 0 10px 0 34px;
          border-radius: 9px;
          border: 1px solid var(--border-color, rgba(0, 0, 0, 0.12));
          background: var(--bg-input, rgba(255, 255, 255, 0.05));
          color: var(--text-primary, #0f172a);
          font-size: 13px;
          outline: none;
          box-sizing: border-box;
          transition: all 0.2s ease;
        }
        .onboard-input-control:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 2.5px rgba(59, 130, 246, 0.15);
        }
        .onboard-input-control.locked-input {
          background: rgba(16, 185, 129, 0.04);
          color: var(--primary-light, #2563eb);
          font-weight: 700;
          cursor: not-allowed;
          padding-right: 32px;
          border-color: rgba(16, 185, 129, 0.25);
        }
        .onboard-submit-button {
          width: 100%;
          height: 42px;
          border: none;
          border-radius: 11px;
          background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
          color: #ffffff;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.2px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 6px 18px -3px rgba(37, 99, 235, 0.45);
          transition: all 0.2s ease;
          margin-top: 4px;
        }
        .onboard-submit-button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 8px 22px -3px rgba(37, 99, 235, 0.55);
          filter: brightness(1.04);
        }
        .onboard-submit-button:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .onboard-nav-top {
          position: fixed;
          top: 12px;
          left: 16px;
          right: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 100;
          pointer-events: none;
        }
        .onboard-top-btn {
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 6px 14px;
          border-radius: 9999px;
          border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15));
          background: var(--card-bg, rgba(255, 255, 255, 0.85));
          backdrop-filter: blur(12px);
          color: var(--text-primary, #0f172a);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 3px 10px rgba(0,0,0,0.06);
          transition: all 0.2s ease;
        }
        .onboard-top-btn:hover {
          background: var(--card-bg, #ffffff);
          transform: translateY(-1px);
        }
        .onboard-footer-btn {
          background: none;
          border: none;
          color: var(--text-muted, #64748b);
          font-size: 12px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          border-radius: 6px;
          transition: color 0.2s ease;
        }
        .onboard-footer-btn:hover {
          color: var(--text-primary, #0f172a);
        }

        @media (max-width: 640px) {
          .onboard-viewport {
            padding: 56px 12px 16px;
            align-items: flex-start;
          }
          .onboard-card-container {
            padding: 16px 14px;
            border-radius: 14px;
            gap: 10px;
          }
          .onboard-form-grid {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .onboard-title-text {
            font-size: 17px;
          }
          .onboard-logo-badge {
            width: 40px;
            height: 40px;
          }
          .onboard-input-control {
            height: 38px;
            font-size: 13px;
          }
        }
      `}</style>

      {/* Top action bar: Back to Portals + Theme toggle */}
      <div className="onboard-nav-top">
        <button
          type="button"
          className="onboard-top-btn"
          onClick={handleBackToPortals}
          title="Return to the Three Portals Login Page"
        >
          <MdArrowBack size={15} />
          <span>← Back to Portals</span>
        </button>

        <button
          type="button"
          className="onboard-top-btn"
          onClick={toggleTheme}
          style={{ padding: '6px 12px' }}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'bright'} mode`}
        >
          {theme === 'light' ? <MdDarkMode size={15} /> : <MdLightMode size={15} />}
          <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
        </button>
      </div>

      {/* Main compact card */}
      <form onSubmit={handleSubmit} className="onboard-card-container fade-in">
        {/* Header */}
        <div className="onboard-header-section">
          <div className="onboard-logo-badge">
            <img src={iiitLogo} alt="IIIT Pune logo" />
          </div>
          <h1 className="onboard-title-text">Complete Student Profile</h1>
          <p className="onboard-subtitle-text">
            Hi {user?.name || 'Student'}, verify your institutional & emergency contact details to activate gate access.
          </p>
        </div>

        {/* 2-Column Responsive Input Grid */}
        <div className="onboard-form-grid">
          {/* 1. Official Name */}
          <div className="onboard-field-group">
            <label className="onboard-field-label">Official Name (Records)</label>
            <div className="onboard-input-wrapper">
              <MdPerson className="onboard-icon-left" />
              <input
                type="text"
                placeholder="Full official name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="onboard-input-control"
              />
            </div>
          </div>

          {/* 2. Roll / MIS (Locked) */}
          <div className="onboard-field-group">
            <div className="onboard-field-label">
              <span>Roll / MIS Number *</span>
              {autoMis && (
                <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 700 }}>
                  Locked
                </span>
              )}
            </div>
            <div className="onboard-input-wrapper">
              <MdSchool className="onboard-icon-left" />
              <input
                type="text"
                placeholder="Roll / MIS"
                value={rollNo}
                readOnly={Boolean(autoMis)}
                onChange={(e) => !autoMis && setRollNo(e.target.value)}
                required
                className={`onboard-input-control ${autoMis ? 'locked-input' : ''}`}
              />
              {autoMis && (
                <MdLock
                  size={15}
                  style={{ position: 'absolute', right: '11px', color: '#10b981' }}
                  title="Auto-detected from email (Locked)"
                />
              )}
            </div>
          </div>

          {/* 3. Student Phone */}
          <div className="onboard-field-group">
            <label className="onboard-field-label">Your Phone Number *</label>
            <div className="onboard-input-wrapper">
              <MdPhone className="onboard-icon-left" />
              <input
                type="tel"
                placeholder="e.g. 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="onboard-input-control"
              />
            </div>
          </div>

          {/* 4. Hostel Block */}
          <div className="onboard-field-group">
            <label className="onboard-field-label">Select Hostel Block *</label>
            <div className="onboard-input-wrapper">
              <MdHome className="onboard-icon-left" />
              <select
                value={hostel}
                onChange={(e) => setHostel(e.target.value)}
                required
                className="onboard-input-control"
                style={{ cursor: 'pointer', appearance: 'none' }}
              >
                <option value="" disabled>Choose Hostel</option>
                <option value="BH1">Boys Hostel 1 (BH1)</option>
                <option value="BH2">Boys Hostel 2 (BH2)</option>
                <option value="GH">Girls Hostel (GH)</option>
              </select>
              <div style={{
                position: 'absolute',
                right: '13px',
                pointerEvents: 'none',
                border: 'solid var(--text-muted, #94a3b8)',
                borderWidth: '0 2px 2px 0',
                display: 'inline-block',
                padding: '3px',
                transform: 'rotate(45deg)',
              }} />
            </div>
          </div>

          {/* 5. Parent Phone 1 */}
          <div className="onboard-field-group">
            <label className="onboard-field-label">Parent Contact 1 (Father / Primary) *</label>
            <div className="onboard-input-wrapper">
              <MdPeople className="onboard-icon-left" />
              <input
                type="tel"
                placeholder="Father / Primary phone"
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
                required
                className="onboard-input-control"
              />
            </div>
          </div>

          {/* 6. Parent Phone 2 */}
          <div className="onboard-field-group">
            <label className="onboard-field-label">Parent Contact 2 (Mother / Alt) *</label>
            <div className="onboard-input-wrapper">
              <MdPeople className="onboard-icon-left" />
              <input
                type="tel"
                placeholder="Mother / Alternate phone"
                value={parentPhone2}
                onChange={(e) => setParentPhone2(e.target.value)}
                required
                className="onboard-input-control"
              />
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={submitting}
          className="onboard-submit-button"
        >
          {submitting ? 'Setting up Profile...' : 'Complete Registration & Enter Portal 🚀'}
        </button>

        {/* Footer switch/back link */}
        <div style={{ textAlign: 'center' }}>
          <button
            type="button"
            onClick={handleBackToPortals}
            className="onboard-footer-btn"
          >
            <MdLogout size={13} />
            <span>Wrong account or portal? Back to Three Portals</span>
          </button>
        </div>
      </form>
    </div>
  );
}
