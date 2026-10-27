/**
 * Home Visits Page (Hostel Staff / Warden Command Centre)
 * Integrated with the Digital Parent Approval Module:
 * - Parent Approval panel showing guardians, digital decision status, IST timestamps, remarks, and decision source.
 * - Multi-criteria filters: Overall Status & Parent Approval Status.
 * - Staff Manual Phone Confirmation Override modal with fallback for unlinked guardians.
 * - Direct CSV export of approval audit records.
 */

import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdHome,
  MdRefresh,
  MdCheckCircle,
  MdCancel,
  MdPhone,
  MdPhoneInTalk,
  MdDownload,
  MdShield,
  MdExpandMore,
  MdExpandLess,
} from 'react-icons/md';
import StudentAvatar from '../components/StudentAvatar';
import { getHostelLabel } from '../utils/hostel';

const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'completed'];

const PARENT_STATUS_OPTIONS = [
  { value: 'all', label: 'All Parent Statuses' },
  { value: 'pending', label: 'Pending Parent Decision' },
  { value: 'parent_approved', label: 'Parent Approved' },
  { value: 'parent_rejected', label: 'Parent Rejected' },
  { value: 'parent_no_response', label: 'No Response (Expired)' },
  { value: 'legacy', label: 'Legacy Records' },
];

const maskPhone = (phone) => {
  if (!phone) return '—';
  const clean = String(phone).trim();
  if (clean.length < 7) return clean;
  return clean.slice(0, 5) + '*** **' + clean.slice(-3);
};

