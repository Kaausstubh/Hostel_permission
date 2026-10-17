/**
 * Parent Login Page
 * Supports both Password authentication and instant Email OTP sign-in.
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function ParentLogin() {
  const navigate = useNavigate();
  const [authMode, setAuthMode] = useState('password'); // 'password' | 'otp'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return toast.error('Email and password required');

    setLoading(true);
    try {
      const res = await api.post('/parent/login', {
        email: email.trim().toLowerCase(),
        password,
      });

      const { token, user } = res.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      toast.success(`Welcome, ${user.name}!`);
      navigate('/parent/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed. Check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!email) return toast.error('Please enter your email');

    setLoading(true);
    try {
      const res = await api.post('/parent/send-login-otp', {
        email: email.trim().toLowerCase(),
      });
      toast.success(res.data?.message || 'Login code sent to your email.');
      setOtpSent(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to dispatch code');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpLogin = async (e) => {
    e.preventDefault();
    if (!otp || otp.trim().length !== 6) return toast.error('Enter 6-digit code');

    setLoading(true);
    try {
      const res = await api.post('/parent/login-otp', {
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
      });

      const { token, user } = res.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      toast.success(`Welcome, ${user.name}!`);
      navigate('/parent/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid or expired code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page" style={{ padding: 24, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="login-card fade-in" style={{ maxWidth: 440, width: '100%' }}>
        <div className="login-logo">
          <h1>🏛️ HEIMDALL</h1>
          <p>Parent & Guardian Portal</p>
        </div>

        {/* Tab switch between Password and Email OTP */}
        <div className="tabs" style={{ marginBottom: 20 }}>
          <button
            type="button"
            className={`tab ${authMode === 'password' ? 'active' : ''}`}
            onClick={() => { setAuthMode('password'); setOtpSent(false); }}
            style={{ flex: 1, textAlign: 'center' }}
          >
            Password
          </button>
          <button
            type="button"
            className={`tab ${authMode === 'otp' ? 'active' : ''}`}
            onClick={() => { setAuthMode('otp'); }}
            style={{ flex: 1, textAlign: 'center' }}
          >
            Email OTP
          </button>
        </div>

        {authMode === 'password' ? (
          <form onSubmit={handlePasswordLogin}>
            <div className="form-group">
              <label className="form-label">Parent Email</label>
              <input
                type="email"
                className="form-input"
                placeholder="parent@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label">Password</label>
                <Link to="/parent/forgot-password" style={{ fontSize: 12, color: '#60a5fa', textDecoration: 'none' }}>
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading}
              style={{ marginTop: 14, padding: 12 }}
            >
              {loading ? <span className="loading-spinner" /> : 'Sign In →'}
            </button>
          </form>
        ) : (
          <div>
            {!otpSent ? (
              <form onSubmit={handleSendOtp}>
                <div className="form-group">
                  <label className="form-label">Parent Registered Email</label>
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
                  {loading ? <span className="loading-spinner" /> : 'Send Login Code →'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleOtpLogin}>
                <div style={{
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 16,
                  fontSize: 13,
                }}>
                  Code sent to <strong>{email}</strong>
                </div>

                <div className="form-group">
                  <label className="form-label">6-Digit Code</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="123456"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                    required
                    style={{
                      fontSize: 22,
                      letterSpacing: 6,
                      textAlign: 'center',
                      fontFamily: 'monospace',
                    }}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={loading || otp.length !== 6}
                  style={{ marginTop: 14, padding: 12 }}
                >
                  {loading ? <span className="loading-spinner" /> : 'Verify & Enter Dashboard'}
                </button>

                <div style={{ textAlign: 'center', marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => setOtpSent(false)}
                    style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 13 }}
                  >
                    Change Email
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <div className="login-footer" style={{ marginTop: 24, textAlign: 'center' }}>
          Student or Hostel Staff? <Link to="/login">Click here to sign in</Link>
        </div>
      </div>
    </div>
  );
}
