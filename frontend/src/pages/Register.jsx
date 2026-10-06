/**
 * Register Page — Student Self-Registration
 * Only @iiitpune.ac.in emails are accepted.
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { validateIndianPhone } from '../utils/phone';

const COLLEGE_DOMAIN = 'iiitpune.ac.in';

const extractMisFromEmail = (email = '') => {
  if (!email || typeof email !== 'string') return '';
  const localPart = (email.split('@')[0] || '').trim();
  const numMatch = localPart.match(/\d+/);
  return numMatch ? numMatch[0] : localPart.toUpperCase();
};

export default function Register() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    rollNo: '',
    email: '',
    phone: '',
    parentPhone: '',
    parentPhone2: '',
    hostel: '',
    password: '',
    confirmPassword: '',
  });

  const autoMis = extractMisFromEmail(form.email);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleEmailChange = (e) => {
    const emailVal = e.target.value;
    const extracted = extractMisFromEmail(emailVal);
    setForm((f) => ({
      ...f,
      email: emailVal,
      rollNo: extracted || f.rollNo,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!agreeTerms) {
      return toast.error('Please accept the Hostel Terms and Conditions to proceed.');
    }

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
    const phoneCheck = validateIndianPhone(form.phone, 'Your Phone Number');
    if (!phoneCheck.valid) {
      return toast.error(phoneCheck.error);
    }

    const parentCheck = validateIndianPhone(form.parentPhone, 'Parent Contact 1');
    if (!parentCheck.valid) {
      return toast.error(parentCheck.error);
    }

    const parent2Check = validateIndianPhone(form.parentPhone2, 'Parent Contact 2');
    if (!parent2Check.valid) {
      return toast.error(parent2Check.error);
    }

    if (phoneCheck.digits10 === parentCheck.digits10) {
      return toast.error('Your Phone Number cannot be the same as Parent Contact 1. All 3 phone numbers must be unique.');
    }
    if (phoneCheck.digits10 === parent2Check.digits10) {
      return toast.error('Your Phone Number cannot be the same as Parent Contact 2. All 3 phone numbers must be unique.');
    }
    if (parentCheck.digits10 === parent2Check.digits10) {
      return toast.error('Parent Contact 1 and Parent Contact 2 cannot be the same number. All 3 phone numbers must be unique.');
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        name:         form.name,
        rollNo:       (autoMis || form.rollNo).trim().toUpperCase(),
        email:        form.email.toLowerCase(),
        phone:        form.phone,
        parentPhone:  form.parentPhone || undefined,
        parentPhone2: form.parentPhone2 || undefined,
        hostel:       form.hostel || undefined,
        password:     form.password,
      });

      // Auto-login after registration
      const { token, user } = res.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      toast.success(`Welcome, ${user.name}! 🎉`);
      navigate('/student');
    } catch (err) {
      const msg = err.response?.data?.message
        || (err.code === 'ERR_NETWORK' ? 'Cannot reach server. Start the backend and check VITE_API_URL.' : null)
        || 'Registration failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card fade-in" style={{ maxWidth: 480 }}>
        <div className="login-logo">
          <h1>🏛️ HEIMDALL</h1>
          <p>Student Registration</p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* College Email */}
          <div className="form-group">
            <label className="form-label">College Email *</label>
            <input id="reg-email" type="email" className="form-input"
              placeholder={`112415098@${COLLEGE_DOMAIN}`}
              value={form.email} onChange={handleEmailChange} required />
            {form.email && !form.email.toLowerCase().endsWith(`@${COLLEGE_DOMAIN}`) && (
              <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                ⚠️ Must be a @{COLLEGE_DOMAIN} email
              </div>
            )}
          </div>

          {/* Name + Roll No (Locked if extracted from email) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input id="reg-name" type="text" className="form-input"
                placeholder="Arjun Sharma" value={form.name} onChange={set('name')} required />
            </div>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label">MIS / Roll No *</label>
                {autoMis && (
                  <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>🔒 Locked</span>
                )}
              </div>
              <input
                id="reg-rollno"
                type="text"
                className="form-input"
                placeholder="112415098"
                value={autoMis || form.rollNo}
                readOnly={Boolean(autoMis)}
                onChange={set('rollNo')}
                required
                style={{
                  background: autoMis ? 'rgba(255, 255, 255, 0.04)' : undefined,
                  cursor: autoMis ? 'not-allowed' : undefined,
                  fontWeight: autoMis ? 700 : undefined,
                }}
              />
            </div>
          </div>

          {/* Phone */}
          <div className="form-group">
            <label className="form-label">Student Phone *</label>
            <input id="reg-phone" type="tel" className="form-input"
              placeholder="+919800000000" value={form.phone} onChange={set('phone')} required />
          </div>

          {/* Parent Phone 1 + Parent Phone 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Parent Contact 1 *</label>
              <input id="reg-parent-phone" type="tel" className="form-input"
                placeholder="+919700000000" value={form.parentPhone} onChange={set('parentPhone')} required />
            </div>
            <div className="form-group">
              <label className="form-label">Parent Contact 2 *</label>
              <input id="reg-parent-phone-2" type="tel" className="form-input"
                placeholder="+919600000000" value={form.parentPhone2} onChange={set('parentPhone2')} required />
            </div>
          </div>

          {/* Hostel */}
          <div className="form-group">
            <label className="form-label">Hostel</label>
            <select id="reg-hostel" className="form-input" value={form.hostel} onChange={set('hostel')}
              style={{ cursor: 'pointer' }}>
              <option value="">Select hostel...</option>
              <option value="BH1">Brahmaputra (BH1)</option>
              <option value="BH2">Krishna (BH2)</option>
              <option value="GH">Indrayani (GH)</option>
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

          {/* Warning Note */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.28)',
              color: '#ef4444',
              fontSize: '12.5px',
              lineHeight: '1.45',
              fontWeight: 600,
              marginTop: '10px',
              marginBottom: '6px',
            }}
          >
            <span style={{ fontSize: '17px', flexShrink: 0 }}>⚠️</span>
            <span>
              <strong>Note:</strong> Any wrong or false information provided during registration will result in immediate removal from the hostel.
            </span>
          </div>

          {/* Terms and Conditions Tick Box */}
          <div
            style={{
              marginTop: '14px',
              marginBottom: '10px',
              padding: '12px 14px',
              borderRadius: '10px',
              background: agreeTerms ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.04)',
              border: agreeTerms ? '1.5px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              transition: 'all 0.2s ease',
            }}
          >
            <input
              id="reg-terms-checkbox"
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              style={{
                marginTop: '3px',
                width: '18px',
                height: '18px',
                cursor: 'pointer',
                accentColor: 'var(--primary, #3b82f6)',
                flexShrink: 0,
              }}
              required
            />
            <label
              htmlFor="reg-terms-checkbox"
              style={{
                fontSize: '12.5px',
                lineHeight: '1.45',
                color: 'var(--text-secondary, #cbd5e1)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              I agree to the{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTermsModal(true);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary-light, #818cf8)',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: '12.5px',
                  fontWeight: 700,
                  display: 'inline',
                }}
              >
                Hostel Terms & Conditions
              </button>
              , Curfew Rules (8:00 PM), mandatory QR gate verification, and disciplinary policies.
            </label>
          </div>

          <button
            id="register-btn"
            type="submit"
            className="btn btn-primary"
            style={{
              width: '100%',
              marginTop: 8,
              justifyContent: 'center',
              cursor: (!agreeTerms || loading) ? 'not-allowed' : 'pointer',
              opacity: (!agreeTerms || loading) ? 0.45 : 1,
              filter: (!agreeTerms || loading) ? 'grayscale(0.7)' : 'none',
              pointerEvents: (!agreeTerms || loading) ? 'none' : 'auto',
              transition: 'all 0.2s ease',
            }}
            disabled={!agreeTerms || loading}
            title={!agreeTerms ? 'Tick the Terms and Conditions box to enable registration' : 'Create Student Account'}
          >
            {loading
              ? <><span className="loading-spinner" style={{ width: 16, height: 16 }} /> Registering...</>
              : (!agreeTerms ? '🔒 Accept Terms to Register' : '🎓 Create Student Account')}
          </button>
        </form>

        {/* Terms and Conditions Modal */}
        {showTermsModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(5px)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div
              style={{
                background: 'var(--bg-card, #1e293b)',
                border: '1px solid var(--border, #334155)',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '540px',
                maxHeight: '80vh',
                overflowY: 'auto',
                padding: '24px',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📜 Hostel Terms & Conditions</h3>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowTermsModal(false)}
                  style={{ padding: '4px 8px' }}
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary, #cbd5e1)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p>
                  <strong>1. Accurate Contact Details:</strong> All submitted student and parent contact numbers must be valid, active Indian phone numbers and genuinely belong to parents/guardians. Providing false contacts is a serious disciplinary violation.
                </p>
                <p>
                  <strong>2. Curfew Timings:</strong> Daily campus entry curfew is strictly 8:00 PM. Students returning after 8:00 PM without approved permission will be flagged as late or not returned.
                </p>
                <p>
                  <strong>3. Gate Scanning:</strong> Every entry and exit through the hostel campus gate requires mandatory scanning of your personal dynamic QR code at the security checkpoint.
                </p>
                <p>
                  <strong>4. Home Visits & Parental Consent:</strong> Extended home leaves require hostel staff authorization and verified guardian confirmation through phone calls or automated WhatsApp approval links.
                </p>
                <p>
                  <strong>5. Disciplinary Actions:</strong> Violation of hostel norms or impersonation at security gates will lead to immediate revocation of hostel residency rights.
                </p>
              </div>
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setAgreeTerms(true);
                    setShowTermsModal(false);
                  }}
                >
                  I Understand & Agree
                </button>
              </div>
            </div>
          </div>
        )}

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
