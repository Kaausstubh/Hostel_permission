import { useState } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdFamilyRestroom, MdClose, MdWarning, MdCheckCircle } from 'react-icons/md';

export default function StudentGuardianPrompt({ user, onComplete }) {
  // Open modal automatically upon first entering dashboard when guardians are missing
  const [modalOpen, setModalOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [hasSlot2, setHasSlot2] = useState(Boolean(user?.parentPhone2));
  const [formData, setFormData] = useState({
    guardian1: {
      name: '',
      relationship: 'Father',
      phone: user?.parentPhone?.replace('+91', '') || '',
      email: '',
    },
    guardian2: {
      name: '',
      relationship: 'Mother',
      phone: user?.parentPhone2?.replace('+91', '') || '',
      email: '',
    },
  });

  // Only render if student has no guardians linked
  if (user?.hasGuardians !== false) {
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    const g1Name = (formData.guardian1.name || '').trim();
    const g1Phone = (formData.guardian1.phone || '').trim().replace(/\D/g, '');
    const g1Email = (formData.guardian1.email || '').trim().toLowerCase();

    const g2Name = (formData.guardian2.name || '').trim();
    const g2Phone = (formData.guardian2.phone || '').trim().replace(/\D/g, '');
    const g2Email = (formData.guardian2.email || '').trim().toLowerCase();

    if (!g1Name || !g1Phone || !g1Email) {
      toast.error('Please fill in all details for Primary Guardian (Slot 1)');
      return;
    }
    if (hasSlot2 && (!g2Name || !g2Phone || !g2Email)) {
      toast.error('Please fill in all details for Secondary Guardian (Slot 2)');
      return;
    }

    if (g1Phone.length !== 10 || (hasSlot2 && g2Phone.length !== 10)) {
      toast.error('Please enter valid 10-digit mobile numbers');
      return;
    }

    if (hasSlot2 && g1Phone === g2Phone) {
      toast.error('Guardian 1 and Guardian 2 phone numbers must be distinct');
      return;
    }

    if (hasSlot2 && g1Email === g2Email) {
      toast.error('Guardian 1 and Guardian 2 email addresses must be distinct');
      return;
    }

    const myEmail = (user?.email || '').trim().toLowerCase();
    if (myEmail && (g1Email === myEmail || (hasSlot2 && g2Email === myEmail))) {
      toast.error('Parent email cannot be identical to your student login email');
      return;
    }

    const myPhoneDigits = (user?.phone || '').replace(/\D/g, '').slice(-10);
    if (myPhoneDigits && (g1Phone.slice(-10) === myPhoneDigits || (hasSlot2 && g2Phone.slice(-10) === myPhoneDigits))) {
      toast.error('Guardian phone number cannot be identical to your own phone number');
      return;
    }

    const collegeDomains = ['iiitpune.ac.in', 'cse.iiitp.ac.in', 'ece.iiitp.ac.in', 'cysec.iiitp.ac.in', 'aids.iiitp.ac.in', 'mevd.iiitp.ac.in', 'iiitp.ac.in', 'college.edu'];
    if (collegeDomains.some((d) => g1Email.endsWith('@' + d) || (hasSlot2 && g2Email.endsWith('@' + d)))) {
      toast.error('Parent emails must be personal addresses (e.g. Gmail), not college domains');
      return;
    }

    try {
      setLoading(true);
      const res = await api.post('/auth/complete-guardian-details', {
        guardian1: { ...formData.guardian1, name: g1Name, phone: g1Phone, email: g1Email },
        guardian2: hasSlot2 ? { ...formData.guardian2, name: g2Name, phone: g2Phone, email: g2Email } : undefined,
      });

      if (res.data.mailConfigured) {
        toast.success('Parent & guardian invitations sent to email inboxes!', { duration: 6000 });
      } else {
        toast.success(res.data.message || 'Guardian details saved! (Note: Real email sending requires SMTP in backend/.env)', { duration: 7000 });
      }

      const inviteUrlKeys = Object.keys(res.data?.inviteUrls || {});
      if (inviteUrlKeys.length > 0) {
        const firstUrl = res.data.inviteUrls[inviteUrlKeys[0]];
        navigator.clipboard?.writeText(firstUrl);
        toast.success('Onboarding link copied to clipboard!', { icon: '📋', duration: 6000 });
      }

      setModalOpen(false);
      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to submit guardian details');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Top Banner Alert */}
      <div style={{
        background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.12), rgba(245, 158, 11, 0.12))',
        borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        zIndex: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: 'rgba(239, 68, 68, 0.2)',
            color: '#ef4444',
            borderRadius: '50%',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <MdFamilyRestroom size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
              Action Required: Digital Parent Approval Setup
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Link your 2 parents / guardians to enable home-visit leave approvals and emergency contact.
            </div>
          </div>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          style={{
            background: '#ef4444',
            color: '#ffffff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'opacity 0.15s ease',
            whiteSpace: 'nowrap'
          }}
        >
          Complete Guardian Setup →
        </button>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 16
        }}>
          <div style={{
            background: 'var(--bg-card)',
            width: '100%',
            maxWidth: 580,
            maxHeight: '90vh',
            overflowY: 'auto',
            borderRadius: 12,
            border: '1px solid var(--border)',
            padding: 24,
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <MdFamilyRestroom size={24} style={{ color: 'var(--primary)' }} />
                <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>
                  Submit Parent & Guardian Details
                </h3>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <MdClose size={20} />
              </button>
            </div>

            <div style={{
              background: '#f59e0b15',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 12,
              color: 'var(--text-secondary)',
              display: 'flex',
              gap: 8,
              lineHeight: 1.4
            }}>
              <MdWarning size={20} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <div>
                <strong>Important:</strong> You can only submit your guardian details once. After submission, any modifications can only be made by hostel wardens or administration with full audit logs.
              </div>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Guardian 1 */}
              <div style={{ background: 'var(--bg-page)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 10 }}>
                  Primary Guardian (Slot 1) *
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>Full Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ramesh Sharma"
                      value={formData.guardian1.name}
                      onChange={(e) => setFormData({ ...formData, guardian1: { ...formData.guardian1, name: e.target.value } })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>Relationship</label>
                    <select
                      value={formData.guardian1.relationship}
                      onChange={(e) => setFormData({ ...formData, guardian1: { ...formData.guardian1, relationship: e.target.value } })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                    >
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Guardian">Legal Guardian</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>10-Digit Mobile</label>
                    <input
                      type="tel"
                      required
                      placeholder="9876543210"
                      value={formData.guardian1.phone}
                      onChange={(e) => setFormData({ ...formData, guardian1: { ...formData.guardian1, phone: e.target.value } })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>Personal Email (Non-College)</label>
                    <input
                      type="email"
                      required
                      placeholder="parent@gmail.com"
                      value={formData.guardian1.email}
                      onChange={(e) => setFormData({ ...formData, guardian1: { ...formData.guardian1, email: e.target.value } })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>
              </div>

              {/* Secondary Guardian Checkbox & Form */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="hasSlot2Student"
                  checked={hasSlot2}
                  onChange={(e) => setHasSlot2(e.target.checked)}
                />
                <label htmlFor="hasSlot2Student" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}>
                  Add Secondary Guardian (Slot 2)
                </label>
              </div>

              {hasSlot2 && (
                <div style={{ background: 'var(--bg-page)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 10 }}>
                    Secondary Guardian (Slot 2)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>Full Name</label>
                      <input
                        type="text"
                        required={hasSlot2}
                        placeholder="e.g. Sunita Sharma"
                        value={formData.guardian2.name}
                        onChange={(e) => setFormData({ ...formData, guardian2: { ...formData.guardian2, name: e.target.value } })}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>Relationship</label>
                      <select
                        value={formData.guardian2.relationship}
                        onChange={(e) => setFormData({ ...formData, guardian2: { ...formData.guardian2, relationship: e.target.value } })}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                      >
                        <option value="Mother">Mother</option>
                        <option value="Father">Father</option>
                        <option value="Guardian">Legal Guardian</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>10-Digit Mobile</label>
                      <input
                        type="tel"
                        required={hasSlot2}
                        placeholder="9876543211"
                        value={formData.guardian2.phone}
                        onChange={(e) => setFormData({ ...formData, guardian2: { ...formData.guardian2, phone: e.target.value } })}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>Personal Email (Non-College)</label>
                      <input
                        type="email"
                        required={hasSlot2}
                        placeholder="parent2@gmail.com"
                        value={formData.guardian2.email}
                        onChange={(e) => setFormData({ ...formData, guardian2: { ...formData.guardian2, email: e.target.value } })}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    padding: '8px 20px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--primary)',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {loading ? 'Submitting...' : 'Confirm & Dispatch Invites'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
