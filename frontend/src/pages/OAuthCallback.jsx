/**
 * OAuth Callback Page
 *
 * Handles the redirect from the backend after Google OAuth completes.
 *
 * Success URL: /auth/callback?token=JWT&user=BASE64_JSON
 * Error URL:   /auth/callback?error=CODE&message=HUMAN_READABLE
 *
 * On success: stores token/user → navigates to the correct portal.
 * On error:   shows the error message → redirects back to /login.
 */
import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function OAuthCallback() {
  const navigate = useNavigate();
  const { loginWithOAuth } = useAuth();
  const [status, setStatus] = useState('processing'); // 'processing' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');
    const userB64 = params.get('user');
    const error  = params.get('error');
    const message = params.get('message');

    // ── Error from backend ─────────────────────────────────────────────────────
    if (error) {
      const friendlyMsg = message || 'Authentication failed. Please try again.';
      setStatus('error');
      setErrorMsg(friendlyMsg);
      toast.error(friendlyMsg, { duration: 6000 });
      // Redirect to login after showing the error
      const timer = setTimeout(() => navigate('/login', { replace: true }), 4000);
      return () => clearTimeout(timer);
    }

    // ── Success ────────────────────────────────────────────────────────────────
    if (token && userB64) {
      try {
        const user = JSON.parse(atob(userB64));
        loginWithOAuth(token, user);
        toast.success(`Welcome, ${user.name}! 👋`);

        // Role-based redirect
        if (user.role === 'student')  navigate('/student',   { replace: true });
        else if (user.role === 'security') navigate('/scanner', { replace: true });
        else navigate('/dashboard', { replace: true });
      } catch {
        setStatus('error');
        setErrorMsg('Failed to process login response. Please try again.');
        const timer = setTimeout(() => navigate('/login', { replace: true }), 3000);
        return () => clearTimeout(timer);
      }
      return;
    }

    // ── No params at all (direct navigation) ──────────────────────────────────
    navigate('/login', { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ─────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="login-page">
        <div className="login-card fade-in" style={{ maxWidth: 420, textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🚫</div>
          <h2 style={{ fontWeight: 700, fontSize: 20, marginBottom: 12, color: 'var(--text-primary)' }}>
            Access Denied
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
            {errorMsg}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 16 }}>
            Redirecting you back to login…
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 24, width: '100%', justifyContent: 'center' }}
            onClick={() => navigate('/login', { replace: true })}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card fade-in" style={{ maxWidth: 420, textAlign: 'center' }}>
        <div className="loading-spinner" style={{ width: 48, height: 48, margin: '0 auto 20px' }} />
        <h2 style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>
          Signing you in…
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Completing Google authentication
        </p>
      </div>
    </div>
  );
}
