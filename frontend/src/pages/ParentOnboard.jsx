/**
 * Parent Onboard Page
 * Landing page when parent clicks single-use invitation link from email.
 * Verifies token validity (idempotently) and prompts parent to set their password.
 */

import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

export default function ParentOnboard() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { loginWithOAuth } = useAuth();

  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [data, setData] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      setValid(false);
      setErrorMessage('Missing invitation token. Please check the link in your email.');
      return;
    }

    const checkToken = async () => {
      try {
        const res = await api.get(`/parent/invitation/verify?token=${encodeURIComponent(token)}`);
        setValid(true);
        setData(res.data);
      } catch (err) {
        setValid(false);
        setErrorMessage(err.response?.data?.message || 'This invitation link is invalid, expired, or has already been used.');
      } finally {
        setChecking(false);
      }
    };

    checkToken();
  }, [token]);

  const handleActivate = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      return toast.error('Passwords do not match');
    }
    if (password.length < 6) {
      return toast.error('Password must be at least 6 characters');
    }

    setSubmitting(true);
    try {
      const res = await api.post('/parent/invitation/accept', {
        token,
        password,
      });

      const { token: jwtToken, user } = res.data;
      loginWithOAuth(jwtToken, user);

      toast.success('Account activated successfully! Welcome to HEIMDALL.');
      navigate('/parent/dashboard', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Activation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page" style={{ padding: 24, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="login-card fade-in" style={{ maxWidth: 480, width: '100%' }}>
        <div className="login-logo">
          <h1>🏛️ HEIMDALL</h1>
          <p>Parent & Guardian Portal</p>
        </div>

        {checking ? (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div className="loading-spinner" style={{ width: 36, height: 36, margin: '0 auto 12px' }} />
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Verifying your invitation...</div>
          </div>
        ) : !valid ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>⚠️</div>
            <h3 style={{ margin: '0 0 10px', color: '#ef4444' }}>Invalid or Expired Link</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
              {errorMessage}
            </p>
            <Link to="/parent/login" className="btn btn-primary btn-block">
              Go to Parent Login
            </Link>
          </div>
        ) : (
          <div>
            <div style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
                Linking as Guardian for:
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#60a5fa' }}>
                {data?.student?.name} ({data?.student?.rollNo})
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                Hostel: {data?.student?.hostel || 'Assigned'} | Room: {data?.student?.roomNo || 'N/A'}
              </div>
            </div>

            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 18 }}>
              Hello <strong>{data?.guardian?.name}</strong>, please set a secure password for your parent account to review and approve your ward's home-visit requests.
            </p>

            <form onSubmit={handleActivate}>
              <div className="form-group">
                <label className="form-label">Set Password *</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Confirm Password *</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={submitting}
                style={{ marginTop: 18, padding: 12 }}
              >
                {submitting ? <span className="loading-spinner" /> : 'Activate & Enter Dashboard →'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
