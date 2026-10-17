/**
 * Parent Request Detail Page
 * Mobile-first page where parents review leave details and make their final decision (Approve or Reject).
 * Includes confirmation dialog, remarks input, and finalized read-only states.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdArrowBack, MdCheckCircle, MdCancel, MdLocationOn, MdDateRange, MdPerson, MdNotes, MdHistoryEdu } from 'react-icons/md';

export default function ParentRequestDetail() {
  const { requestId } = useParams();
  const navigate = useNavigate();

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Modal confirmation state
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    action: null, // 'APPROVED' | 'REJECTED'
  });

  const fetchRequest = async () => {
    try {
      const res = await api.get(`/parent/requests/${requestId}`);
      setRequest(res.data.request);
    } catch (err) {
      if (err.response?.status === 401) {
        // Redirect to parent login with return path
        navigate(`/parent/login?returnUrl=/parent/requests/${requestId}`);
      } else {
        toast.error(err.response?.data?.message || 'Failed to load request details');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequest();
  }, [requestId]);

  const handleOpenConfirm = (action) => {
    setConfirmModal({
      isOpen: true,
      action,
    });
  };

  const handleCloseConfirm = () => {
    if (!submitting) {
      setConfirmModal({ isOpen: false, action: null });
    }
  };

  const handleFinalSubmit = async () => {
    const action = confirmModal.action;
    if (!action) return;

    setSubmitting(true);
    try {
      const res = await api.post(`/parent/requests/${requestId}/decision`, {
        decision: action,
        remarks: remarks.trim(),
      });

      toast.success(res.data?.message || `Request ${action.toLowerCase()}d successfully`);
      setConfirmModal({ isOpen: false, action: null });
      fetchRequest();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit decision');
      setConfirmModal({ isOpen: false, action: null });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" style={{ width: 44, height: 44, marginBottom: 12 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading request details...</span>
      </div>
    );
  }

  if (!request) {
    return (
      <div style={{ padding: 30, textAlign: 'center', minHeight: '100vh', background: '#0b0f19', color: '#f3f4f6' }}>
        <h2>Request Not Found</h2>
        <p style={{ color: 'var(--text-muted)' }}>The requested leave application could not be found or access is restricted.</p>
        <Link to="/parent/dashboard" className="btn btn-primary" style={{ marginTop: 16 }}>
          Return to Dashboard
        </Link>
      </div>
    );
  }

  const student = request.student_id || {};
  const isPending = request.parent_approval_status === 'pending';
  const existingApprovals = request.approvals || [];
  const primaryApproval = existingApprovals[0] || null;

  const istCreatedAt = request.createdAt
    ? new Date(request.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
    : 'N/A';

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary, #0b0f19)',
      color: '#f3f4f6',
      paddingBottom: 50,
    }}>
      {/* Header */}
      <header style={{
        background: 'rgba(17, 24, 39, 0.95)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <button
          onClick={() => navigate('/parent/dashboard')}
          className="btn btn-ghost btn-sm"
          style={{ padding: '6px 8px', borderRadius: 8, display: 'flex', alignItems: 'center' }}
          title="Back to Dashboard"
        >
          <MdArrowBack size={20} />
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Home-Visit Leave Request</h1>
          <div style={{ fontSize: 11.5, color: '#9ca3af' }}>ID: {request._id}</div>
        </div>
      </header>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: '20px 16px' }}>
        {/* Status Alert Banner */}
        {!isPending && (
          <div style={{
            background: request.parent_approval_status === 'parent_approved'
              ? 'rgba(16, 185, 129, 0.12)'
              : 'rgba(239, 68, 68, 0.12)',
            border: `1.5px solid ${request.parent_approval_status === 'parent_approved' ? '#10b981' : '#ef4444'}`,
            borderRadius: 14,
            padding: '16px 18px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}>
            <span style={{ fontSize: 24 }}>
              {request.parent_approval_status === 'parent_approved' ? '✅' : '❌'}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: request.parent_approval_status === 'parent_approved' ? '#6ee7b7' : '#fca5a5' }}>
                {request.parent_approval_status === 'parent_approved'
                  ? (request.parent_decision_source === 'STAFF_PHONE_OVERRIDE'
                      ? 'Approved via Hostel Staff Phone Confirmation'
                      : 'Leave Request Approved')
                  : request.parent_approval_status === 'parent_no_response'
                    ? 'Request Expired (No Response)'
                    : 'Leave Request Rejected'}
              </div>
              {primaryApproval && (
                <div style={{ fontSize: 12.5, color: '#d1d5db', marginTop: 4, lineHeight: 1.4 }}>
                  Decided by <strong>{primaryApproval.decided_by_name || primaryApproval.decided_by_email}</strong> on{' '}
                  {new Date(primaryApproval.decided_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}
                  {primaryApproval.remarks && (
                    <div style={{ marginTop: 4, fontStyle: 'italic', color: '#93c5fd' }}>
                      Remarks: "{primaryApproval.remarks}"
                    </div>
                  )}
                </div>
              )}
              <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 6 }}>
                Note: Decisions are final and recorded permanently in the campus audit log.
              </div>
            </div>
          </div>
        )}

        {/* 1. Student Card */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 16,
          padding: '18px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 18,
        }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: '#1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            color: '#60a5fa',
            fontWeight: 800,
            overflow: 'hidden',
            flexShrink: 0,
            border: '2px solid rgba(59, 130, 246, 0.4)',
          }}>
            {student.studentPhoto || student.picture ? (
              <img
                src={student.studentPhoto || student.picture}
                alt={student.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              (student.name || 'S')[0]
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#ffffff' }}>
              {student.name || request.name}
            </h2>
            <div style={{ fontSize: 13, color: '#9ca3af' }}>
              Roll No: <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{student.rollNo || request.rollNo}</span>
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 2 }}>
              Hostel: <span style={{ color: '#e5e7eb' }}>{student.hostel || 'Assigned'}</span> • Room:{' '}
              <span style={{ color: '#e5e7eb' }}>{student.roomNo || 'N/A'}</span>
            </div>
            <div style={{ fontSize: 12, color: '#38bdf8', marginTop: 4, fontWeight: 500 }}>
              Completed Past Leaves: <strong>{request.previousLeaveCount || 0}</strong>
            </div>
          </div>
        </div>

        {/* 2. Request Details Card */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 16,
          padding: '20px',
          marginBottom: 20,
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, textTransform: 'uppercase', color: '#9ca3af', letterSpacing: 0.8 }}>
            Trip & Leave Details
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', fontSize: 12.5, marginBottom: 4 }}>
                <MdDateRange size={16} color="#60a5fa" />
                <span>Planned Departure Date</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', fontFamily: 'monospace' }}>
                {request.leave_date}
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', fontSize: 12.5, marginBottom: 4 }}>
                <MdDateRange size={16} color="#34d399" />
                <span>Planned Return Date</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', fontFamily: 'monospace' }}>
                {request.return_date}
              </div>
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', fontSize: 12.5, marginBottom: 4 }}>
                <MdLocationOn size={16} color="#f87171" />
                <span>Destination Place</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#f3f4f6' }}>
                {request.place || 'Home'}
              </div>
            </div>

            {request.accompanying && (
              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', fontSize: 12.5, marginBottom: 4 }}>
                  <MdPerson size={16} color="#c084fc" />
                  <span>Accompanying Person</span>
                </div>
                <div style={{ fontSize: 14, color: '#e5e7eb' }}>{request.accompanying}</div>
              </div>
            )}

            <div style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', fontSize: 12.5, marginBottom: 4 }}>
                <MdNotes size={16} color="#fbbf24" />
                <span>Reason for Home Visit</span>
              </div>
              <div style={{
                background: 'rgba(0,0,0,0.3)',
                padding: '12px 14px',
                borderRadius: 10,
                fontSize: 14,
                lineHeight: 1.5,
                color: '#e5e7eb',
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                {request.reason}
              </div>
            </div>

            <div style={{ gridColumn: 'span 2', fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Requested on: {istCreatedAt} (IST)
            </div>
          </div>
        </div>

        {/* 3. Decision Section (Only active when status is pending) */}
        {isPending && (
          <div style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1.5px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 16,
            padding: '22px 20px',
          }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
              Record Guardian Decision
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
              Please review the dates and destination above carefully before recording your decision.
            </p>

            <div className="form-group" style={{ marginBottom: 18 }}>
              <label className="form-label" style={{ fontWeight: 600 }}>
                Optional Remarks / Note (Max 500 characters)
              </label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="Add any instructions, travel conditions, or comments for hostel staff..."
                maxLength={500}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                style={{ resize: 'vertical', fontSize: 13.5 }}
              />
              <div style={{ textAlign: 'right', fontSize: 11.5, color: '#6b7280', marginTop: 4 }}>
                {remarks.length} / 500
              </div>
            </div>

            {/* Exactly Two Action Buttons Only */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <button
                type="button"
                onClick={() => handleOpenConfirm('APPROVED')}
                style={{
                  padding: '14px 16px',
                  borderRadius: 12,
                  border: '1.5px solid #10b981',
                  background: 'linear-gradient(135deg, #059669, #047857)',
                  color: '#ffffff',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 14px rgba(5, 150, 105, 0.35)',
                  transition: 'all 0.2s ease',
                }}
              >
                <MdCheckCircle size={20} /> Approve Leave
              </button>

              <button
                type="button"
                onClick={() => handleOpenConfirm('REJECTED')}
                style={{
                  padding: '14px 16px',
                  borderRadius: 12,
                  border: '1.5px solid #ef4444',
                  background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                  color: '#ffffff',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 14px rgba(220, 38, 38, 0.35)',
                  transition: 'all 0.2s ease',
                }}
              >
                <MdCancel size={20} /> Reject Leave
              </button>
            </div>
          </div>
        )}

        {/* Confirmation Modal */}
        {confirmModal.isOpen && (
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
              border: `1.5px solid ${confirmModal.action === 'APPROVED' ? '#10b981' : '#ef4444'}`,
              borderRadius: 18,
              padding: 24,
              maxWidth: 440,
              width: '100%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            }} className="fade-in">
              <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 10 }}>
                {confirmModal.action === 'APPROVED' ? '✅' : '❌'}
              </div>

              <h3 style={{ margin: '0 0 10px', fontSize: 18, textAlign: 'center', color: '#ffffff' }}>
                Confirm {confirmModal.action === 'APPROVED' ? 'Approval' : 'Rejection'}
              </h3>

              <p style={{ fontSize: 13.5, color: '#d1d5db', textAlign: 'center', lineHeight: 1.5, marginBottom: 18 }}>
                Are you sure you want to <strong>{confirmModal.action === 'APPROVED' ? 'APPROVE' : 'REJECT'}</strong>{' '}
                {student.name}'s leave from <strong>{request.leave_date}</strong> to <strong>{request.return_date}</strong>?
              </p>

              <div style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 12.5,
                color: '#fbbf24',
                marginBottom: 20,
                textAlign: 'center',
              }}>
                ⚠️ <strong>Note:</strong> Decisions are final and cannot be modified once submitted.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button
                  type="button"
                  onClick={handleCloseConfirm}
                  disabled={submitting}
                  className="btn btn-ghost"
                  style={{ padding: '12px', borderRadius: 10 }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleFinalSubmit}
                  disabled={submitting}
                  className={confirmModal.action === 'APPROVED' ? 'btn btn-success' : 'btn btn-danger'}
                  style={{ padding: '12px', borderRadius: 10, fontWeight: 700 }}
                >
                  {submitting ? <span className="loading-spinner" /> : `Yes, ${confirmModal.action}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
