/**
 * Parent Home-Visit Approval Page
 *
 * Mobile-first, secure passwordless decision portal for parents/guardians.
 * Authenticated via high-entropy single-use cryptographic token.
 *
 * GET request is strictly read-only (safe for link prefetchers and security scanners).
 * Decision requires explicit parent interaction via confirmation modal and POST.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import {
  MdCheckCircle,
  MdCancel,
  MdWarning,
  MdAccessTime,
  MdShield,
  MdPerson,
  MdPlace,
  MdEvent,
  MdNotes,
  MdMeetingRoom,
} from 'react-icons/md';

export default function ParentHomeVisitRespond() {
  const { visitId: routeVisitId, token: routeToken } = useParams();
  const [searchParams] = useSearchParams();

  const visitId = routeVisitId || searchParams.get('id') || '';
  const token = routeToken || searchParams.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [visit, setVisit] = useState(null);
  const [errorState, setErrorState] = useState(null); // { type: 'invalid' | 'expired' | 'decided' | 'network', message: string }
  const [remarks, setRemarks] = useState('');

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    action: null, // 'approve' | 'reject'
  });

  const [submitting, setSubmitting] = useState(false);
  const [resultState, setResultState] = useState(null); // { action: 'approve' | 'reject', message: string }

  const isValidObjectId = useMemo(() => /^[a-f\d]{24}$/i.test(visitId || ''), [visitId]);

  // Load visit details on mount (SAFE GET: strictly read-only)
  useEffect(() => {
    let isMounted = true;

    async function fetchVisitDetails() {
      if (!isValidObjectId) {
        setErrorState({
          type: 'invalid',
          message: 'The link you clicked has an invalid request identifier.',
        });
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorState(null);

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : '';
        const res = await api.get(`/homevisit/parent-verify/${visitId}${query}`);

        if (!isMounted) return;

        if (res.data?.success && res.data.visit) {
          const v = res.data.visit;
          setVisit(v);

          if (v.alreadyDecided) {
            setErrorState({
              type: 'decided',
              decision: v.parent_approval_status,
              message: `This request has already been ${v.parent_approval_status === 'parent_approved' ? 'APPROVED' : 'REJECTED'}.`,
            });
          } else if (v.expired) {
            setErrorState({
              type: 'expired',
              message: 'This approval link has expired (valid for 48 hours). Please contact the hostel office.',
            });
          }
        }
      } catch (err) {
        if (!isMounted) return;

        const data = err.response?.data;
        if (data?.invalidToken) {
          setErrorState({
            type: 'invalid',
            message: data.message || 'Invalid or previously used approval token.',
          });
        } else if (data?.expired) {
          setErrorState({
            type: 'expired',
            message: data.message || 'This approval link has expired.',
          });
        } else if (data?.alreadyDecided) {
          setErrorState({
            type: 'decided',
            message: data.message || 'This request has already been processed.',
          });
        } else {
          setErrorState({
            type: 'network',
            message: data?.message || 'Unable to load request details. Please check your internet connection.',
          });
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchVisitDetails();

    return () => {
      isMounted = false;
    };
  }, [visitId, token, isValidObjectId]);

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

  const handleExecuteDecision = async () => {
    const action = confirmModal.action;
    if (!action || submitting) return;

    setSubmitting(true);
    try {
      const res = await api.post('/homevisit/parent-respond', {
        visit_id: visitId,
        token,
        action,
        remarks: remarks.trim(),
      });

      setConfirmModal({ isOpen: false, action: null });
      setResultState({
        action,
        message: res.data?.message || (action === 'approve'
          ? 'Home-visit request approved. Final approval will now be processed by the hostel warden.'
          : 'Home-visit request rejected.'),
      });
    } catch (err) {
      const errMsg = err.response?.data?.message || 'Failed to submit decision. Please try again.';
      alert(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0b0f19',
        color: '#f3f4f6',
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '24px 16px 48px',
        boxSizing: 'border-box',
      }}
    >
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 800, color: '#60a5fa', letterSpacing: '0.5px' }}>
          <span>🏛️</span> HEIMDALL
        </div>
        <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>
          Hostel Management &amp; Campus Access System
        </div>
      </div>

      {/* Main Container Card */}
      <div
        style={{
          width: '100%',
          maxWidth: 540,
          backgroundColor: '#111827',
          border: '1px solid #1f2937',
          borderRadius: 18,
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Card Header */}
        <div
          style={{
            padding: '18px 24px',
            background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.5) 0%, rgba(15, 23, 42, 0.8) 100%)',
            borderBottom: '1px solid #1f2937',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#ffffff' }}>
              Parent Approval
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#93c5fd' }}>
              Student Home-Visit Verification
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11.5,
              fontWeight: 600,
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              color: '#93c5fd',
              padding: '4px 10px',
              borderRadius: 20,
            }}
          >
            <MdShield size={14} /> Passwordless
          </div>
        </div>

        {/* Card Body */}
        <div style={{ padding: '24px 20px' }}>
          {/* Loading State */}
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 16px' }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  border: '3px solid #1f2937',
                  borderTopColor: '#3b82f6',
                  borderRadius: '50%',
                  margin: '0 auto 16px',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <div style={{ fontSize: 15, fontWeight: 600, color: '#e5e7eb' }}>
                Verifying approval link…
              </div>
              <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>
                Retrieving student request details from HEIMDALL
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* Success Decision Result State */}
          {!loading && resultState && (
            <div style={{ textAlign: 'center', padding: '24px 12px' }}>
              {resultState.action === 'approve' ? (
                <div style={{ color: '#10b981', marginBottom: 12 }}>
                  <MdCheckCircle size={56} style={{ margin: '0 auto' }} />
                </div>
              ) : (
                <div style={{ color: '#ef4444', marginBottom: 12 }}>
                  <MdCancel size={56} style={{ margin: '0 auto' }} />
                </div>
              )}

              <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: '#ffffff' }}>
                {resultState.action === 'approve' ? 'Request Approved' : 'Request Rejected'}
              </h2>
              <p style={{ fontSize: 14, color: '#d1d5db', lineHeight: 1.6, margin: '0 0 20px' }}>
                {resultState.message}
              </p>

              <div
                style={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: 12,
                  padding: 16,
                  textAlign: 'left',
                  fontSize: 13,
                  color: '#9ca3af',
                  lineHeight: 1.5,
                }}
              >
                <div>• Your decision has been saved atomically in MongoDB.</div>
                <div>• Single-use approval token has been consumed.</div>
                <div>• Digital gate pass QR code is now generated on your ward&apos;s dashboard.</div>
                <div>• The hostel warden and gate security portals have been updated.</div>
              </div>
            </div>
          )}

          {/* Error / Pre-existing state (Decided / Expired / Invalid) */}
          {!loading && !resultState && errorState && (
            <div style={{ textAlign: 'center', padding: '16px 8px' }}>
              <div
                style={{
                  color: errorState.type === 'decided' ? '#38bdf8' : '#f59e0b',
                  marginBottom: 12,
                }}
              >
                {errorState.type === 'decided' ? (
                  <MdCheckCircle size={52} style={{ margin: '0 auto' }} />
                ) : errorState.type === 'expired' ? (
                  <MdAccessTime size={52} style={{ margin: '0 auto' }} />
                ) : (
                  <MdWarning size={52} style={{ margin: '0 auto' }} />
                )}
              </div>

              <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: '#ffffff' }}>
                {errorState.type === 'decided'
                  ? 'Request Already Processed'
                  : errorState.type === 'expired'
                  ? 'Link Expired'
                  : 'Unable to Open Request'}
              </h2>

              <p style={{ fontSize: 14, color: '#d1d5db', lineHeight: 1.55, margin: '0 0 20px' }}>
                {errorState.message}
              </p>

              {visit && (
                <div
                  style={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: 12,
                    padding: 16,
                    textAlign: 'left',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#ffffff', marginBottom: 6 }}>
                    Request Summary:
                  </div>
                  <div>• Student: <strong>{visit.studentName}</strong> ({visit.studentId})</div>
                  <div>• Destination: <strong>{visit.place || 'Home'}</strong></div>
                  <div>• Leave Dates: <strong>{visit.leave_date} → {visit.return_date}</strong></div>
                  <div>
                    • Current Status:{' '}
                    <span
                      style={{
                        color:
                          visit.parent_approval_status === 'parent_approved'
                            ? '#10b981'
                            : visit.parent_approval_status === 'parent_rejected'
                            ? '#ef4444'
                            : '#f59e0b',
                        fontWeight: 700,
                      }}
                    >
                      {visit.parent_approval_status === 'parent_approved'
                        ? 'Parent Approved'
                        : visit.parent_approval_status === 'parent_rejected'
                        ? 'Parent Rejected'
                        : visit.parent_approval_status}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Active Decision Form (Valid pending request) */}
          {!loading && !resultState && !errorState && visit && (
            <div>
              {/* Notice Banner */}
              <div
                style={{
                  backgroundColor: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  fontSize: 13,
                  color: '#bfdbfe',
                  lineHeight: 1.5,
                  marginBottom: 20,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 18 }}>ℹ️</span>
                <span>
                  Please review the details below submitted by your child. Select <strong>Approve</strong> or <strong>Reject</strong> to submit your official decision.
                </span>
              </div>

              {/* Student Details Card */}
              <div
                style={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: 14,
                  padding: 18,
                  marginBottom: 20,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 14, borderBottom: '1px solid #374151' }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      backgroundColor: '#374151',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#60a5fa',
                      fontSize: 22,
                    }}
                  >
                    <MdPerson />
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                      {visit.studentName}
                    </div>
                    <div style={{ fontSize: 13, color: '#9ca3af' }}>
                      Student ID: <code style={{ color: '#93c5fd' }}>{visit.studentId}</code>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, paddingTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5 }}>
                    <MdMeetingRoom size={18} style={{ color: '#9ca3af', marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <span style={{ color: '#9ca3af' }}>Hostel &amp; Room: </span>
                      <strong style={{ color: '#ffffff' }}>{visit.hostel} • Room {visit.roomNo}</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5 }}>
                    <MdPlace size={18} style={{ color: '#9ca3af', marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <span style={{ color: '#9ca3af' }}>Destination: </span>
                      <strong style={{ color: '#ffffff' }}>{visit.place || 'Home'}</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5 }}>
                    <MdEvent size={18} style={{ color: '#9ca3af', marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <span style={{ color: '#9ca3af' }}>Departure: </span>
                      <strong style={{ color: '#ffffff' }}>{visit.leave_date} ({visit.departure_time || '09:00 AM'})</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5 }}>
                    <MdEvent size={18} style={{ color: '#9ca3af', marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <span style={{ color: '#9ca3af' }}>Expected Return: </span>
                      <strong style={{ color: '#ffffff' }}>{visit.return_date} ({visit.return_time || '08:00 PM'})</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5 }}>
                    <MdNotes size={18} style={{ color: '#9ca3af', marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <span style={{ color: '#9ca3af' }}>Reason for Visit: </span>
                      <span style={{ color: '#f3f4f6', fontStyle: 'italic' }}>"{visit.reason}"</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Optional Remarks Input */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#d1d5db', marginBottom: 6 }}>
                  Parent Remarks (Optional):
                </label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Approved. Will be travelling by train."
                  rows={2}
                  maxLength={500}
                  style={{
                    width: '100%',
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: 10,
                    padding: '10px 12px',
                    color: '#ffffff',
                    fontSize: 13.5,
                    fontFamily: 'inherit',
                    resize: 'none',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Large Mobile-First Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => handleOpenConfirm('approve')}
                  style={{
                    width: '100%',
                    padding: '16px 20px',
                    borderRadius: 12,
                    border: 'none',
                    backgroundColor: '#10b981',
                    color: '#ffffff',
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: '0.4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <MdCheckCircle size={22} /> APPROVE REQUEST
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenConfirm('reject')}
                  style={{
                    width: '100%',
                    padding: '16px 20px',
                    borderRadius: 12,
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    color: '#fca5a5',
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: '0.4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <MdCancel size={22} /> REJECT REQUEST
                </button>
              </div>

              <div style={{ marginTop: 20, textAlign: 'center', fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
                🔒 This decision is digitally signed and logged with your IP address.<br />
                Once submitted, your choice cannot be modified.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div
          style={{
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
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              backgroundColor: '#111827',
              border: `1.5px solid ${confirmModal.action === 'approve' ? '#10b981' : '#ef4444'}`,
              borderRadius: 18,
              padding: 24,
              boxShadow: '0 25px 50px rgba(0, 0, 0, 0.8)',
              animation: 'modalSlideIn 0.2s ease-out',
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              {confirmModal.action === 'approve' ? (
                <div style={{ color: '#10b981', marginBottom: 8 }}>
                  <MdCheckCircle size={48} style={{ margin: '0 auto' }} />
                </div>
              ) : (
                <div style={{ color: '#ef4444', marginBottom: 8 }}>
                  <MdCancel size={48} style={{ margin: '0 auto' }} />
                </div>
              )}

              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#ffffff' }}>
                Confirm {confirmModal.action === 'approve' ? 'Approval' : 'Rejection'}
              </h3>
              <p style={{ margin: 0, fontSize: 14, color: '#d1d5db', lineHeight: 1.5 }}>
                Are you sure you want to{' '}
                <strong style={{ color: confirmModal.action === 'approve' ? '#34d399' : '#f87171' }}>
                  {confirmModal.action.toUpperCase()}
                </strong>{' '}
                this home-visit request for <strong>{visit?.studentName}</strong>?
              </p>
            </div>

            <div
              style={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: 10,
                padding: 12,
                fontSize: 12.5,
                color: '#9ca3af',
                marginBottom: 20,
                lineHeight: 1.45,
              }}
            >
              {confirmModal.action === 'approve' ? (
                <>
                  ✓ Your approval authorizes your child's leave.<br />
                  ✓ The hostel warden will process the final gate-pass release.
                </>
              ) : (
                <>
                  ✗ Your child will <strong>not</strong> be permitted to leave campus.<br />
                  ✗ This request will be finalized as rejected.
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={handleCloseConfirm}
                disabled={submitting}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: 10,
                  border: '1px solid #374151',
                  backgroundColor: '#1f2937',
                  color: '#d1d5db',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteDecision}
                disabled={submitting}
                style={{
                  flex: 1.2,
                  padding: '12px',
                  borderRadius: 10,
                  border: 'none',
                  backgroundColor: confirmModal.action === 'approve' ? '#10b981' : '#ef4444',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {submitting ? (
                  <span>Submitting…</span>
                ) : (
                  <span>Yes, {confirmModal.action === 'approve' ? 'Approve' : 'Reject'}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 24, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
        HEIMDALL Campus Management System • Secure Zero-Cost Parent Gateway
      </div>
    </div>
  );
}
