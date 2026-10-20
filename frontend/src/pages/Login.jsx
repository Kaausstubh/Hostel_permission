/**
 * Login Page — Institutional Google OAuth Login
 *
 * Role Access Control:
 * - Student Portal: Strictly restricted to official college domains (@cse, @ece, @cysec, @aids, @mevd, @iiitpune.ac.in). Personal Gmail accounts are blocked.
 * - Hostel Staff Command Centre: Strictly restricted to whitelisted staff emails (sjyotik2005@gmail.com, laxmanshinde@iiitp.ac.in, etc.).
 * - Security Control: Strictly restricted to whitelisted security personnel (kaaustubhkhandare@gmail.com, etc.).
 *
 * Authentication is performed solely via Google OAuth.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { MdLightMode, MdDarkMode, MdSchool, MdSecurity, MdAdminPanelSettings, MdLockOutline } from 'react-icons/md';
import { prewarmApiConnection } from '../services/api';
import toast from 'react-hot-toast';
import iiitLogo from '../assets/iiitpune-logo.webp';

// Google logo SVG
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

// Portal configuration with strict authorization rules
const PORTALS = {
  student: {
    label:       'Student',
    Icon:        MdSchool,
    description: 'Your digital key to hostel freedom. Request outpasses, track approvals in real-time, and carry your gate pass.',
    restriction: 'Restricted to IIIT Pune student domains (@cse, @ece, @cysec, @aids, @mevd, @iiitpune.ac.in). Personal Gmail accounts are blocked.',
    btnText:     'Enter Student Portal',
    color:       '#3b82f6',
    glow:        'rgba(59, 130, 246, 0.35)',
  },
  warden: {
    label:       'Hostel Staff',
    Icon:        MdAdminPanelSettings,
    description: 'Command your hostel block. Approve outpasses, monitor student movement, and keep students safe.',
    restriction: 'Restricted to authorized Hostel Staff accounts only.',
    btnText:     'Enter Hostel Staff Portal',
    color:       '#10b981',
    glow:        'rgba(16, 185, 129, 0.3)',
  },
  security: {
    label:       'Security',
    Icon:        MdSecurity,
    description: 'Main gate access control. Scan QR codes, verify passes in real-time, and log entry & exit.',
    restriction: 'Restricted to authorized Security personnel only.',
    btnText:     'Enter Security Control',
    color:       '#f59e0b',
    glow:        'rgba(245, 158, 11, 0.3)',
  },
};

export default function Login() {
  const { initiateGoogleOAuth } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [selectedPortal, setSelectedPortal] = useState('student');
  const [loggingIn, setLoggingIn] = useState(false);
  const loginTimeoutRef = useRef(null);

  const resetLoginState = useCallback(() => {
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
      loginTimeoutRef.current = null;
    }
    setLoggingIn(false);
  }, []);

  useEffect(() => {
    prewarmApiConnection();

    try {
      const searchParams = new URLSearchParams(window.location.search);
      const error = searchParams.get('error');
      const message = searchParams.get('message');
      if (error || message) {
        toast.error(message || 'Authentication failed. Please check your account authorization.', { duration: 6000 });
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {
      // Ignore query string parsing errors
    }

    const handlePageShow = () => resetLoginState();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') resetLoginState();
    };

    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('popstate', handlePageShow);
    window.addEventListener('focus', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (loginTimeoutRef.current) {
        clearTimeout(loginTimeoutRef.current);
        loginTimeoutRef.current = null;
      }
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('popstate', handlePageShow);
      window.removeEventListener('focus', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [resetLoginState]);

  const handleGoogleLogin = (portal) => {
    if (loggingIn) return;
    setLoggingIn(true);

    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
    }
    loginTimeoutRef.current = setTimeout(() => {
      setLoggingIn(false);
    }, 6000);

    initiateGoogleOAuth(portal);
  };

  const handleSelectPortal = (id) => {
    setSelectedPortal(id);
    resetLoginState();
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

      {/* Main Login Card */}
      <div
        className="login-card login-card-oauth fade-in"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '620px',
          maxHeight: '94vh',
          height: 'auto',
          overflowY: 'auto',
          padding: '42px 46px 36px',
          boxSizing: 'border-box',
          gap: '22px',
        }}
      >
        {/* ── Header ── */}
        <div style={{ textAlign: 'center' }}>
          <div className="login-eyebrow" style={{ marginBottom: '12px' }}>
            IIIT PUNE · SMART CAMPUS PORTAL
          </div>

          {/* Logo */}
          <div
            className="login-mark"
            style={{
              width: 68,
              height: 68,
              margin: '0 auto 12px',
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

          <h1 style={{ fontSize: '27px', fontWeight: 800, letterSpacing: '-0.5px', margin: '0 0 6px 0' }}>
            IIIT Pune Campus
          </h1>
          <p className="login-subtitle" style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 auto', maxWidth: '440px' }}>
            Sign in with your institutional account to access your portal.
          </p>
        </div>

        {/* ── 3 Portal Switcher Tabs ── */}
        <div className="login-portal-switcher" style={{
          display: 'flex',
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '14px',
          padding: '6px',
          border: '1px solid rgba(255,255,255,0.08)',
          gap: '8px',
          width: '100%',
        }}>
          {Object.entries(PORTALS).map(([id, portal]) => {
            const isActive = selectedPortal === id;
            const Icon = portal.Icon;
            return (
              <button
                key={id}
                type="button"
                className="login-portal-btn"
                onClick={() => handleSelectPortal(id)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '12px 8px',
                  borderRadius: '10px',
                  border: 'none',
                  background: isActive ? portal.color : 'transparent',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: '14.5px',
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                  boxShadow: isActive ? `0 4px 14px ${portal.glow}` : 'none',
                }}
              >
                <Icon size={18} />
                {portal.label}
              </button>
            );
          })}
        </div>

        {/* ── Active Portal Description & Restriction Badge ── */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          textAlign: 'center',
        }}>
          <p style={{
            fontSize: '14px',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            margin: 0,
            maxWidth: '460px',
          }}>
            {currentPortal.description}
          </p>

          <div style={{
            fontSize: '12.5px',
            fontWeight: 700,
            color: currentPortal.color,
            background: `${currentPortal.color}14`,
            border: `1px solid ${currentPortal.color}40`,
            padding: '8px 18px',
            borderRadius: '999px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            lineHeight: 1.4,
          }}>
            <MdLockOutline size={16} />
            <span>{currentPortal.restriction}</span>
          </div>
        </div>

        {/* ── Primary Action: Official Google Workspace OAuth Only ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', marginTop: '6px' }}>
          <button
            id={`login-${selectedPortal}-google`}
            type="button"
            className="btn-google-oauth"
            disabled={loggingIn}
            onClick={() => handleGoogleLogin(selectedPortal)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              padding: '16px 24px',
              borderRadius: '14px',
              border: 'none',
              background: '#ffffff',
              color: '#1f2937',
              fontSize: '16px',
              fontWeight: 700,
              cursor: loggingIn ? 'wait' : 'pointer',
              opacity: loggingIn ? 0.75 : 1,
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 18px rgba(0, 0, 0, 0.12)',
            }}
            onMouseEnter={(e) => {
              if (loggingIn) return;
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = `0 6px 24px ${currentPortal.glow}`;
            }}
            onMouseLeave={(e) => {
              if (loggingIn) return;
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = '0 4px 18px rgba(0, 0, 0, 0.12)';
            }}
          >
            {loggingIn ? (
              <>
                <div className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2, marginRight: 6 }} />
                <span>Redirecting to Google…</span>
              </>
            ) : (
              <>
                <GoogleIcon />
                <span>Sign in with Google ({currentPortal.label})</span>
              </>
            )}
          </button>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '2px' }}>
            Secure, password-free login via Google OAuth. Authenticates role and domain permissions.
          </div>
        </div>
      </div>
    </div>
  );
}
