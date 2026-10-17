import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { 
  MdPeople, MdSearch, MdEmail, MdPhone, MdRefresh, 
  MdEdit, MdSend, MdAddCircleOutline, MdFileDownload,
  MdCheckCircle, MdHourglassTop, MdCancel, MdWarning
} from 'react-icons/md';

export default function GuardianManagement() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalPages: 1, total: 0 });
  const [actionLoading, setActionLoading] = useState(null);

  // Modals state
  const [editModalData, setEditModalData] = useState(null); // { guardian, student }
  const [linkModalStudent, setLinkModalStudent] = useState(null); // student
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '', relationship: 'Father', reason: '' });
  const [linkForm, setLinkForm] = useState({
    slot1: { name: '', relationship: 'Father', phone: '', email: '' },
    hasSlot2: false,
    slot2: { name: '', relationship: 'Mother', phone: '', email: '' }
  });

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/guardians/students', {
        params: {
          search: searchTerm,
          status: statusFilter,
          page,
          limit: 15
        }
      });
      setStudents(res.data.students || []);
      setPagination(res.data.pagination || { totalPages: 1, total: 0 });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to fetch students guardian status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, [searchTerm, statusFilter, page]);

  const handleResendInvite = async (guardianId) => {
    try {
      setActionLoading(`resend_${guardianId}`);
      const res = await api.post(`/admin/guardians/resend-invite/${guardianId}`);
      toast.success(res.data.message || 'Invitation resent successfully');
      if (res.data?.inviteUrl) {
        navigator.clipboard?.writeText(res.data.inviteUrl);
        toast.success('Direct onboarding link copied to clipboard!', { icon: '📋', duration: 5000 });
      }
      fetchStudents();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resend invitation');
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenEdit = (guardian, student) => {
    setEditModalData({ guardian, student });
    setEditForm({
      name: guardian.name,
      phone: guardian.phone,
      email: guardian.email,
      relationship: guardian.relationship,
      reason: ''
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editForm.name || !editForm.phone || !editForm.email) {
      toast.error('Name, phone, and email are required');
      return;
    }
    try {
      setActionLoading('saving_edit');
      const res = await api.put(`/admin/guardians/update/${editModalData.guardian._id}`, editForm);
      toast.success(res.data.message || 'Guardian updated successfully');
      setEditModalData(null);
      fetchStudents();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update guardian');
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenLink = (student) => {
    setLinkModalStudent(student);
    setLinkForm({
      slot1: { name: '', relationship: 'Father', phone: '', email: '' },
      hasSlot2: false,
      slot2: { name: '', relationship: 'Mother', phone: '', email: '' }
    });
  };

  const handleSaveLink = async (e) => {
    e.preventDefault();
    if (!linkForm.slot1.name || !linkForm.slot1.phone || !linkForm.slot1.email) {
      toast.error('Guardian 1 details are required');
      return;
    }
    if (linkForm.hasSlot2 && (!linkForm.slot2.name || !linkForm.slot2.phone || !linkForm.slot2.email)) {
      toast.error('Guardian 2 details are incomplete');
      return;
    }
    try {
      setActionLoading('saving_link');
      const payload = {
        student_id: linkModalStudent._id,
        guardian_1: linkForm.slot1,
        guardian_2: linkForm.hasSlot2 ? linkForm.slot2 : undefined
      };
      const res = await api.post('/admin/guardians/link-initial', payload);
      toast.success(res.data.message || 'Initial guardians linked successfully');
      setLinkModalStudent(null);
      fetchStudents();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to link guardians');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExportCSV = async () => {
    try {
      toast.loading('Generating CSV report...', { id: 'csv-toast' });
      const response = await api.get('/admin/guardians/approvals/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `parent_approvals_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Approvals report exported successfully', { id: 'csv-toast' });
    } catch (err) {
      toast.error('Failed to export approvals CSV', { id: 'csv-toast' });
    }
  };

  const renderStatusBadge = (status) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#10b98120', color: '#10b981', padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
            <MdCheckCircle size={14} /> Active
          </span>
        );
      case 'INVITED':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f59e0b20', color: '#f59e0b', padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
            <MdHourglassTop size={14} /> Invited
          </span>
        );
      case 'REVOKED':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#ef444420', color: '#ef4444', padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
            <MdCancel size={14} /> Revoked
          </span>
        );
      default:
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--border)', color: 'var(--text-muted)', padding: '3px 8px', borderRadius: 6, fontSize: 12 }}>
            Not Linked
          </span>
        );
    }
  };

  return (
    <div>
      <Navbar title="Guardian & Parent Management" />
      <div style={{ maxWidth: 1280, margin: '24px auto', padding: '0 20px' }}>
        
        {/* Header Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--text-primary)' }}>
              Student Guardian Directory
            </h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
              Manage parent accounts, track invitation statuses, and view audit history.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={handleExportCSV}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              <MdFileDownload size={18} /> Export Approvals CSV
            </button>
            <button
              onClick={fetchStudents}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                background: 'var(--primary)',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14
              }}
            >
              <MdRefresh size={18} /> Refresh
            </button>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          background: 'var(--bg-card)',
          padding: 16,
          borderRadius: 12,
          border: '1px solid var(--border)',
          marginBottom: 24
        }}>
          <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
            <MdSearch size={20} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by student name, roll number, or hostel..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
              style={{
                width: '100%',
                padding: '10px 14px 10px 40px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-page)',
                color: 'var(--text-primary)',
                fontSize: 14
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['ALL', 'LINKED', 'PARTIAL', 'NOT_LINKED'].map((filter) => (
              <button
                key={filter}
                onClick={() => { setStatusFilter(filter); setPage(1); }}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: statusFilter === filter ? '1px solid var(--primary)' : '1px solid var(--border)',
                  background: statusFilter === filter ? 'var(--primary-light, #2563eb18)' : 'var(--bg-page)',
                  color: statusFilter === filter ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                {filter.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Students Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 12px auto' }} />
            Loading students directory...
          </div>
        ) : students.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
            <MdPeople size={48} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
            <h3 style={{ margin: '0 0 6px 0', color: 'var(--text-primary)' }}>No students found</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>Try adjusting your search criteria or filter.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {students.map((student) => {
              const g1 = student.guardians?.find(g => g.slot === 1);
              const g2 = student.guardians?.find(g => g.slot === 2);
              const hasGuardians = Boolean(g1 || g2);

              return (
                <div
                  key={student._id}
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    padding: 20,
                    boxShadow: 'var(--shadow-sm)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 16 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {student.name}
                        </h3>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-page)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)' }}>
                          {student.rollNo}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {student.hostel} {student.roomNo ? `• Room ${student.roomNo}` : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 13, color: 'var(--text-muted)' }}>
                        <span><MdEmail style={{ verticalAlign: -2 }} /> {student.email}</span>
                        {student.phone && <span><MdPhone style={{ verticalAlign: -2 }} /> {student.phone}</span>}
                      </div>
                    </div>

                    {!hasGuardians && (
                      <button
                        onClick={() => handleOpenLink(student)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '6px 14px',
                          background: 'var(--primary)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 6,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <MdAddCircleOutline size={16} /> Link Initial Guardians
                      </button>
                    )}
                  </div>

                  {/* Guardians Details */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                    {/* Guardian 1 */}
                    <div style={{ background: 'var(--bg-page)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                          Primary Guardian (Slot 1)
                        </span>
                        {g1 ? renderStatusBadge(g1.status) : renderStatusBadge('UNLINKED')}
                      </div>

                      {g1 ? (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>
                            {g1.name} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>({g1.relationship})</span>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span><MdPhone style={{ verticalAlign: -2 }} /> {g1.phone}</span>
                            <span><MdEmail style={{ verticalAlign: -2 }} /> {g1.email}</span>
                          </div>

                          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <button
                              onClick={() => handleOpenEdit(g1, student)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 10px',
                                background: 'transparent',
                                border: '1px solid var(--border)',
                                borderRadius: 6,
                                fontSize: 12,
                                color: 'var(--text-primary)',
                                cursor: 'pointer'
                              }}
                            >
                              <MdEdit size={14} /> Edit Details
                            </button>
                            {g1.status === 'INVITED' && (
                              <button
                                onClick={() => handleResendInvite(g1._id)}
                                disabled={actionLoading === `resend_${g1._id}`}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '4px 10px',
                                  background: 'transparent',
                                  border: '1px solid var(--primary)',
                                  color: 'var(--primary)',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  cursor: 'pointer'
                                }}
                              >
                                <MdSend size={14} /> {actionLoading === `resend_${g1._id}` ? 'Sending...' : 'Resend Invite'}
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
                          No primary guardian linked.
                        </div>
                      )}
                    </div>

                    {/* Guardian 2 */}
                    <div style={{ background: 'var(--bg-page)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                          Secondary Guardian (Slot 2)
                        </span>
                        {g2 ? renderStatusBadge(g2.status) : renderStatusBadge('UNLINKED')}
                      </div>

                      {g2 ? (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>
                            {g2.name} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>({g2.relationship})</span>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span><MdPhone style={{ verticalAlign: -2 }} /> {g2.phone}</span>
                            <span><MdEmail style={{ verticalAlign: -2 }} /> {g2.email}</span>
                          </div>

                          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <button
                              onClick={() => handleOpenEdit(g2, student)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 10px',
                                background: 'transparent',
                                border: '1px solid var(--border)',
                                borderRadius: 6,
                                fontSize: 12,
                                color: 'var(--text-primary)',
                                cursor: 'pointer'
                              }}
                            >
                              <MdEdit size={14} /> Edit Details
                            </button>
                            {g2.status === 'INVITED' && (
                              <button
                                onClick={() => handleResendInvite(g2._id)}
                                disabled={actionLoading === `resend_${g2._id}`}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '4px 10px',
                                  background: 'transparent',
                                  border: '1px solid var(--primary)',
                                  color: 'var(--primary)',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  cursor: 'pointer'
                                }}
                              >
                                <MdSend size={14} /> {actionLoading === `resend_${g2._id}` ? 'Sending...' : 'Resend Invite'}
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
                          No secondary guardian registered.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    cursor: page === 1 ? 'not-allowed' : 'pointer'
                  }}
                >
                  Previous
                </button>
                <span style={{ display: 'flex', alignItems: 'center', fontSize: 14, color: 'var(--text-muted)' }}>
                  Page {page} of {pagination.totalPages}
                </span>
                <button
                  disabled={page === pagination.totalPages}
                  onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    cursor: page === pagination.totalPages ? 'not-allowed' : 'pointer'
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {/* Modal: Edit Guardian */}
        {editModalData && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16
          }}>
            <div style={{
              background: 'var(--bg-card)',
              width: '100%',
              maxWidth: 480,
              borderRadius: 12,
              border: '1px solid var(--border)',
              padding: 24,
              boxShadow: 'var(--shadow-lg)'
            }}>
              <h3 style={{ margin: '0 0 4px 0', fontSize: 18, color: 'var(--text-primary)' }}>
                Edit Guardian Details
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--text-muted)' }}>
                For student: <strong>{editModalData.student.name} ({editModalData.student.rollNo})</strong>
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f59e0b15', color: '#f59e0b', padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 16 }}>
                <MdWarning size={18} style={{ flexShrink: 0 }} />
                <span>All modifications will be permanently recorded in the immutable audit log with your account ID.</span>
              </div>

              <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
                    Guardian Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
                      Relationship
                    </label>
                    <select
                      value={editForm.relationship}
                      onChange={(e) => setEditForm({ ...editForm, relationship: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}
                    >
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Guardian">Legal Guardian</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
                    Parent Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
                    Reason for Change
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g., Parent updated personal phone number upon request"
                    value={editForm.reason}
                    onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)', resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setEditModalData(null)}
                    style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading === 'saving_edit'}
                    style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {actionLoading === 'saving_edit' ? 'Saving...' : 'Save & Log'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Link Initial Guardians */}
        {linkModalStudent && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16
          }}>
            <div style={{
              background: 'var(--bg-card)',
              width: '100%',
              maxWidth: 540,
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: 12,
              border: '1px solid var(--border)',
              padding: 24,
              boxShadow: 'var(--shadow-lg)'
            }}>
              <h3 style={{ margin: '0 0 4px 0', fontSize: 18, color: 'var(--text-primary)' }}>
                Link Initial Guardians
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--text-muted)' }}>
                For student: <strong>{linkModalStudent.name} ({linkModalStudent.rollNo})</strong>
              </p>

              <form onSubmit={handleSaveLink} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ padding: 12, background: 'var(--bg-page)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--text-primary)' }}>
                    Primary Guardian (Slot 1) *
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Full Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Ramesh Sharma"
                        value={linkForm.slot1.name}
                        onChange={(e) => setLinkForm({ ...linkForm, slot1: { ...linkForm.slot1, name: e.target.value } })}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Relationship</label>
                      <select
                        value={linkForm.slot1.relationship}
                        onChange={(e) => setLinkForm({ ...linkForm, slot1: { ...linkForm.slot1, relationship: e.target.value } })}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                      >
                        <option value="Father">Father</option>
                        <option value="Mother">Mother</option>
                        <option value="Guardian">Legal Guardian</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Phone Number</label>
                      <input
                        type="tel"
                        required
                        placeholder="10-digit mobile"
                        value={linkForm.slot1.phone}
                        onChange={(e) => setLinkForm({ ...linkForm, slot1: { ...linkForm.slot1, phone: e.target.value } })}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Personal Email</label>
                      <input
                        type="email"
                        required
                        placeholder="Personal email"
                        value={linkForm.slot1.email}
                        onChange={(e) => setLinkForm({ ...linkForm, slot1: { ...linkForm.slot1, email: e.target.value } })}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    id="hasSlot2"
                    checked={linkForm.hasSlot2}
                    onChange={(e) => setLinkForm({ ...linkForm, hasSlot2: e.target.checked })}
                  />
                  <label htmlFor="hasSlot2" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}>
                    Add Secondary Guardian (Slot 2)
                  </label>
                </div>

                {linkForm.hasSlot2 && (
                  <div style={{ padding: 12, background: 'var(--bg-page)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--text-primary)' }}>
                      Secondary Guardian (Slot 2)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Full Name</label>
                        <input
                          type="text"
                          required={linkForm.hasSlot2}
                          placeholder="e.g. Sunita Sharma"
                          value={linkForm.slot2.name}
                          onChange={(e) => setLinkForm({ ...linkForm, slot2: { ...linkForm.slot2, name: e.target.value } })}
                          style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Relationship</label>
                        <select
                          value={linkForm.slot2.relationship}
                          onChange={(e) => setLinkForm({ ...linkForm, slot2: { ...linkForm.slot2, relationship: e.target.value } })}
                          style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                        >
                          <option value="Mother">Mother</option>
                          <option value="Father">Father</option>
                          <option value="Guardian">Legal Guardian</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Phone Number</label>
                        <input
                          type="tel"
                          required={linkForm.hasSlot2}
                          placeholder="10-digit mobile"
                          value={linkForm.slot2.phone}
                          onChange={(e) => setLinkForm({ ...linkForm, slot2: { ...linkForm.slot2, phone: e.target.value } })}
                          style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Personal Email</label>
                        <input
                          type="email"
                          required={linkForm.hasSlot2}
                          placeholder="Personal email"
                          value={linkForm.slot2.email}
                          onChange={(e) => setLinkForm({ ...linkForm, slot2: { ...linkForm.slot2, email: e.target.value } })}
                          style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setLinkModalStudent(null)}
                    style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading === 'saving_link'}
                    style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {actionLoading === 'saving_link' ? 'Linking...' : 'Send Invitations & Link'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
