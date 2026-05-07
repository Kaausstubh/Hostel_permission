/**
 * Login Page
 * Role-based redirects: student → /student, security → /scanner, warden → /dashboard
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import iiitLogo from '../assets/iiitpune-logo.png';

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]   = useState(false);
  const { login } = useAuth();
  const navigate  = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return toast.error('Email and password required');
    setLoading(true);
    try {
      const user = await login(email, password);
      toast.success(`Welcome back, ${user.name}! 👋`);
      // Role-based redirect
      if (user.role === 'student')  navigate('/student');
      else if (user.role === 'security') navigate('/scanner');
      else navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card fade-in">
        <div className="login-logo">
          <div className="login-mark" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={iiitLogo} alt="IIIT Pune logo" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '50%' }} />
          </div>
          <h1>IIIT Pune Campus</h1>
          <p>Hostel Permissions & Gate Access</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ paddingRight: '40px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {showPassword ? <MdVisibilityOff size={20} /> : <MdVisibility size={20} />}
              </button>
            </div>
          </div>

          <button
            id="login-btn"
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '8px', justifyContent: 'center' }}
            disabled={loading}
          >
            {loading
              ? <><span className="loading-spinner" style={{ width: 16, height: 16 }} /> Signing in...</>
              : 'Sign In'}
          </button>
        </form>

        {/* Student registration link */}
        <div className="login-register-strip">
          New student?{' '}
          <Link
            to="/register"
            className="login-register-link"
          >
            Register with college email →
          </Link>
        </div>

        <div className="login-demo">
          <div className="login-demo-title">
            Demo Accounts <span className="login-demo-sub">(run <code>node seed.js</code> first)</span>
          </div>
          <div className="login-demo-grid">
            <div className="login-demo-row">
              <span className="login-demo-role">Warden</span>
              <span className="login-demo-cred"><code>warden@campus.edu</code> / <code>warden123</code></span>
            </div>
            <div className="login-demo-row">
              <span className="login-demo-role">Security</span>
              <span className="login-demo-cred"><code>security@campus.edu</code> / <code>security123</code></span>
            </div>
            <div className="login-demo-row">
              <span className="login-demo-role">Student</span>
              <span className="login-demo-cred"><code>arjun@iiitpune.ac.in</code> / <code>student123</code></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