export default function HomeVisits() {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [parentFilter, setParentFilter] = useState('all');
  const [actioning, setActioning] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // Override Modal State
  const [overrideModal, setOverrideModal] = useState({
    isOpen: false,
    visit: null,
    guardianId: '',
    contactName: '',
    contactPhone: '',
    reason: '',
    submitting: false,
  });

  const fetchVisits = async () => {
    try {
      if (visits.length === 0) setLoading(true);
      else setIsRefreshing(true);

      const params = new URLSearchParams();
      if (filter !== 'all') params.append('status', filter);
      if (parentFilter !== 'all') params.append('parentApprovalStatus', parentFilter);

      const queryStr = params.toString() ? `?${params.toString()}` : '';
      const res = await api.get(`/homevisit/list${queryStr}`);
      setVisits(res.data.visits || []);
    } catch (err) {
      toast.error('Failed to fetch home visits');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchVisits();
  }, [filter, parentFilter]);

  const handleWardenAction = async (visitId, action) => {
    setActioning(visitId + action);
    try {
      await api.post('/homevisit/warden-approve', { visit_id: visitId, action });
      toast.success(`Visit ${action}d successfully`);
      fetchVisits();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action failed');
    } finally {
      setActioning(null);
    }
  };

  const handleOpenOverrideModal = (visit) => {
    const guardians = visit.guardians || [];
    const firstGuardian = guardians[0];

    setOverrideModal({
      isOpen: true,
      visit,
      guardianId: firstGuardian ? firstGuardian._id : '',
      contactName: firstGuardian ? firstGuardian.name : (visit.student_id?.name ? `Parent of ${visit.student_id.name}` : ''),
      contactPhone: firstGuardian ? firstGuardian.phone : (visit.parent_phone || visit.student_id?.parentPhone || ''),
      reason: '',
      submitting: false,
    });
  };

  const handleCloseOverrideModal = () => {
    if (!overrideModal.submitting) {
      setOverrideModal({ isOpen: false, visit: null, guardianId: '', contactName: '', contactPhone: '', reason: '', submitting: false });
    }
  };

  const handleSubmitOverride = async (e) => {
    e.preventDefault();
    if (!overrideModal.reason || overrideModal.reason.trim().length < 5) {
      return toast.error('A mandatory call note / reason (min 5 chars) is required.');
    }

    setOverrideModal((m) => ({ ...m, submitting: true }));
    try {
      const res = await api.post('/homevisit/staff-phone-override', {
        visit_id: overrideModal.visit._id,
        guardian_id: overrideModal.guardianId || undefined,
        contact_name: overrideModal.contactName.trim(),
        contact_phone: overrideModal.contactPhone.trim(),
        override_reason: overrideModal.reason.trim(),
      });

      toast.success(res.data?.message || 'Phone confirmation override applied!');
      handleCloseOverrideModal();
      fetchVisits();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to apply phone override');
      setOverrideModal((m) => ({ ...m, submitting: false }));
    }
  };

  const handleExportCSV = () => {
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
    const token = localStorage.getItem('token');
    window.open(`${backendUrl}/api/admin/guardians/export?token=${encodeURIComponent(token)}`, '_blank');
  };

  const handleResendEmail = async (visitId, currentEmail) => {
    let emailToSend = currentEmail;
    if (!emailToSend) {
      const inputEmail = window.prompt('Enter parent/guardian email address:');
      if (!inputEmail || !inputEmail.trim()) return;
      emailToSend = inputEmail.trim().toLowerCase();
    }
    setActioning(visitId + 'resend');
    try {
      const res = await api.post('/homevisit/resend-notification', { visit_id: visitId, parent_email: emailToSend });
      toast.success(res.data?.message || 'Notification resent successfully');
      fetchVisits();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resend notification');
    } finally {
      setActioning(null);
    }
  };

  const renderParentStatusBadge = (visit) => {
    const pStatus = visit.parent_approval_status;
    const pSource = visit.parent_decision_source;

    if (pStatus === 'legacy') {
      return <span className="badge badge-out" style={{ fontSize: 11 }}>Legacy Record</span>;
    }
    if (pStatus === 'parent_approved') {
      if (pSource === 'STAFF_PHONE_OVERRIDE') {
        return (
          <span className="badge badge-approved" style={{ fontSize: 11, background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.4)', color: '#38bdf8' }}>
            📞 Staff Override
          </span>
        );
      }
      return <span className="badge badge-approved" style={{ fontSize: 11 }}>✅ Parent Approved</span>;
    }
    if (pStatus === 'parent_rejected') {
      return <span className="badge badge-rejected" style={{ fontSize: 11 }}>❌ Parent Rejected</span>;
    }
    if (pStatus === 'parent_no_response') {
      return <span className="badge badge-rejected" style={{ fontSize: 11, background: 'rgba(239, 68, 68, 0.15)' }}>⌛ Expired (No Response)</span>;
    }
    if (visit.email_notification_status === 'FAILED') {
      return <span className="badge badge-rejected" style={{ fontSize: 11, background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5' }}>⚠️ Email Failed</span>;
    }
    return <span className="badge badge-pending" style={{ fontSize: 11 }}>⏳ Pending Parent Decision</span>;
  };

  const renderOverallStatusBadge = (v) => {
    if (v.overall_status === 'approved') {
      return <span className="badge badge-approved">Approved</span>;
    }
    if (v.overall_status === 'rejected') {
      if (v.parent_approval_status === 'parent_rejected') {
        return <span className="badge badge-rejected">Parent Rejected</span>;
      }
      return <span className="badge badge-rejected">Rejected</span>;
    }
    if (v.email_notification_status === 'FAILED') {
      return <span className="badge badge-rejected" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)' }}>Notification Failed</span>;
    }
    if (v.parent_approval_status === 'parent_approved' && v.warden_status === 'pending') {
      return (
        <span className="badge badge-pending" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', whiteSpace: 'nowrap' }}>
          Parent Approved — Awaiting Warden
        </span>
      );
    }
    if (v.parent_approval_status === 'pending') {
      return <span className="badge badge-pending" style={{ whiteSpace: 'nowrap' }}>Awaiting Parent Approval</span>;
    }
    return <span className={`badge badge-${v.overall_status}`}>{v.overall_status}</span>;
  };

  return (
    <div className="fade-in">
      <Navbar title="Home Visits" />
      <div className="page-area">
        <div className="section-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="section-title"><MdHome /> Home Visit Requests & Parent Approvals</div>
            <div className="section-subtitle">{visits.length} request(s) shown</div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={handleExportCSV} title="Export CSV of Parent Approvals">
              <MdDownload size={16} /> Export Approvals CSV
            </button>
            <button className="btn btn-ghost btn-sm" onClick={fetchVisits} disabled={loading && visits.length === 0}>
              <MdRefresh size={16} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} /> {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Filters Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div className="tabs" style={{ marginBottom: 0 }}>
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                className={`tab ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>

          <div>
            <select
              className="form-input"
              value={parentFilter}
              onChange={(e) => setParentFilter(e.target.value)}
              style={{ fontSize: 13, padding: '7px 12px', minWidth: 200, cursor: 'pointer' }}
            >
              {PARENT_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {(loading && visits.length === 0) ? (
          <div className="loading-page"><div className="loading-spinner" style={{ width: 40, height: 40 }} /></div>
        ) : visits.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 60 }}>🏠</div>
            <div style={{ fontWeight: 700, marginTop: 12 }}>No requests found</div>
            <p>No home visit requests match the current filters.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Hostel</th>
                  <th>Destination & Dates</th>
                  <th>Parent Approval Panel</th>
                  <th>Overall Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => {
                  const guardians = v.guardians || [];
                  const primaryApproval = approvals[0] || (v.parent_decision_remarks || v.parent_decision_at || v.parent_approval_status === 'parent_approved' ? {
                    decided_by_name: v.parent_name || 'Parent / Guardian',
                    decided_by_email: v.parent_email,
                    decided_at: v.parent_decision_at || v.parent_response_time,
                    remarks: v.parent_decision_remarks,
                  } : null);
                  const isExpanded = expandedId === v._id;

                  const canApprove =
                    v.parent_approval_status === 'legacy' ||
                    v.parent_approval_status === 'parent_approved' ||
                    Boolean(v.parent_call_confirmed);

                  return (
                    <tr key={v._id}>
                      {/* Student */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <StudentAvatar
                            student={v.student_id}
                            recordPhoto={v.student_photo}
                            name={v.student_id?.name || v.name}
                          />
                          <div>
                            <div style={{ fontWeight: 600 }}>{v.student_id?.name || v.name || 'Unknown'}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{v.student_id?.rollNo || v.rollNo || '—'}</div>
                          </div>
                        </div>
                      </td>

                      {/* Hostel */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span className="badge badge-out">{getHostelLabel(v.student_id?.hostel || v.hostel)}</span>
                          {(v.student_id?.roomNo || v.roomNo) && (
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                              Room {v.student_id?.roomNo || v.roomNo}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Destination & Dates */}
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#f3f4f6' }}>{v.place || 'Home'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                          {v.leave_date} → {v.return_date}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#9ca3af', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }} title={v.reason}>
                          {v.reason}
                        </div>
                      </td>

                      {/* Parent Approval Panel */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 190 }}>
                          {renderParentStatusBadge(v)}

                          {primaryApproval && (
                            <div style={{ fontSize: 11, color: '#93c5fd', marginTop: 2 }}>
                              Decided by: <strong>{primaryApproval.decided_by_name || primaryApproval.decided_by_email}</strong>
                              <br />
                              Time:{' '}
                              {new Date(primaryApproval.decided_at).toLocaleString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                hour: '2-digit',
                                minute: '2-digit',
                                day: '2-digit',
                                month: 'short',
                              })}
                              {primaryApproval.remarks && (
                                <div style={{ color: '#d1d5db', fontStyle: 'italic', marginTop: 2 }}>
                                  "{primaryApproval.remarks}"
                                </div>
                              )}
                            </div>
                          )}

                          {/* Quick Guardian Phone Info */}
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                            {guardians.length > 0 ? (
                              guardians.map((g, idx) => (
                                <div key={g._id || idx}>
                                  {g.relationship}: {maskPhone(g.phone)}
                                </div>
                              ))
                            ) : (
                              <div>Phone: {maskPhone(v.parent_phone || v.student_id?.parentPhone)}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Overall Status */}
                      <td>
                        {renderOverallStatusBadge(v)}
                      </td>

                      {/* Actions */}
                      <td>
                        {v.warden_status === 'pending' ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            {/* Resend Parent Email Button */}
                            {v.parent_approval_status === 'pending' && (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleResendEmail(v._id, v.parent_email)}
                                disabled={actioning === v._id + 'resend'}
                                title="Resend digital approval email to parent via Google Apps Script"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  color: '#fbbf24',
                                  background: 'rgba(251, 191, 36, 0.12)',
                                  border: '1px solid rgba(251, 191, 36, 0.3)',
                                  padding: '5px 8px',
                                  borderRadius: 6,
                                  fontSize: 11,
                                  fontWeight: 700,
                                }}
                              >
                                {actioning === v._id + 'resend' ? 'Sending…' : '✉️ Resend'}
                              </button>
                            )}

                            {/* Staff Phone Confirmation Override Button */}
                            {!canApprove && (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleOpenOverrideModal(v)}
                                title="Parent has not approved digitally. Open phone override confirmation modal."
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  color: '#38bdf8',
                                  background: 'rgba(56, 189, 248, 0.12)',
                                  border: '1px solid rgba(56, 189, 248, 0.3)',
                                  padding: '5px 8px',
                                  borderRadius: 6,
                                  fontSize: 11,
                                  fontWeight: 700,
                                }}
                              >
                                <MdPhone size={13} /> Override
                              </button>
                            )}

                            {/* Approve Button */}
                            <button
                              className="btn btn-success btn-sm"
                              onClick={() => handleWardenAction(v._id, 'approve')}
                              disabled={!canApprove || actioning === v._id + 'approve'}
                              title={canApprove ? 'Approve Home Visit' : 'Digital parent approval or staff phone override required before final approval'}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: canApprove ? 'pointer' : 'not-allowed',
                                opacity: canApprove ? 1 : 0.45,
                              }}
                            >
                              {actioning === v._id + 'approve' ? (
                                <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                              ) : (
                                <MdCheckCircle size={16} />
                              )}
                            </button>

                            {/* Reject Button */}
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleWardenAction(v._id, 'reject')}
                              disabled={actioning === v._id + 'reject'}
                              title="Reject Home Visit"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {actioning === v._id + 'reject' ? (
                                <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                              ) : (
                                <MdCancel size={16} />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            {v.overall_status === 'completed' ? '✅ Done' : (v.overall_status || '—')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Staff Phone Confirmation Override Modal */}
        {overrideModal.isOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 20,
          }}>
            <div style={{
              background: '#111827',
              border: '1.5px solid #38bdf8',
              borderRadius: 18,
              padding: 24,
              maxWidth: 480,
              width: '100%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            }} className="fade-in">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 28 }}>📞</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, color: '#ffffff' }}>Manual Phone Confirmation Override</h3>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>Hostel Staff Emergency Fallback</div>
                </div>
              </div>

              <p style={{ fontSize: 13, color: '#d1d5db', lineHeight: 1.5, marginBottom: 16 }}>
                Record verbal parent confirmation obtained via phone call for{' '}
                <strong>{overrideModal.visit?.student_id?.name || overrideModal.visit?.name}</strong>.
                This decision will be audited with your staff ID as <code>STAFF_PHONE_OVERRIDE</code>.
              </p>

              <form onSubmit={handleSubmitOverride}>
                {/* Guardian Selection if guardians exist */}
                {(overrideModal.visit?.guardians || []).length > 0 && (
                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <label className="form-label">Select Contacted Guardian</label>
                    <select
                      className="form-input"
                      value={overrideModal.guardianId}
                      onChange={(e) => {
                        const gId = e.target.value;
                        const g = (overrideModal.visit?.guardians || []).find((x) => x._id === gId);
                        setOverrideModal((m) => ({
                          ...m,
                          guardianId: gId,
                          contactName: g ? g.name : m.contactName,
                          contactPhone: g ? g.phone : m.contactPhone,
                        }));
                      }}
                    >
                      {overrideModal.visit.guardians.map((g) => (
                        <option key={g._id} value={g._id}>
                          {g.relationship}: {g.name} ({g.phone})
                        </option>
                      ))}
                      <option value="">Other / Manual Contact (Not in list)</option>
                    </select>
                  </div>
                )}

                {/* Free-text Contact Details (Supports unlinked students) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Contact Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Ramesh Sharma"
                      value={overrideModal.contactName}
                      onChange={(e) => setOverrideModal((m) => ({ ...m, contactName: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Contact Phone *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="+919876543210"
                      value={overrideModal.contactPhone}
                      onChange={(e) => setOverrideModal((m) => ({ ...m, contactPhone: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 18 }}>
                  <label className="form-label">Mandatory Call Note / Override Reason *</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="e.g. Spoke to father at 2:30 PM. Father confirmed leave dates and destination. Approved due to student medical checkup."
                    value={overrideModal.reason}
                    onChange={(e) => setOverrideModal((m) => ({ ...m, reason: e.target.value }))}
                    required
                    style={{ resize: 'vertical', fontSize: 13 }}
                  />
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                    Minimum 5 characters. Stored permanently in audit log.
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <button
                    type="button"
                    onClick={handleCloseOverrideModal}
                    disabled={overrideModal.submitting}
                    className="btn btn-ghost"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={overrideModal.submitting}
                    className="btn btn-primary"
                    style={{ fontWeight: 700 }}
                  >
                    {overrideModal.submitting ? <span className="loading-spinner" /> : 'Confirm Override'}
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
