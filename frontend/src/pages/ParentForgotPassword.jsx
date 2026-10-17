/**
 * Parent Password Reset Page
 * Handles forgot-password link dispatch and token-based password reset.
 */

import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function ParentForgotPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const paramEmail = searchParams.get('email') || '';
  const navigate = useNavigate();

  const isResetMode = Boolean(token);

  const [email, setEmail] = useState(paramEmail);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [submittedRequest, setSubmittedRequest] = useState(false);

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!email) return toast.error('Please enter your email');

    setLoading(true);
    try {
      await api.post('/parent/forgot-password', {
        email: email.trim().toLowerCase(),
      });
      setSubmittedRequest(true);
      toast.success('Reset link dispatched if email is registered.');
    } catch (err) {
      toast.error('Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      return toast.error('Passwords do not match');
    }
    if (newPassword.length < 6) {
      return toast.error('Password must be at least 6 characters');
    }

    setLoading(true);
    try {
      const res = await api.post('/parent/reset-password', {
        token,
        email: email.trim().toLowerCase(),
        newPassword,
      });
      toast.success(res.data?.message || 'Password reset successfully!');
      navigate('/parent/login');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page" style={{ padding: 24, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="login-card fade-in" style={{ maxWidth: 440, width: '100%' }}>
        <div className="login-logo">
          <h1>🏛️ HEIMDALL</h1>
          <p>{isResetMode ? 'Set New Password' : 'Reset Parent Password'}</p>
        </div>

        {isResetMode ? (
          <form onSubmit={handleResetSubmit}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">New Password *</label>
              <input
                type="password"
                className="form-input"
                placeholder="Min 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm New Password *</label>
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
              disabled={loading}
              style={{ marginTop: 14, padding: 12 }}
            >
              {loading ? <span className="loading-spinner" /> : 'Set New Password'}
            </button>
          </form>
        ) : submittedRequest ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>✉️</div>
            <h3 style={{ margin: '0 0 8px' }}>Check Your Email</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.5, marginBottom: 20 }}>
              If an active parent account is registered with <strong>{email}</strong>, a password reset link has been sent.
            </p>
            <Link to="/parent/login" className="btn btn-primary btn-block">
              Back to Parent Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleForgotSubmit}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.5, marginBottom: 16 }}>
              Enter your registered parent email address and we'll send you a link to reset your password.
            </p>

            <div className="form-group">
              <label className="form-label">Registered Parent Email</label>
              <input
                type="email"
                className="form-input"
                placeholder="parent@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading || !email}
              style={{ marginTop: 14, padding: 12 }}
            >
              {loading ? <span className="loading-spinner" /> : 'Send Reset Link →'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13 }}>
              <Link to="/parent/login" style={{ color: 'var(--text-muted)' }}>
                ← Back to Login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
