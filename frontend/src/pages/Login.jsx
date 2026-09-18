/**
 * Login Page — Google OAuth
 *
 * Three portal cards: Student | Warden | Security
 * Each card has a single "Continue with Google" button.
 * Clicking initiates the Google OAuth flow via backend redirect.
 *
 * Student Portal shows domain restriction info (@cse.iiitp.ac.in, @ece.iiitp.ac.in).
 * Warden and Security portals are currently open to any Google account.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { MdLightMode, MdDarkMode, MdSchool, MdSecurity, MdAdminPanelSettings } from 'react-icons/md';
import { prewarmApiConnection } from '../services/api';
import iiitLogo from '../assets/iiitpune-logo.png';

// Google logo SVG (inline — no external dependency)
const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

// Portal configuration
const PORTALS = {
  student: {
    label:       'Student',
    Icon:        MdSchool,
    description: 'Your digital key to hostel freedom. Request outpasses, track approvals in real-time, and carry your gate pass — right in your pocket.',
    restriction: 'Restricted to @cse.iiitp.ac.in & @ece.iiitp.ac.in accounts.',
    btnText:     '🎓 Enter Student Portal',
    color:       '#3b82f6',
    glow:        'rgba(59, 130, 246, 0.35)',
  },
  warden: {
    label:       'Warden',
    Icon:        MdAdminPanelSettings,
    description: 'Command your hostel block. Approve outpasses, monitor every movement, and keep your students safe — all from one powerful dashboard.',
    restriction: 'Any authorized Google account.',
    btnText:     '🛡️ Enter Warden Command Centre',
    color:       '#10b981',
    glow:        'rgba(16, 185, 129, 0.3)',
  },
  security: {
    label:       'Security',
    Icon:        MdSecurity,
    description: 'You are the last line of defense. Scan QR codes, verify student passes in seconds, and ensure every gate entry is legitimate.',
    restriction: 'Any authorized Google account.',
    btnText:     '🔍 Enter Security Control',
    color:       '#f59e0b',
    glow:        'rgba(245, 158, 11, 0.3)',
  },
};

export default function Login() {
  const { initiateGoogleOAuth } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [selectedPortal, setSelectedPortal] = useState('student');

  useEffect(() => {
    prewarmApiConnection();
  }, []);

  const handleGoogleLogin = (portal) => {
    initiateGoogleOAuth(portal);
  };

  const currentPortal = PORTALS[selectedPortal];

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

      {/* Main Single Box Login Card — Screen filling */}
      <div
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
          padding: '44px 44px 40px',
          boxSizing: 'border-box',
        }}
      >
        {/* ── Header ── */}
        <div style={{ textAlign: 'center' }}>
          <div className="login-eyebrow" style={{ marginBottom: '20px' }}>IIIT Pune · Smart Campus Portal</div>

          {/* Logo */}
          <div
            className="login-mark"
            style={{
              width: 76,
              height: 76,
              margin: '0 auto 20px',
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

          {/* Title */}
          <h1 style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-0.5px', marginBottom: '10px' }}>
            IIIT Pune Campus
          </h1>
          <p className="login-subtitle" style={{ fontSize: '15px', color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: '400px', margin: '0 auto' }}>
            Sign in with your institutional account to access your portal.
          </p>
        </div>

        {/* ── Portal Switcher ── */}
        <div>
          <div className="login-portal-switcher" style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '16px',
            padding: '5px',
            border: '1px solid rgba(255,255,255,0.08)',
            gap: '6px',
            width: '100%',
            marginBottom: '28px',
          }}>
            {Object.entries(PORTALS).map(([id, portal]) => {
              const isActive = selectedPortal === id;
              const Icon = portal.Icon;
              return (
                <button
                  key={id}
                  type="button"
                  className="login-portal-btn"
                  onClick={() => setSelectedPortal(id)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '7px',
                    padding: '13px 8px',
                    borderRadius: '12px',
                    border: 'none',
                    background: isActive ? portal.color : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: isActive ? `0 6px 20px ${portal.glow}` : 'none',
                  }}
                >
                  <Icon size={17} />
                  {portal.label}
                </button>
              );
            })}
          </div>

          {/* ── Portal Description + Badge ── */}
          <div className="login-portal-description-area" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
            textAlign: 'center',
            marginBottom: '28px',
          }}>
            {/* Big icon */}
            <div className="login-portal-icon-wrap" style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: `${currentPortal.color}18`,
              border: `2px solid ${currentPortal.color}40`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 0 24px ${currentPortal.glow}`,
            }}>
              <currentPortal.Icon size={30} style={{ color: currentPortal.color }} />
            </div>

            <p className="login-portal-text" style={{
              fontSize: '15.5px',
              color: 'var(--text-secondary)',
              lineHeight: 1.65,
              margin: 0,
              maxWidth: '380px',
            }}>
              {currentPortal.description}
            </p>

            <div className="login-portal-restriction" style={{
              fontSize: '12px',
              fontWeight: 700,
              color: currentPortal.color,
              background: `${currentPortal.color}14`,
              border: `1.5px solid ${currentPortal.color}40`,
              padding: '8px 18px',
              borderRadius: '999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              letterSpacing: '0.02em',
            }}>
              🔒 {currentPortal.restriction}
            </div>
          </div>
        </div>

        {/* ── Google Sign-In Button ── */}
        <div style={{ width: '100%' }}>
          <button
            id={`login-${selectedPortal}-google`}
            type="button"
            className="login-google-btn"
            onClick={() => handleGoogleLogin(selectedPortal)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              padding: '16px 24px',
              borderRadius: '14px',
              border: `2px solid ${currentPortal.color}55`,
              background: `${currentPortal.color}0e`,
              color: 'var(--text-primary)',
              fontFamily: 'Space Grotesk, Inter, sans-serif',
              fontSize: '16px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              letterSpacing: '0.01em',
              boxShadow: `0 4px 24px ${currentPortal.glow}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${currentPortal.color}22`;
              e.currentTarget.style.borderColor = currentPortal.color;
              e.currentTarget.style.boxShadow = `0 8px 32px ${currentPortal.glow}`;
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = `${currentPortal.color}0e`;
              e.currentTarget.style.borderColor = `${currentPortal.color}55`;
              e.currentTarget.style.boxShadow = `0 4px 24px ${currentPortal.glow}`;
              e.currentTarget.style.transform = 'none';
            }}
          >
            <GoogleIcon />
            {currentPortal.btnText}
          </button>

          <p style={{
            textAlign: 'center',
            fontSize: '11.5px',
            color: 'var(--text-muted)',
            marginTop: '16px',
            lineHeight: 1.5,
          }}>
            Secure, password-free login via Google OAuth. Your credentials are never stored.
          </p>
        </div>
      </div>
    </div>
  );
}
