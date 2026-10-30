/**
 * Home Visits Page (Hostel Staff / Warden Command Centre)
 * Integrated with the Digital Parent Approval Module & Warden Call-Gated Approval Flow:
 * - Parent Approval panel showing guardians with 📞 Call button (tel: link) and Copy button.
 * - Server logging of call-initiated events with honest wording ("Call initiated by <warden> at <IST>").
 * - Multi-criteria filters: Waiting for parent, Waiting for warden call, Ready for warden approval, etc.
 * - Warden Approval confirmation modal with mandatory "Which parent did you speak to?" selection & optional note.
 * - Warden Rejection modal with mandatory reason (min 5 chars).
 * - Staff Manual Phone Confirmation Override modal for recording verbal decisions.
 * - Direct CSV export of approval audit records with warden call & decision columns.
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
  MdContentCopy,
  MdDownload,
  MdShield,
  MdExpandMore,
  MdExpandLess,
  MdInfoOutline,
} from 'react-icons/md';
import StudentAvatar from '../components/StudentAvatar';
import { getHostelLabel } from '../utils/hostel';

const STATUS_FILTERS = [
  { value: 'all', label: 'All Requests' },
  { value: 'waiting_parent', label: 'Waiting for parent' },
  { value: 'waiting_call', label: 'Waiting for warden call' },
  { value: 'ready_approval', label: 'Ready for warden approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
];

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

const formatIst = (rawDate) => {
  if (!rawDate) return '';
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const getApproveTooltip = (visit) => {
  if (visit.canWardenApprove) return 'Approve Home Visit';
  switch (visit.blockedReason) {
    case 'CALL_REQUIRED':
      return 'Call a parent first before approving';
    case 'PARENT_PENDING':
      return 'Waiting for parent decision or verbal phone override';
    case 'PARENT_REJECTED':
      return 'Parent rejected this request';
    case 'EXPIRED':
      return 'This request has expired and cannot be approved';
    case 'ALREADY_DECIDED':
      return 'This request has already received a final decision';
    default:
      return 'Prerequisites not met for approval';
  }
};

export default function HomeVisits() {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [parentFilter, setParentFilter] = useState('all');
  const [actioning, setActioning] = useState(null);

  // Approve Modal State
  const [approveModal, setApproveModal] = useState({
    isOpen: false,
    visit: null,
    spokeWithGuardianId: '',
    note: '',
    submitting: false,
  });

  // Reject Modal State
  const [rejectModal, setRejectModal] = useState({
    isOpen: false,
    visit: null,
    reason: '',
    submitting: false,
  });

  // Verbal Override Modal State
  const [overrideModal, setOverrideModal] = useState({
    isOpen: false,
    visit: null,
    guardianId: '',
    contactName: '',
    contactPhone: '',
    decision: 'APPROVED',
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

  // Initiate call to guardian & log event asynchronously without blocking browser dialer
  const handleInitiateCall = (visitId, guardian, fallbackPhone) => {
    const postCallLog = async (retryCount = 0) => {
      try {
        await api.post(`/homevisit/${visitId}/call-initiated`, {
          guardianId: guardian?._id || undefined,
          slot: guardian?.guardian_slot || 1,
        });
        fetchVisits();
      } catch (err) {
        if (retryCount < 1) {
          setTimeout(() => postCallLog(retryCount + 1), 1000);
        } else {
          toast.error('Failed to record call event: ' + (err.response?.data?.message || err.message));
        }
      }
    };
    postCallLog();
  };

  const handleCopyPhone = (e, phone, label) => {
    e.stopPropagation();
    e.preventDefault();
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    toast.success(`${label || 'Phone number'} copied!`);
  };

  // Open Approve Modal
  const handleOpenApproveModal = (visit) => {
    const guardians = visit.guardians || [];
    const defaultSpokeId = guardians[0]?._id ? String(guardians[0]._id) : (guardians[0] ? 'guardian_0' : 'primary_parent');
    setApproveModal({
      isOpen: true,
      visit,
      spokeWithGuardianId: defaultSpokeId,
      note: '',
      submitting: false,
    });
  };

  const handleCloseApproveModal = () => {
    if (!approveModal.submitting) {
      setApproveModal({ isOpen: false, visit: null, spokeWithGuardianId: '', note: '', submitting: false });
    }
  };

  const handleSubmitApprove = async (e) => {
    e.preventDefault();
    if (!approveModal.spokeWithGuardianId) {
      return toast.error('Please specify which parent or guardian you spoke with.');
    }
    setApproveModal((m) => ({ ...m, submitting: true }));
    setActioning(approveModal.visit._id + 'approve');
    try {
      const res = await api.post('/homevisit/warden-approve', {
        visit_id: approveModal.visit._id,
        action: 'approve',
        spokeWithGuardianId: approveModal.spokeWithGuardianId,
        note: approveModal.note.trim(),
      });
      toast.success(res.data?.message || 'Home visit approved! QR pass generated.');
      handleCloseApproveModal();
      fetchVisits();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Approval failed');
      setApproveModal((m) => ({ ...m, submitting: false }));
    } finally {
      setActioning(null);
    }
  };

  // Open Reject Modal
  const handleOpenRejectModal = (visit) => {
    setRejectModal({
      isOpen: true,
      visit,
      reason: '',
      submitting: false,
    });
  };

  const handleCloseRejectModal = () => {
    if (!rejectModal.submitting) {
      setRejectModal({ isOpen: false, visit: null, reason: '', submitting: false });
    }
  };

  const handleSubmitReject = async (e) => {
    e.preventDefault();
    if (!rejectModal.reason || rejectModal.reason.trim().length < 5) {
      return toast.error('A rejection reason of at least 5 characters is required.');
    }
    setRejectModal((m) => ({ ...m, submitting: true }));
    setActioning(rejectModal.visit._id + 'reject');
    try {
      const res = await api.post('/homevisit/warden-approve', {
        visit_id: rejectModal.visit._id,
        action: 'reject',
        reason: rejectModal.reason.trim(),
      });
      toast.success(res.data?.message || 'Home visit request rejected.');
      handleCloseRejectModal();
      fetchVisits();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Rejection failed');
      setRejectModal((m) => ({ ...m, submitting: false }));
    } finally {
      setActioning(null);
    }
  };

  // Open Override Modal
  const handleOpenOverrideModal = (visit) => {
    const guardians = visit.guardians || [];
    const firstGuardian = guardians[0];
    setOverrideModal({
      isOpen: true,
      visit,
      guardianId: firstGuardian ? firstGuardian._id : '',
      contactName: firstGuardian ? firstGuardian.name : (visit.student_id?.name ? `Parent of ${visit.student_id.name}` : ''),
      contactPhone: firstGuardian ? firstGuardian.phone : (visit.parent_phone || visit.student_id?.parentPhone || ''),
      decision: 'APPROVED',
      reason: '',
      submitting: false,
    });
  };

  const handleCloseOverrideModal = () => {
    if (!overrideModal.submitting) {
      setOverrideModal({ isOpen: false, visit: null, guardianId: '', contactName: '', contactPhone: '', decision: 'APPROVED', reason: '', submitting: false });
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
        decision: overrideModal.decision,
        override_reason: overrideModal.reason.trim(),
      });

      toast.success(res.data?.message || 'Phone confirmation recorded!');
      handleCloseOverrideModal();
      fetchVisits();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record phone decision');
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
      if (res.data?.success) {
        toast.success(res.data?.message || 'Approval email resent to parent successfully');
      } else {
        toast.error(res.data?.message || 'Failed to dispatch email');
      }
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
          <span className="badge badge-approved" style={{ fontSize: 11.5, fontWeight: 700, background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.4)', color: '#0284c7' }}>
            📞 Staff Override
          </span>
        );
      }
      return <span className="badge badge-approved" style={{ fontSize: 11.5, fontWeight: 700, background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#059669' }}>✅ Parent Approved</span>;
    }
    if (pStatus === 'parent_rejected') {
      return <span className="badge badge-rejected" style={{ fontSize: 11.5, fontWeight: 700, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#dc2626' }}>❌ Parent Rejected</span>;
    }
    if (pStatus === 'parent_no_response') {
      return <span className="badge badge-rejected" style={{ fontSize: 11.5, fontWeight: 700, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#dc2626' }}>⌛ Expired (No Response)</span>;
    }
    if (visit.email_notification_status === 'FAILED') {
      return <span className="badge badge-rejected" style={{ fontSize: 11.5, fontWeight: 700, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#dc2626' }}>⚠️ Email Failed</span>;
    }
    return <span className="badge badge-pending" style={{ fontSize: 11.5, fontWeight: 700, background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#d97706' }}>⏳ Pending Parent Decision</span>;
  };

  const renderOverallStatusBadge = (v) => {
    if (v.overall_status === 'approved') {
      return <span className="badge badge-approved" style={{ fontWeight: 700, background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#059669' }}>Approved</span>;
    }
    if (v.overall_status === 'rejected') {
      return (
        <span className="badge badge-rejected" style={{ fontWeight: 700, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#dc2626' }}>
          {v.parent_approval_status === 'parent_rejected' ? 'Parent Rejected' : 'Rejected'}
        </span>
      );
    }
    if (v.overall_status === 'completed') {
      return <span className="badge badge-out" style={{ fontWeight: 700 }}>Completed</span>;
    }
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (
      v.overall_status === 'parent_no_response' ||
      v.parent_approval_status === 'parent_no_response' ||
      (v.return_date && v.return_date < today)
    ) {
      return (
        <span className="badge badge-rejected" style={{ fontWeight: 700, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#dc2626' }}>
          Expired
        </span>
      );
    }
    if (v.overall_status === 'pending') {
      if (v.parent_approval_status === 'pending') {
        return (
          <span className="badge badge-pending" style={{ fontWeight: 700, background: 'rgba(245, 158, 11, 0.15)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.4)', whiteSpace: 'nowrap' }}>
            Waiting for parent
          </span>
        );
      }
      if (v.parent_approval_status === 'parent_approved') {
        if (!v.warden_call_logged) {
          return (
            <span className="badge badge-pending" style={{ fontWeight: 700, background: 'rgba(56, 189, 248, 0.15)', color: '#0284c7', border: '1px solid rgba(56, 189, 248, 0.4)', whiteSpace: 'nowrap' }}>
              Waiting for warden call
            </span>
          );
        }
        return (
          <span className="badge badge-approved" style={{ fontWeight: 700, background: 'rgba(16, 185, 129, 0.15)', color: '#059669', border: '1px solid rgba(16, 185, 129, 0.4)', whiteSpace: 'nowrap' }}>
            Ready for warden approval
          </span>
        );
      }
    }
    return <span className={`badge badge-${v.overall_status}`} style={{ fontWeight: 700 }}>{v.overall_status?.toUpperCase()}</span>;
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
          <div className="tabs" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                className={`tab ${filter === f.value ? 'active' : ''}`}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
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
                  const approvals = v.parentApprovals || [];
                  const primaryApproval = approvals[0] || (v.parent_decision_remarks || v.parent_decision_at || v.parent_approval_status === 'parent_approved' ? {
                    decided_by_name: v.parent_name || 'Parent / Guardian',
                    decided_by_email: v.parent_email,
                    decided_at: v.parent_decision_at || v.parent_response_time,
                    remarks: v.parent_decision_remarks,
                  } : null);

                  const getDecisionTimeStr = () => {
                    const raw = primaryApproval?.decided_at || v.parent_decision_at || v.parent_response_time || v.updatedAt || v.createdAt;
                    if (!raw) return 'Recorded';
                    const d = new Date(raw);
                    if (isNaN(d.getTime())) return 'Recorded';
                    return formatIst(d);
                  };

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
                            <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary, #0f172a)' }}>{v.student_id?.name || v.name || 'Unknown'}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary, #334155)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{v.student_id?.rollNo || v.rollNo || '—'}</div>
                          </div>
                        </div>
                      </td>

                      {/* Hostel */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span className="badge badge-out">{getHostelLabel(v.student_id?.hostel || v.hostel)}</span>
                          {(v.student_id?.roomNo || v.roomNo) && (
                            <span style={{ fontSize: 12, color: 'var(--text-primary, #0f172a)', fontWeight: 700 }}>
                              Room {v.student_id?.roomNo || v.roomNo}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Destination & Dates */}
                      <td>
                        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary, #0f172a)' }}>{v.place || 'Home'}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--text-primary, #0f172a)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, marginTop: 3 }}>
                          📅 {v.leave_date} → {v.return_date}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary, #334155)', fontWeight: 600, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 }} title={v.reason}>
                          📝 {v.reason || 'Going Home'}
                        </div>
                      </td>

                      {/* Parent Approval Panel */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 }}>
                          {renderParentStatusBadge(v)}

                          {primaryApproval && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary, #334155)', fontWeight: 600, marginTop: 3, lineHeight: 1.4 }}>
                              <div>
                                Decided by: <strong style={{ color: 'var(--text-primary, #0f172a)', fontWeight: 800 }}>{primaryApproval.decided_by_name || primaryApproval.decided_by_email || 'Parent / Guardian'}</strong>
                              </div>
                              <div>
                                Time:{' '}
                                <span style={{ color: 'var(--text-primary, #0f172a)', fontWeight: 700 }}>
                                  {getDecisionTimeStr()}
                                </span>
                              </div>
                              {primaryApproval.remarks && (
                                <div style={{ color: 'var(--text-primary, #0f172a)', fontStyle: 'italic', marginTop: 2, fontWeight: 500 }}>
                                  "{primaryApproval.remarks}"
                                </div>
                              )}
                            </div>
                          )}

                          {/* Quick Guardian Phone Info with Call and Copy buttons */}
                          <div style={{ fontSize: 11.5, color: 'var(--text-secondary, #334155)', fontWeight: 600, marginTop: 4 }}>
                            {guardians.length > 0 ? (
                              guardians.map((g, idx) => {
                                const gCalls = (v.callLogs || []).filter(
                                  (c) => (g._id && String(c.guardian_id) === String(g._id)) || (g.phone && c.phone_called === g.phone)
                                );
                                const lastCall = gCalls[gCalls.length - 1];
                                return (
                                  <div key={g._id || idx} style={{ marginBottom: 6 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      <span>{g.relationship}: <strong style={{ color: 'var(--text-primary, #0f172a)', fontWeight: 700 }}>{maskPhone(g.phone)}</strong></span>
                                      {g.phone && (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                          <a
                                            href={`tel:${g.phone}`}
                                            onClick={() => handleInitiateCall(v._id, g, g.phone)}
                                            className="btn btn-ghost btn-xs"
                                            title={`Dial ${g.relationship} (${g.phone})`}
                                            style={{
                                              padding: '2px 6px',
                                              fontSize: 11,
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 3,
                                              color: '#38bdf8',
                                              background: 'rgba(56, 189, 248, 0.12)',
                                              borderRadius: 4,
                                              textDecoration: 'none',
                                              fontWeight: 700,
                                            }}
                                          >
                                            <MdPhone size={12} /> Call
                                          </a>
                                          <button
                                            type="button"
                                            onClick={(e) => handleCopyPhone(e, g.phone, `${g.relationship}'s phone`)}
                                            className="btn btn-ghost btn-xs"
                                            title="Copy full phone number"
                                            style={{
                                              padding: '2px 5px',
                                              fontSize: 11,
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              color: 'var(--text-secondary, #64748b)',
                                              background: 'rgba(255, 255, 255, 0.06)',
                                              borderRadius: 4,
                                            }}
                                          >
                                            <MdContentCopy size={11} />
                                          </button>
                                        </span>
                                      )}
                                    </div>
                                    {lastCall && (
                                      <div style={{ fontSize: 10.5, color: '#38bdf8', marginTop: 2, fontWeight: 600 }}>
                                        📞 Call initiated by {lastCall.warden_name || 'Staff'} at {formatIst(lastCall.initiated_at)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              (() => {
                                const fallbackPhone = v.parent_phone || v.student_id?.parentPhone;
                                const gCalls = (v.callLogs || []).filter(
                                  (c) => (fallbackPhone && c.phone_called === fallbackPhone) || !c.guardian_id
                                );
                                const lastCall = gCalls[gCalls.length - 1];
                                return (
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      <span>Phone: <strong style={{ color: 'var(--text-primary, #0f172a)', fontWeight: 700 }}>{maskPhone(fallbackPhone)}</strong></span>
                                      {fallbackPhone && (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                          <a
                                            href={`tel:${fallbackPhone}`}
                                            onClick={() => handleInitiateCall(v._id, null, fallbackPhone)}
                                            className="btn btn-ghost btn-xs"
                                            title={`Dial Parent (${fallbackPhone})`}
                                            style={{
                                              padding: '2px 6px',
                                              fontSize: 11,
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 3,
                                              color: '#38bdf8',
                                              background: 'rgba(56, 189, 248, 0.12)',
                                              borderRadius: 4,
                                              textDecoration: 'none',
                                              fontWeight: 700,
                                            }}
                                          >
                                            <MdPhone size={12} /> Call
                                          </a>
                                          <button
                                            type="button"
                                            onClick={(e) => handleCopyPhone(e, fallbackPhone, 'Parent phone')}
                                            className="btn btn-ghost btn-xs"
                                            title="Copy full phone number"
                                            style={{
                                              padding: '2px 5px',
                                              fontSize: 11,
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              color: 'var(--text-secondary, #64748b)',
                                              background: 'rgba(255, 255, 255, 0.06)',
                                              borderRadius: 4,
                                            }}
                                          >
                                            <MdContentCopy size={11} />
                                          </button>
                                        </span>
                                      )}
                                    </div>
                                    {lastCall && (
                                      <div style={{ fontSize: 10.5, color: '#38bdf8', marginTop: 2, fontWeight: 600 }}>
                                        📞 Call initiated by {lastCall.warden_name || 'Staff'} at {formatIst(lastCall.initiated_at)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()
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
                        {(() => {
                          const isFinished =
                            v.overall_status === 'approved' ||
                            v.overall_status === 'rejected' ||
                            v.overall_status === 'completed' ||
                            v.overall_status === 'parent_no_response' ||
                            v.warden_decision === 'approved' ||
                            v.warden_decision === 'rejected';

                          if (isFinished) {
                            return (
                              <span style={{ color: 'var(--text-secondary, #334155)', fontSize: 12.5, fontWeight: 700, textTransform: 'capitalize' }}>
                                {v.overall_status === 'completed'
                                  ? '✅ Completed'
                                  : v.overall_status === 'approved'
                                  ? '✅ Approved'
                                  : v.overall_status === 'rejected'
                                  ? '❌ Rejected'
                                  : (v.overall_status || '—').replace(/_/g, ' ')}
                              </span>
                            );
                          }

                          return (
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

                              {/* For parent-pending requests where a call has been logged: show the "Record parent's verbal decision" action */}
                              {v.parent_approval_status === 'pending' && v.warden_call_logged && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => handleOpenOverrideModal(v)}
                                  title="Record parent's verbal decision via phone"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    color: '#38bdf8',
                                    background: 'rgba(56, 189, 248, 0.14)',
                                    border: '1px solid rgba(56, 189, 248, 0.4)',
                                    padding: '5px 8px',
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 700,
                                  }}
                                >
                                  <MdPhoneInTalk size={13} /> Record Decision
                                </button>
                              )}

                              {/* Approve Button */}
                              <button
                                className="btn btn-success btn-sm"
                                onClick={() => handleOpenApproveModal(v)}
                                disabled={!v.canWardenApprove || actioning === v._id + 'approve'}
                                title={getApproveTooltip(v)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  justifyContent: 'center',
                                  cursor: v.canWardenApprove ? 'pointer' : 'not-allowed',
                                  opacity: v.canWardenApprove ? 1 : 0.45,
                                  fontWeight: 700,
                                  fontSize: 12,
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                }}
                              >
                                {actioning === v._id + 'approve' ? (
                                  <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                                ) : (
                                  <>
                                    <MdCheckCircle size={15} /> Approve
                                  </>
                                )}
                              </button>

                              {/* Reject Button */}
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => handleOpenRejectModal(v)}
                                disabled={actioning === v._id + 'reject'}
                                title="Reject Home Visit (reason required)"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  justifyContent: 'center',
                                  fontWeight: 700,
                                  fontSize: 12,
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                }}
                              >
                                {actioning === v._id + 'reject' ? (
                                  <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                                ) : (
                                  <>
                                    <MdCancel size={15} /> Reject
                                  </>
                                )}
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Warden Approval Modal */}
        {approveModal.isOpen && (
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
              border: '1.5px solid #10b981',
              borderRadius: 18,
              padding: 24,
              maxWidth: 480,
              width: '100%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            }} className="fade-in">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 28 }}>✅</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, color: '#ffffff' }}>Confirm Final Warden Approval</h3>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Student: <strong>{approveModal.visit?.student_id?.name || approveModal.visit?.name}</strong>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 13, color: '#d1d5db', lineHeight: 1.5, marginBottom: 16 }}>
                Approving this request will immediately generate the official Gate Pass QR code for the student and activate campus gate exit.
              </p>

              <form onSubmit={handleSubmitApprove}>
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Which parent did you speak to? *</label>
                  <select
                    className="form-input"
                    value={approveModal.spokeWithGuardianId}
                    onChange={(e) => setApproveModal((m) => ({ ...m, spokeWithGuardianId: e.target.value }))}
                    required
                  >
                    {(approveModal.visit?.guardians || []).map((g) => (
                      <option key={g._id} value={g._id}>
                        {g.relationship}: {g.name} ({g.phone})
                      </option>
                    ))}
                    {(!approveModal.visit?.guardians || approveModal.visit.guardians.length === 0) && (
                      <option value="primary_parent">
                        Parent / Guardian ({approveModal.visit?.parent_phone || approveModal.visit?.student_id?.parentPhone || 'On File'})
                      </option>
                    )}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 18 }}>
                  <label className="form-label">Optional Warden Note / Remarks</label>
                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder="e.g. Spoke to father, leave approved for family function."
                    value={approveModal.note}
                    onChange={(e) => setApproveModal((m) => ({ ...m, note: e.target.value }))}
                    style={{ resize: 'vertical', fontSize: 13 }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <button
                    type="button"
                    onClick={handleCloseApproveModal}
                    disabled={approveModal.submitting}
                    className="btn btn-ghost"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={approveModal.submitting}
                    className="btn btn-success"
                    style={{ fontWeight: 700 }}
                  >
                    {approveModal.submitting ? <span className="loading-spinner" /> : 'Confirm Approval'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Warden Rejection Modal */}
        {rejectModal.isOpen && (
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
              border: '1.5px solid #ef4444',
              borderRadius: 18,
              padding: 24,
              maxWidth: 480,
              width: '100%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            }} className="fade-in">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 28 }}>❌</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, color: '#ffffff' }}>Reject Home Visit Request</h3>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Student: <strong>{rejectModal.visit?.student_id?.name || rejectModal.visit?.name}</strong>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 13, color: '#d1d5db', lineHeight: 1.5, marginBottom: 16 }}>
                Rejected requests will not receive a QR gate pass. The student will be notified along with your mandatory reason.
              </p>

              <form onSubmit={handleSubmitReject}>
                <div className="form-group" style={{ marginBottom: 18 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Mandatory Rejection Reason *</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="Enter reason for rejecting this leave request (min 5 characters)..."
                    value={rejectModal.reason}
                    onChange={(e) => setRejectModal((m) => ({ ...m, reason: e.target.value }))}
                    required
                    style={{ resize: 'vertical', fontSize: 13 }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    Minimum 5 characters. This reason will be visible to the student.
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <button
                    type="button"
                    onClick={handleCloseRejectModal}
                    disabled={rejectModal.submitting}
                    className="btn btn-ghost"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={rejectModal.submitting}
                    className="btn btn-danger"
                    style={{ fontWeight: 700 }}
                  >
                    {rejectModal.submitting ? <span className="loading-spinner" /> : 'Confirm Rejection'}
                  </button>
                </div>
              </form>
            </div>
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
                  <h3 style={{ margin: 0, fontSize: 17, color: '#ffffff' }}>Record Parent's Verbal Decision</h3>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Hostel Staff Phone Override</div>
                </div>
              </div>

              <p style={{ fontSize: 13, color: '#d1d5db', lineHeight: 1.5, marginBottom: 16 }}>
                Record verbal parent decision obtained via phone call for{' '}
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

                {/* Verbal Decision Choice */}
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="form-label">Verbal Decision Obtained *</label>
                  <select
                    className="form-input"
                    value={overrideModal.decision}
                    onChange={(e) => setOverrideModal((m) => ({ ...m, decision: e.target.value }))}
                  >
                    <option value="APPROVED">Parent Approved (Permit leave)</option>
                    <option value="REJECTED">Parent Rejected (Do NOT permit leave)</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 18 }}>
                  <label className="form-label">Mandatory Call Note / Override Reason *</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="e.g. Spoke to father at 2:30 PM. Father confirmed leave dates and destination."
                    value={overrideModal.reason}
                    onChange={(e) => setOverrideModal((m) => ({ ...m, reason: e.target.value }))}
                    required
                    style={{ resize: 'vertical', fontSize: 13 }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
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
                    {overrideModal.submitting ? <span className="loading-spinner" /> : 'Confirm Verbal Decision'}
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
