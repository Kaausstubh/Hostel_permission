/**
 * Parent Request Detail Page
 * Mobile-first page where parents review leave details and make their final decision (Approve or Reject).
 * Includes confirmation dialog, remarks input, and finalized read-only states.
 * Supports Light Mode (Default) and Dark Mode.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useTheme } from '../context/ThemeContext';
import {
  MdArrowBack,
  MdCheckCircle,
  MdCancel,
  MdLocationOn,
  MdDateRange,
  MdPerson,
  MdNotes,
  MdHistoryEdu,
  MdWbSunny,
  MdNightlight,
} from 'react-icons/md';

export default function ParentRequestDetail() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { setTheme: setGlobalTheme } = useTheme() || {};

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('parent_theme') || 'light';
  });

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sync active theme with document data-theme attribute on mount and change
  useEffect(() => {
    const active = localStorage.getItem('parent_theme') || 'light';
    setTheme(active);
    document.documentElement.setAttribute('data-theme', active);
    if (setGlobalTheme) setGlobalTheme(active);
  }, [setGlobalTheme]);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('parent_theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    if (setGlobalTheme) setGlobalTheme(nextTheme);
  };

  const isDark = theme === 'dark';

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

  // Theme design tokens
  const t = {
    pageBg: isDark ? '#0b0f19' : '#f8fafc',
    pageText: isDark ? '#f3f4f6' : '#0f172a',

    headerBg: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.92)',
    headerBorder: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
    headerTitle: isDark ? '#f9fafb' : '#0f172a',
    headerSub: isDark ? '#9ca3af' : '#64748b',

    themeBtnBg: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.05)',
    themeBtnBorder: isDark ? 'rgba(255, 255, 255, 0.14)' : '#cbd5e1',
    themeBtnText: isDark ? '#f3f4f6' : '#1e293b',

    cardBg: isDark ? 'rgba(255, 255, 255, 0.04)' : '#ffffff',
    cardBorder: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
    cardShadow: isDark ? 'none' : '0 2px 10px rgba(15, 23, 42, 0.04)',

    cardTitle: isDark ? '#9ca3af' : '#475569',
    cardHeading: isDark ? '#ffffff' : '#0f172a',
    cardLabel: isDark ? '#9ca3af' : '#64748b',
    cardValue: isDark ? '#f3f4f6' : '#0f172a',

    reasonBoxBg: isDark ? 'rgba(0, 0, 0, 0.3)' : '#f8fafc',
    reasonBoxBorder: isDark ? 'rgba(255, 255, 255, 0.06)' : '#e2e8f0',
    reasonBoxText: isDark ? '#e5e7eb' : '#1e293b',

    decisionCardBg: isDark ? 'rgba(255, 255, 255, 0.05)' : '#ffffff',
    decisionCardBorder: isDark ? '1.5px solid rgba(59, 130, 246, 0.35)' : '1.5px solid #bfdbfe',
    decisionTitle: isDark ? '#ffffff' : '#1e3a8a',
    decisionSub: isDark ? '#9ca3af' : '#475569',

    textareaBg: isDark ? 'rgba(0, 0, 0, 0.25)' : '#ffffff',
    textareaBorder: isDark ? 'rgba(255, 255, 255, 0.12)' : '#cbd5e1',
    textareaColor: isDark ? '#f3f4f6' : '#0f172a',

    modalBg: isDark ? '#111827' : '#ffffff',
    modalBorder: isDark ? 'rgba(255, 255, 255, 0.1)' : '#cbd5e1',
    modalTitle: isDark ? '#ffffff' : '#0f172a',
    modalText: isDark ? '#d1d5db' : '#334155',
  };

  if (loading) {
    return (
      <div
        className="loading-page"
        style={{
          minHeight: '100vh',
          background: t.pageBg,
          color: t.pageText,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="loading-spinner" style={{ width: 44, height: 44, marginBottom: 12 }} />
        <span style={{ color: t.headerSub, fontSize: 14 }}>Loading request details...</span>
      </div>
    );
  }

  if (!request) {
    return (
      <div
        style={{
          padding: 30,
          textAlign: 'center',
          minHeight: '100vh',
          background: t.pageBg,
          color: t.pageText,
        }}
      >
        <h2>Request Not Found</h2>
        <p style={{ color: t.headerSub }}>
          The requested leave application could not be found or access is restricted.
        </p>
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
    ? new Date(request.createdAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'N/A';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: t.pageBg,
        color: t.pageText,
        paddingBottom: 50,
        transition: 'background-color 0.25s ease, color 0.25s ease',
      }}
    >
      {/* Header */}
      <header
        style={{
          background: t.headerBg,
          borderBottom: `1px solid ${t.headerBorder}`,
          backdropFilter: 'blur(12px)',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          transition: 'all 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate('/parent/dashboard')}
            className="btn btn-ghost btn-sm"
            style={{
              padding: '6px 8px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              border: `1px solid ${t.themeBtnBorder}`,
              color: t.themeBtnText,
            }}
            title="Back to Dashboard"
          >
            <MdArrowBack size={20} />
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.headerTitle }}>
              Home-Visit Leave Request
            </h1>
            <div style={{ fontSize: 11.5, color: t.headerSub }}>ID: {request._id}</div>
          </div>
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="btn btn-ghost btn-sm"
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 20,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: t.themeBtnBg,
            border: `1px solid ${t.themeBtnBorder}`,
            color: t.themeBtnText,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          title={isDark ? 'Switch to Light Mode (Default)' : 'Switch to Dark Mode'}
          aria-label="Toggle Light/Dark Theme"
        >
          {isDark ? (
            <>
              <MdWbSunny size={16} color="#fbbf24" style={{ filter: 'drop-shadow(0 0 4px rgba(251,191,36,0.6))' }} />
              <span>Light Mode</span>
            </>
          ) : (
            <>
              <MdNightlight size={16} color="#6366f1" />
              <span>Dark Mode</span>
            </>
          )}
        </button>
      </header>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px' }}>
        {/* Status Alert Banner */}
        {!isPending && (
          <div
            style={{
              background:
                request.parent_approval_status === 'parent_approved'
                  ? isDark
                    ? 'rgba(16, 185, 129, 0.12)'
                    : '#ecfdf5'
                  : isDark
                  ? 'rgba(239, 68, 68, 0.12)'
                  : '#fef2f2',
              border: `1.5px solid ${
                request.parent_approval_status === 'parent_approved' ? '#10b981' : '#ef4444'
              }`,
              borderRadius: 14,
              padding: '16px 18px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 24 }}>
              {request.parent_approval_status === 'parent_approved' ? '✅' : '❌'}
            </span>
            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  color:
                    request.parent_approval_status === 'parent_approved'
                      ? isDark
                        ? '#6ee7b7'
                        : '#065f46'
                      : isDark
                      ? '#fca5a5'
                      : '#991b1b',
                }}
              >
                {request.parent_approval_status === 'parent_approved'
                  ? request.parent_decision_source === 'STAFF_PHONE_OVERRIDE'
                    ? 'Approved via Hostel Staff Phone Confirmation'
                    : 'Leave Request Approved'
                  : request.parent_approval_status === 'parent_no_response'
                  ? 'Request Expired (No Response)'
                  : 'Leave Request Rejected'}
              </div>
              {primaryApproval && (
                <div
                  style={{
                    fontSize: 12.5,
                    color: isDark ? '#d1d5db' : '#334155',
                    marginTop: 4,
                    lineHeight: 1.4,
                  }}
                >
                  Decided by{' '}
                  <strong>{primaryApproval.decided_by_name || primaryApproval.decided_by_email}</strong>{' '}
                  on{' '}
                  {new Date(primaryApproval.decided_at).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {primaryApproval.remarks && (
                    <div
                      style={{
                        marginTop: 4,
                        fontStyle: 'italic',
                        color: isDark ? '#93c5fd' : '#2563eb',
                      }}
                    >
                      Remarks: "{primaryApproval.remarks}"
                    </div>
                  )}
                </div>
              )}
              <div style={{ fontSize: 11.5, color: t.cardLabel, marginTop: 6 }}>
                Note: Decisions are final and recorded permanently in the campus audit log.
              </div>
            </div>
          </div>
        )}

        {/* 1. Student Card */}
        <div
          style={{
            background: t.cardBg,
            border: `1px solid ${t.cardBorder}`,
            borderRadius: 16,
            padding: '18px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 18,
            boxShadow: t.cardShadow,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: isDark ? '#1e293b' : '#e0e7ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              color: isDark ? '#60a5fa' : '#4338ca',
              fontWeight: 800,
              overflow: 'hidden',
              flexShrink: 0,
              border: `2px solid ${isDark ? 'rgba(59, 130, 246, 0.4)' : '#818cf8'}`,
            }}
          >
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
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: t.cardHeading }}>
              {student.name || request.name}
            </h2>
            <div style={{ fontSize: 13, color: t.cardLabel }}>
              Roll No:{' '}
              <span style={{ color: t.cardValue, fontWeight: 600 }}>
                {student.rollNo || request.rollNo}
              </span>
            </div>
            <div style={{ fontSize: 13, color: t.cardLabel, marginTop: 2 }}>
              Hostel: <span style={{ color: t.cardValue }}>{student.hostel || 'Assigned'}</span> •
              Room: <span style={{ color: t.cardValue }}>{student.roomNo || 'N/A'}</span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: isDark ? '#38bdf8' : '#0284c7',
                marginTop: 4,
                fontWeight: 600,
              }}
            >
              Completed Past Leaves: <strong>{request.previousLeaveCount || 0}</strong>
            </div>
          </div>
        </div>

        {/* 2. Request Details Card */}
        <div
          style={{
            background: t.cardBg,
            border: `1px solid ${t.cardBorder}`,
            borderRadius: 16,
            padding: '22px 20px',
            marginBottom: 20,
            boxShadow: t.cardShadow,
          }}
        >
          <h3
            style={{
              margin: '0 0 16px',
              fontSize: 13.5,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: t.cardTitle,
              letterSpacing: 0.8,
            }}
          >
            Trip & Leave Details
          </h3>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: t.cardLabel,
                  fontSize: 12.5,
                  marginBottom: 4,
                }}
              >
                <MdDateRange size={16} color="#3b82f6" />
                <span>Planned Departure Date</span>
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: t.cardHeading,
                  fontFamily: 'monospace',
                }}
              >
                {request.leave_date}
              </div>
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: t.cardLabel,
                  fontSize: 12.5,
                  marginBottom: 4,
                }}
              >
                <MdDateRange size={16} color="#10b981" />
                <span>Planned Return Date</span>
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: t.cardHeading,
                  fontFamily: 'monospace',
                }}
              >
                {request.return_date}
              </div>
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: t.cardLabel,
                  fontSize: 12.5,
                  marginBottom: 4,
                }}
              >
                <MdLocationOn size={16} color="#ef4444" />
                <span>Destination Place</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: t.cardHeading }}>
                {request.place || 'Home'}
              </div>
            </div>

            {request.accompanying && (
              <div style={{ gridColumn: 'span 2' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: t.cardLabel,
                    fontSize: 12.5,
                    marginBottom: 4,
                  }}
                >
                  <MdPerson size={16} color="#8b5cf6" />
                  <span>Accompanying Person</span>
                </div>
                <div style={{ fontSize: 14, color: t.cardValue }}>{request.accompanying}</div>
              </div>
            )}

            <div style={{ gridColumn: 'span 2' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: t.cardLabel,
                  fontSize: 12.5,
                  marginBottom: 4,
                }}
              >
                <MdNotes size={16} color="#f59e0b" />
                <span>Reason for Home Visit</span>
              </div>
              <div
                style={{
                  background: t.reasonBoxBg,
                  padding: '12px 14px',
                  borderRadius: 10,
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: t.reasonBoxText,
                  border: `1px solid ${t.reasonBoxBorder}`,
                }}
              >
                {request.reason}
              </div>
            </div>

            <div style={{ gridColumn: 'span 2', fontSize: 12, color: t.cardLabel, marginTop: 4 }}>
              Requested on: {istCreatedAt} (IST)
            </div>
          </div>
        </div>

        {/* 3. Decision Section (Only active when status is pending) */}
        {isPending && (
          <div
            style={{
              background: t.decisionCardBg,
              border: t.decisionCardBorder,
              borderRadius: 16,
              padding: '22px 20px',
              boxShadow: t.cardShadow,
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: t.decisionTitle }}>
              Record Guardian Decision
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: t.decisionSub }}>
              Please review the dates and destination above carefully before recording your decision.
            </p>

            <div className="form-group" style={{ marginBottom: 18 }}>
              <label className="form-label" style={{ fontWeight: 600, color: t.cardHeading }}>
                Optional Remarks / Note (Max 500 characters)
              </label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="Add any instructions, travel conditions, or comments for hostel staff..."
                maxLength={500}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                style={{
                  resize: 'vertical',
                  fontSize: 13.5,
                  background: t.textareaBg,
                  border: `1px solid ${t.textareaBorder}`,
                  color: t.textareaColor,
                }}
              />
              <div style={{ textAlign: 'right', fontSize: 11.5, color: t.cardLabel, marginTop: 4 }}>
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
                  boxShadow: '0 4px 14px rgba(5, 150, 105, 0.3)',
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
                  boxShadow: '0 4px 14px rgba(220, 38, 38, 0.3)',
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
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: isDark ? 'rgba(0, 0, 0, 0.75)' : 'rgba(15, 23, 42, 0.6)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              padding: 20,
            }}
          >
            <div
              style={{
                background: t.modalBg,
                border: `1.5px solid ${
                  confirmModal.action === 'APPROVED' ? '#10b981' : '#ef4444'
                }`,
                borderRadius: 18,
                padding: 24,
                maxWidth: 440,
                width: '100%',
                boxShadow: isDark
                  ? '0 20px 50px rgba(0,0,0,0.6)'
                  : '0 20px 40px rgba(15, 23, 42, 0.15)',
              }}
              className="fade-in"
            >
              <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 10 }}>
                {confirmModal.action === 'APPROVED' ? '✅' : '❌'}
              </div>

              <h3
                style={{
                  margin: '0 0 10px',
                  fontSize: 18,
                  textAlign: 'center',
                  color: t.modalTitle,
                }}
              >
                Confirm {confirmModal.action === 'APPROVED' ? 'Approval' : 'Rejection'}
              </h3>

              <p
                style={{
                  fontSize: 13.5,
                  color: t.modalText,
                  textAlign: 'center',
                  lineHeight: 1.5,
                  marginBottom: 18,
                }}
              >
                Are you sure you want to{' '}
                <strong>{confirmModal.action === 'APPROVED' ? 'APPROVE' : 'REJECT'}</strong>{' '}
                {student.name}'s leave from <strong>{request.leave_date}</strong> to{' '}
                <strong>{request.return_date}</strong>?
              </p>

              <div
                style={{
                  background: isDark ? 'rgba(255, 255, 255, 0.04)' : '#fffbeb',
                  border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : '#fde68a'}`,
                  padding: '10px 14px',
                  borderRadius: 10,
                  fontSize: 12.5,
                  color: isDark ? '#fbbf24' : '#92400e',
                  marginBottom: 20,
                  textAlign: 'center',
                }}
              >
                ⚠️ <strong>Note:</strong> Decisions are final and cannot be modified once submitted.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button
                  type="button"
                  onClick={handleCloseConfirm}
                  disabled={submitting}
                  className="btn btn-ghost"
                  style={{
                    padding: '12px',
                    borderRadius: 10,
                    border: `1px solid ${t.modalBorder}`,
                    color: t.modalText,
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleFinalSubmit}
                  disabled={submitting}
                  className={
                    confirmModal.action === 'APPROVED' ? 'btn btn-success' : 'btn btn-danger'
                  }
                  style={{ padding: '12px', borderRadius: 10, fontWeight: 700 }}
                >
                  {submitting ? (
                    <span className="loading-spinner" />
                  ) : (
                    `Yes, ${confirmModal.action}`
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
