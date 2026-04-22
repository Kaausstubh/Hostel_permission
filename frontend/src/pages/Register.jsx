/**
 * Register Page — Student Self-Registration
 * Only @iiitpune.ac.in emails are accepted.
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';

const COLLEGE_DOMAIN = 'iiitpune.ac.in';

export default function Register() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    rollNo: '',
    email: '',
    phone: '',
    parentPhone: '',
    hostel: '',
    password: '',
    confirmPassword: '',
  });

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Client-side validations
    if (!form.email.toLowerCase().endsWith(`@${COLLEGE_DOMAIN}`)) {
      return toast.error(`Only @${COLLEGE_DOMAIN} emails are allowed`);
    }
    if (form.password !== form.confirmPassword) {
      return toast.error('Passwords do not match');
    }
    if (form.password.length < 6) {
      return toast.error('Password must be at least 6 characters');
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        name:        form.name,
        rollNo:      form.rollNo,
        email:       form.email.toLowerCase(),
        phone:       form.phone,
        parentPhone: form.parentPhone || undefined,
        hostel:      form.hostel || undefined,
        password:    form.password,
      });

      // Auto-login after registration
      const { token, user } = res.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      toast.success(`Welcome, ${user.name}! 🎉`);
      navigate('/student');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card fade-in" style={{ maxWidth: 480 }}>
        <div className="login-logo">
          <h1>🏛️ Smart Campus</h1>
          <p>Student Registration</p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Name + Roll No */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input id="reg-name" type="text" className="form-input"
                placeholder="Arjun Sharma" value={form.name} onChange={set('name')} required />
            </div>
            <div className="form-group">
              <label className="form-label">MIS / Roll No *</label>
              <input id="reg-rollno" type="text" className="form-input"
                placeholder="CS2021001" value={form.rollNo} onChange={set('rollNo')} required />
            </div>
          </div>

          {/* College Email */}
          <div className="form-group">
            <label className="form-label">College Email *</label>
            <input id="reg-email" type="email" className="form-input"
              placeholder={`yourname@${COLLEGE_DOMAIN}`}
              value={form.email} onChange={set('email')} required />
            {form.email && !form.email.toLowerCase().endsWith(`@${COLLEGE_DOMAIN}`) && (
              <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                ⚠️ Must be a @{COLLEGE_DOMAIN} email
              </div>
            )}
          </div>

          {/* Phone + Parent Phone */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Phone *</label>
              <input id="reg-phone" type="tel" className="form-input"
                placeholder="+919800000000" value={form.phone} onChange={set('phone')} required />
            </div>
            <div className="form-group">
              <label className="form-label">Parent's Phone</label>
              <input id="reg-parent-phone" type="tel" className="form-input"
                placeholder="+919700000000" value={form.parentPhone} onChange={set('parentPhone')} />
            </div>
          </div>

          {/* Hostel */}
          <div className="form-group">
            <label className="form-label">Hostel</label>
            <select id="reg-hostel" className="form-input" value={form.hostel} onChange={set('hostel')}
              style={{ cursor: 'pointer' }}>
              <option value="">Select hostel...</option>
              <option value="BH1">BH1 (Boys Hostel 1)</option>
              <option value="BH2">BH2 (Boys Hostel 2)</option>
              <option value="GH">GH (Girls Hostel)</option>
            </select>
          </div>

          {/* Password */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Password *</label>
              <input id="reg-password" type="password" className="form-input"
                placeholder="Min 6 characters" value={form.password} onChange={set('password')} required />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password *</label>
              <input id="reg-confirm" type="password" className="form-input"
                placeholder="Re-enter password" value={form.confirmPassword} onChange={set('confirmPassword')} required />
            </div>
          </div>

          <button id="register-btn" type="submit" className="btn btn-primary"
            style={{ width: '100%', marginTop: 8, justifyContent: 'center' }} disabled={loading}>
            {loading
              ? <><span className="loading-spinner" style={{ width: 16, height: 16 }} /> Registering...</>
              : '🎓 Create Student Account'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20, color: 'var(--text-muted)', fontSize: 13 }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--primary-light)', textDecoration: 'none', fontWeight: 600 }}>
            Sign In
          </Link>
        </div>

        <div style={{
          marginTop: 16, padding: 12, background: 'var(--glass)',
          border: 'var(--border)', borderRadius: 'var(--radius-md)',
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          🔒 Only <strong>@{COLLEGE_DOMAIN}</strong> email addresses can register as students.
        </div>
      </div>
    </div>
  );
}
