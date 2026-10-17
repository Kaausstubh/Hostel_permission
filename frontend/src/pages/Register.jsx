/**
 * Register Page — Student Self-Registration with Digital Parent Linking
 *
 * Requirements:
 * 1. College email validation (allowed college domains)
 * 2. 3 distinct phone numbers (student, guardian 1, guardian 2) with 10-digit Indian validation
 * 3. 2 distinct parent emails (non-college personal emails)
 * 4. Guardian 1 and Guardian 2 names & relationships
 * 5. 2-Step OTP verification before account creation
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { validateIndianPhone } from '../utils/phone';

const ALLOWED_COLLEGE_DOMAINS = [
  'iiitpune.ac.in',
  'cse.iiitp.ac.in',
  'ece.iiitp.ac.in',
  'cysec.iiitp.ac.in',
  'aids.iiitp.ac.in',
  'mevd.iiitp.ac.in',
  'iiitp.ac.in',
  'college.edu',
];

const extractMisFromEmail = (email = '') => {
  if (!email || typeof email !== 'string') return '';
  const localPart = (email.split('@')[0] || '').trim();
  const numMatch = localPart.match(/\d+/);
  return numMatch ? numMatch[0] : localPart.toUpperCase();
};

export default function Register() {
  const navigate = useNavigate();
  const [step, setStep] = useState('form'); // 'form' | 'otp'
  const [loading, setLoading] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [otp, setOtp] = useState('');
  const [resendingOtp, setResendingOtp] = useState(false);

  const [form, setForm] = useState({
    name: '',
    rollNo: '',
    email: '',
    phone: '',
    hostel: '',
    password: '',
    confirmPassword: '',
    guardian1: {
      name: '',
      relationship: 'Father',
      phone: '',
      email: '',
    },
    guardian2: {
      name: '',
      relationship: 'Mother',
      phone: '',
      email: '',
    },
  });

  const autoMis = extractMisFromEmail(form.email);

  const setField = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const setG1 = (field) => (e) =>
    setForm((f) => ({ ...f, guardian1: { ...f.guardian1, [field]: e.target.value } }));

  const setG2 = (field) => (e) =>
    setForm((f) => ({ ...f, guardian2: { ...f.guardian2, [field]: e.target.value } }));

  const handleEmailChange = (e) => {
    const emailVal = e.target.value;
    const extracted = extractMisFromEmail(emailVal);
    setForm((f) => ({
      ...f,
      email: emailVal,
      rollNo: extracted || f.rollNo,
    }));
  };

  const isCollegeDomain = (email) => {
    if (!email || !email.includes('@')) return false;
    const domain = email.split('@')[1]?.toLowerCase().trim();
    return ALLOWED_COLLEGE_DOMAINS.includes(domain);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!agreeTerms) {
      return toast.error('Please accept the Hostel Terms and Conditions to proceed.');
    }

    const normEmail = form.email.trim().toLowerCase();
    if (!isCollegeDomain(normEmail)) {
      return toast.error(`Only authorized college domains (${ALLOWED_COLLEGE_DOMAINS.map((d) => `@${d}`).join(', ')}) are allowed`);
    }

    if (form.password !== form.confirmPassword) {
      return toast.error('Passwords do not match');
    }
    if (form.password.length < 6) {
      return toast.error('Password must be at least 6 characters');
    }

    // Phone checks
    const spCheck = validateIndianPhone(form.phone, 'Student Phone');
    if (!spCheck.valid) return toast.error(spCheck.error);

    const g1pCheck = validateIndianPhone(form.guardian1.phone, 'Guardian 1 Phone');
    if (!g1pCheck.valid) return toast.error(g1pCheck.error);

    const g2pCheck = validateIndianPhone(form.guardian2.phone, 'Guardian 2 Phone');
    if (!g2pCheck.valid) return toast.error(g2pCheck.error);

    const spDigits = spCheck.digits10;
    const g1pDigits = g1pCheck.digits10;
    const g2pDigits = g2pCheck.digits10;

    if (spDigits === g1pDigits || spDigits === g2pDigits) {
      return toast.error('Student phone cannot be the same as any guardian phone number.');
    }
    if (g1pDigits === g2pDigits) {
      return toast.error('Guardian 1 phone and Guardian 2 phone must be different numbers.');
    }

    // Email checks
    const g1Email = form.guardian1.email.trim().toLowerCase();
    const g2Email = form.guardian2.email.trim().toLowerCase();

    if (isCollegeDomain(g1Email) || isCollegeDomain(g2Email)) {
      return toast.error('Parent emails must be personal emails (cannot use college domains).');
    }
    if (normEmail === g1Email || normEmail === g2Email) {
      return toast.error('Parent emails cannot be identical to the student college email.');
    }
    if (g1Email === g2Email) {
      return toast.error('Guardian 1 email and Guardian 2 email must be distinct from each other.');
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        name: form.name.trim(),
        rollNo: (autoMis || form.rollNo).trim().toUpperCase(),
        email: normEmail,
        phone: form.phone,
        hostel: form.hostel || undefined,
        password: form.password,
        guardian1: {
          name: form.guardian1.name.trim(),
          relationship: form.guardian1.relationship,
          phone: form.guardian1.phone,
          email: g1Email,
        },
        guardian2: {
          name: form.guardian2.name.trim(),
          relationship: form.guardian2.relationship,
          phone: form.guardian2.phone,
          email: g2Email,
        },
      });

      toast.success(res.data?.message || 'Verification code sent to your email!');
      setStep('otp');
    } catch (err) {
      const msg = err.response?.data?.message || 'Registration failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp || otp.trim().length !== 6) {
      return toast.error('Please enter the 6-digit verification code.');
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/verify-registration-otp', {
        email: form.email.trim().toLowerCase(),
        otp: otp.trim(),
      });

      const { token, user } = res.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));

      if (res.data.mailConfigured) {
        toast.success(`Welcome, ${user.name}! 🎉 Parent invitations sent to email inboxes.`);
      } else {
        toast.success(`Welcome, ${user.name}! (Note: Real email delivery requires SMTP in backend/.env)`, { duration: 6000 });
      }

      const inviteUrlKeys = Object.keys(res.data?.inviteUrls || {});
      if (inviteUrlKeys.length > 0) {
        const firstUrl = res.data.inviteUrls[inviteUrlKeys[0]];
        navigator.clipboard?.writeText(firstUrl);
        toast.success('Parent onboarding link copied to clipboard!', { icon: '📋', duration: 7000 });
      }

      navigate('/student');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setResendingOtp(true);
    try {
      await api.post('/auth/resend-registration-otp', {
        email: form.email.trim().toLowerCase(),
      });
      toast.success('A new verification code has been dispatched to your email.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resend code');
    } finally {
      setResendingOtp(false);
    }
  };

  return (
    <div className="login-page" style={{ padding: '30px 16px' }}>
      <div className="login-card fade-in" style={{ maxWidth: 640, width: '100%' }}>
        <div className="login-logo" style={{ marginBottom: 20 }}>
          <h1>🏛️ HEIMDALL</h1>
          <p>{step === 'form' ? 'Student Registration with Digital Guardian Linking' : 'Verify College Email'}</p>
        </div>

        {step === 'otp' ? (
          <form onSubmit={handleVerifyOtp} className="fade-in">
            <div style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
              fontSize: 13.5,
              lineHeight: 1.5,
            }}>
              ✉️ We sent a 6-digit verification code to: <br />
              <strong style={{ color: '#60a5fa', fontSize: 14 }}>{form.email}</strong>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 700 }}>6-Digit Verification Code *</label>
              <input
                id="reg-otp"
                type="text"
                className="form-input"
                placeholder="123456"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                autoFocus
                required
                style={{
                  fontSize: 24,
                  letterSpacing: 8,
                  textAlign: 'center',
                  fontFamily: 'monospace',
                  padding: 12,
                }}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading || otp.length !== 6}
              style={{ marginTop: 16, padding: '12px' }}
            >
              {loading ? <span className="loading-spinner" /> : 'Verify Code & Complete Registration'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 13 }}>
              <button
                type="button"
                onClick={() => setStep('form')}
                className="btn-link"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ← Back to Edit Details
              </button>
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={resendingOtp}
                className="btn-link"
                style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontWeight: 600 }}
              >
                {resendingOtp ? 'Resending...' : 'Resend Code'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Section 1: Student Information */}
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              letterSpacing: 1,
              marginBottom: 10,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              paddingBottom: 4,
            }}>
              1. Student Details
            </div>

            {/* College Email */}
            <div className="form-group">
              <label className="form-label">College Email *</label>
              <input
                id="reg-email"
                type="email"
                className="form-input"
                placeholder="112415098@iiitpune.ac.in"
                value={form.email}
                onChange={handleEmailChange}
                required
              />
              {form.email && !isCollegeDomain(form.email) && (
                <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                  ⚠️ Must be a college email ({ALLOWED_COLLEGE_DOMAINS.map((d) => `@${d}`).join(', ')})
                </div>
              )}
            </div>

            {/* Name + Roll No */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input
                  id="reg-name"
                  type="text"
                  className="form-input"
                  placeholder="Arjun Sharma"
                  value={form.name}
                  onChange={setField('name')}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">MIS / Roll No *</label>
                <input
                  id="reg-rollno"
                  type="text"
                  className="form-input"
                  placeholder="112415098"
                  value={autoMis || form.rollNo}
                  readOnly={Boolean(autoMis)}
                  onChange={setField('rollNo')}
                  required
                  style={{
                    background: autoMis ? 'rgba(255, 255, 255, 0.04)' : undefined,
                    cursor: autoMis ? 'not-allowed' : undefined,
                    fontWeight: autoMis ? 700 : undefined,
                  }}
                />
              </div>
            </div>

            {/* Student Phone + Hostel */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Student Phone *</label>
                <input
                  id="reg-phone"
                  type="tel"
                  className="form-input"
                  placeholder="+919800000000"
                  value={form.phone}
                  onChange={setField('phone')}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Hostel</label>
                <select
                  id="reg-hostel"
                  className="form-input"
                  value={form.hostel}
                  onChange={setField('hostel')}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="">Select hostel...</option>
                  <option value="BH1">Brahmaputra (BH1)</option>
                  <option value="BH2">Krishna (BH2)</option>
                  <option value="GH1">Indrayani (GH1)</option>
                  <option value="GH2">Sindhu (GH2)</option>
                </select>
              </div>
            </div>

            {/* Section 2: Guardian 1 Details */}
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: '#60a5fa',
              letterSpacing: 1,
              marginTop: 18,
              marginBottom: 10,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              paddingBottom: 4,
            }}>
              2. Guardian 1 Details (Primary)
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Guardian 1 Name *</label>
                <input
                  id="reg-g1-name"
                  type="text"
                  className="form-input"
                  placeholder="Ramesh Sharma"
                  value={form.guardian1.name}
                  onChange={setG1('name')}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Relationship *</label>
                <select
                  id="reg-g1-rel"
                  className="form-input"
                  value={form.guardian1.relationship}
                  onChange={setG1('relationship')}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="Father">Father</option>
                  <option value="Mother">Mother</option>
                  <option value="Guardian">Guardian</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Guardian 1 Phone *</label>
                <input
                  id="reg-g1-phone"
                  type="tel"
                  className="form-input"
                  placeholder="+919876543211"
                  value={form.guardian1.phone}
                  onChange={setG1('phone')}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Guardian 1 Email (Personal) *</label>
                <input
                  id="reg-g1-email"
                  type="email"
                  className="form-input"
                  placeholder="parent1@gmail.com"
                  value={form.guardian1.email}
                  onChange={setG1('email')}
                  required
                />
              </div>
            </div>

            {/* Section 3: Guardian 2 Details */}
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: '#a78bfa',
              letterSpacing: 1,
              marginTop: 18,
              marginBottom: 10,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              paddingBottom: 4,
            }}>
              3. Guardian 2 Details (Secondary)
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Guardian 2 Name *</label>
                <input
                  id="reg-g2-name"
                  type="text"
                  className="form-input"
                  placeholder="Sunita Sharma"
                  value={form.guardian2.name}
                  onChange={setG2('name')}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Relationship *</label>
                <select
                  id="reg-g2-rel"
                  className="form-input"
                  value={form.guardian2.relationship}
                  onChange={setG2('relationship')}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="Mother">Mother</option>
                  <option value="Father">Father</option>
                  <option value="Guardian">Guardian</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Guardian 2 Phone *</label>
                <input
                  id="reg-g2-phone"
                  type="tel"
                  className="form-input"
                  placeholder="+919876543212"
                  value={form.guardian2.phone}
                  onChange={setG2('phone')}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Guardian 2 Email (Personal) *</label>
                <input
                  id="reg-g2-email"
                  type="email"
                  className="form-input"
                  placeholder="parent2@gmail.com"
                  value={form.guardian2.email}
                  onChange={setG2('email')}
                  required
                />
              </div>
            </div>

            {/* Section 4: Password & Terms */}
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              letterSpacing: 1,
              marginTop: 18,
              marginBottom: 10,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              paddingBottom: 4,
            }}>
              4. Password & Agreement
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Password *</label>
                <input
                  id="reg-password"
                  type="password"
                  className="form-input"
                  placeholder="Min 6 characters"
                  value={form.password}
                  onChange={setField('password')}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm Password *</label>
                <input
                  id="reg-confirm"
                  type="password"
                  className="form-input"
                  placeholder="Re-enter password"
                  value={form.confirmPassword}
                  onChange={setField('confirmPassword')}
                  required
                />
              </div>
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
              <label htmlFor="reg-terms-checkbox" style={{ fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer', lineHeight: '1.45' }}>
                I confirm all contact details provided are accurate. Both guardians will receive invitations to review and approve future home-visit requests.
              </label>
            </div>

            <button
              id="reg-submit-btn"
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading || !agreeTerms}
              style={{ marginTop: 14, padding: '12px' }}
            >
              {loading ? <span className="loading-spinner" /> : 'Send Verification Code →'}
            </button>
          </form>
        )}

        <div className="login-footer" style={{ marginTop: 20 }}>
          Already have an account? <Link to="/login">Sign in here</Link>
        </div>
      </div>
    </div>
  );
}
