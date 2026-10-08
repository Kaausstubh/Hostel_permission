/**
 * Attendance Screen 3: Room Details Modal/View
 * Shows live room occupants, biometric approval time, anomaly flags,
 * and per-student manual overrides with mandatory remarks.
 */

import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';
import { resolveBackendOrigin } from '../services/backendUrl';
import toast from 'react-hot-toast';
import {
  MdClose,
  MdRefresh,
  MdSend,
  MdCheckCircle,
  MdCancel,
  MdWarning,
  MdHome,
  MdPhone,
  MdSchedule,
  MdFlag,
  MdEditNote,
} from 'react-icons/md';
import StudentAvatar from './StudentAvatar';

export default function AttendanceRoomDetailsModal({
  roundId,
  roomNo,
  isLocked = false,
  onClose = () => {},
  onRefresh = () => {},
}) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  // Manual Override Dialog State
  const [overrideStudent, setOverrideStudent] = useState(null); // student object
  const [overrideStatus, setOverrideStatus] = useState('manual_present');
  const [overrideRemark, setOverrideRemark] = useState('');
  const [submittingOverride, setSubmittingOverride] = useState(false);

  // Skip Dialog State inside room details
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [submittingSkip, setSubmittingSkip] = useState(false);

  const fetchDetails = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.get(`/attendance/rounds/${roundId}/rooms/${roomNo}`);
      if (res.data?.success) {
        setDetails(res.data);
      }
    } catch (err) {
      if (!silent) toast.error('Failed to load room details');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
    // Poll every 2.5s for fallback live updates
    const timer = setInterval(() => fetchDetails(true), 2500);

    let socket = null;
    try {
      const token = localStorage.getItem('token');
      const origin = resolveBackendOrigin();
      socket = io(`${origin}/dashboard`, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
      });

      socket.on('room_attendance_updated', (data) => {
        if (!data || !data.roomNo || String(data.roomNo) === String(roomNo)) {
          fetchDetails(true);
          onRefresh();
        }
      });
    } catch (_) {}

    return () => {
      clearInterval(timer);
      if (socket) {
        socket.disconnect();
      }
    };
  }, [roundId, roomNo]);

  // Request or Resend
  const handleRequest = async () => {
    try {
      const res = await api.post(`/attendance/rounds/${roundId}/rooms/${roomNo}/request`);
      if (res.data?.success) {
        toast.success(`Request sent to Room ${roomNo}`);
        fetchDetails(true);
        onRefresh();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send request');
    }
  };

  // Skip Room
  const handleSkipRoom = async () => {
    if (!skipReason.trim()) {
      toast.error('A mandatory skip reason is required');
      return;
    }
    try {
      setSubmittingSkip(true);
      const res = await api.post(`/attendance/rounds/${roundId}/rooms/${roomNo}/skip`, {
        reason: skipReason.trim(),
      });
      if (res.data?.success) {
        toast.success(`Room ${roomNo} marked as skipped`);
        setSkipDialogOpen(false);
        fetchDetails(true);
        onRefresh();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to skip room');
    } finally {
      setSubmittingSkip(false);
    }
  };

  // Reopen Room
  const handleReopen = async () => {
    try {
      const res = await api.post(`/attendance/rounds/${roundId}/rooms/${roomNo}/reopen`);
      if (res.data?.success) {
        toast.success(`Room ${roomNo} reopened`);
        fetchDetails(true);
        onRefresh();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reopen room');
    }
  };

  // Submit Manual Override
  const handleSubmitOverride = async () => {
    if (!overrideRemark.trim()) {
      toast.error('A remark is MANDATORY for every manual attendance mark');
      return;
    }

    try {
      setSubmittingOverride(true);
      const requestId = details?.request?.id;
      if (!requestId) {
        toast.error('No active request found for this room');
        return;
      }

      const res = await api.post(`/attendance/requests/${requestId}/override`, {
        studentId: overrideStudent.studentId,
        status: overrideStatus,
        remark: overrideRemark.trim(),
      });

      if (res.data?.success) {
        toast.success(`Marked ${overrideStudent.name} as ${overrideStatus.replace('manual_', '')}`);
        setOverrideStudent(null);
        setOverrideRemark('');
        fetchDetails(true);
        onRefresh();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record manual mark');
    } finally {
      setSubmittingOverride(false);
    }
  };

  const req = details?.request;
  const isRequestActive = req && req.status === 'open' && req.remainingSeconds > 0;
  const isRoomSkipped = req?.status === 'skipped';

  return (
    <div
      className="modal-backdrop show"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card room-details-modal"
        style={{
          width: '100%',
          maxWidth: 620,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          padding: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: 'var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-surface)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Room {roomNo}
              </h2>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {details?.hostel} · Floor {details?.floor}
              </span>
            </div>
            {isRequestActive && (
              <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                ● Request active ({req.remainingSeconds}s remaining)
              </span>
            )}
            {isRoomSkipped && (
              <span style={{ fontSize: 11, color: '#f97316', fontWeight: 600 }}>
                ● Skipped: {req.skip_reason}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <MdClose size={22} />
          </button>
        </div>

        {/* Student Roster Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading && !details ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
              Loading student roster…
            </div>
          ) : details?.students?.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
              No students currently allocated to Room {roomNo}.
            </div>
          ) : (
            details?.students?.map((student) => {
              // Status Badge Styling
              let statusBg = 'rgba(100,116,139,0.15)';
              let statusColor = '#94a3b8';

              if (student.status === 'Approved') {
                statusBg = 'rgba(16,185,129,0.15)';
                statusColor = '#10b981';
              } else if (student.status === 'Present (manual)') {
                statusBg = 'rgba(34,211,238,0.15)';
                statusColor = '#22d3ee';
              } else if (student.status === 'Absent') {
                statusBg = 'rgba(239,68,68,0.15)';
                statusColor = '#ef4444';
              } else if (student.status === 'On leave') {
                statusBg = 'rgba(168,85,247,0.15)';
                statusColor = '#c084fc';
              } else if (student.status === 'Flagged') {
                statusBg = 'rgba(245,158,11,0.15)';
                statusColor = '#f59e0b';
              }

              return (
                <div
                  key={student.studentId}
                  style={{
                    padding: 14,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-card)',
                    border: 'var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    {/* Student Info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <StudentAvatar
                        student={{
                          name: student.name,
                          studentPhoto: student.photo,
                          picture: student.photo,
                        }}
                        size={44}
                      />
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {student.name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                          {student.rollNo}
                          {student.phone && ` · ${student.phone}`}
                        </div>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 700,
                        background: statusBg,
                        color: statusColor,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                      }}
                    >
                      {student.status}
                    </span>
                  </div>

                  {/* Verification Metadata & Flags */}
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {student.approvedAt && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <MdSchedule size={13} style={{ color: 'var(--success)' }} />
                        Approved at {new Date(student.approvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    )}

                    {student.remark && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)' }}>
                        <MdEditNote size={14} />
                        Remark: <em>"{student.remark}"</em>
                      </span>
                    )}

                    {student.flags?.map((fl) => (
                      <span
                        key={fl}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          color: '#f59e0b',
                          fontWeight: 600,
                          background: 'rgba(245,158,11,0.1)',
                          padding: '1px 6px',
                          borderRadius: 4,
                        }}
                      >
                        <MdFlag size={12} /> {fl}
                      </span>
                    ))}
                  </div>

                  {/* Manual Override Actions (if not already locked) */}
                  {!isLocked && (
                    <div style={{ display: 'flex', gap: 6, paddingTop: 6, borderTop: '1px solid rgba(139,92,246,0.1)' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setOverrideStudent(student);
                          setOverrideStatus('manual_present');
                          setOverrideRemark('Physically verified by staff member');
                        }}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 11,
                          fontWeight: 600,
                          background: 'rgba(16,185,129,0.1)',
                          color: '#10b981',
                          border: '1px solid rgba(16,185,129,0.25)',
                          cursor: 'pointer',
                        }}
                      >
                        Mark Present
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setOverrideStudent(student);
                          setOverrideStatus('manual_absent');
                          setOverrideRemark('Not in room during staff round');
                        }}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 11,
                          fontWeight: 600,
                          background: 'rgba(239,68,68,0.1)',
                          color: '#ef4444',
                          border: '1px solid rgba(239,68,68,0.25)',
                          cursor: 'pointer',
                        }}
                      >
                        Mark Absent
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setOverrideStudent(student);
                          setOverrideStatus('manual_on_leave');
                          setOverrideRemark('Reported on authorized leave');
                        }}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 11,
                          fontWeight: 600,
                          background: 'rgba(168,85,247,0.1)',
                          color: '#c084fc',
                          border: '1px solid rgba(168,85,247,0.25)',
                          cursor: 'pointer',
                        }}
                      >
                        Mark On Leave
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer Room Actions */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: 'var(--border)',
            background: 'var(--bg-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          {isRoomSkipped ? (
            <button
              type="button"
              onClick={handleReopen}
              disabled={isLocked}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-input)',
                color: 'var(--accent)',
                border: '1px solid rgba(34,211,238,0.3)',
                fontWeight: 600,
                fontSize: 12.5,
                cursor: isLocked ? 'not-allowed' : 'pointer',
              }}
            >
              Reopen Room
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSkipReason('');
                setSkipDialogOpen(true);
              }}
              disabled={isLocked}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-color)',
                fontWeight: 600,
                fontSize: 12.5,
                cursor: isLocked ? 'not-allowed' : 'pointer',
              }}
            >
              Skip Room
            </button>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => fetchDetails(true)}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-input)',
                border: 'var(--border)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Refresh"
            >
              <MdRefresh size={18} />
            </button>

            {!isRoomSkipped && (
              <button
                type="button"
                onClick={handleRequest}
                disabled={isLocked}
                style={{
                  padding: '8px 18px',
                  borderRadius: 'var(--radius-sm)',
                  background: isRequestActive ? 'rgba(34,211,238,0.15)' : 'var(--gradient-primary)',
                  color: isRequestActive ? 'var(--accent)' : '#fff',
                  border: isRequestActive ? '1px solid var(--accent)' : 'none',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <MdSend size={15} />
                {isRequestActive ? `Resend (${req.remainingSeconds}s)` : 'Request Attendance'}
              </button>
            )}
          </div>
        </div>

        {/* Modal Subdialog: Manual Override with Mandatory Remark */}
        {overrideStudent && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 70,
              background: 'rgba(0,0,0,0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <div className="card" style={{ width: '100%', maxWidth: 440, padding: 20, borderRadius: 'var(--radius-md)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px 0', color: 'var(--text-primary)' }}>
                Manual Mark: {overrideStudent.name}
              </h3>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 14 }}>
                A remark is <strong>mandatory</strong> for every manual mark.
              </p>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  Status
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { label: 'Present', val: 'manual_present' },
                    { label: 'Absent', val: 'manual_absent' },
                    { label: 'On Leave', val: 'manual_on_leave' },
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => setOverrideStatus(opt.val)}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 12,
                        fontWeight: 600,
                        border: overrideStatus === opt.val ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                        background: overrideStatus === opt.val ? 'var(--bg-card-hover)' : 'var(--bg-input)',
                        color: overrideStatus === opt.val ? 'var(--primary-light)' : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Presets */}
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  Quick reasons:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {[
                    'Dead phone battery',
                    'No smartphone present',
                    'Physically verified in room',
                    'Sick in bed',
                    'Permitted library work',
                  ].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setOverrideRemark(p)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 99,
                        fontSize: 11,
                        background: overrideRemark === p ? 'var(--bg-card-hover)' : 'var(--bg-input)',
                        color: overrideRemark === p ? 'var(--primary-light)' : 'var(--text-muted)',
                        border: '1px solid var(--border-color)',
                        cursor: 'pointer',
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  Remark (Mandatory)
                </label>
                <input
                  type="text"
                  placeholder="Enter reason for manual override…"
                  value={overrideRemark}
                  onChange={(e) => setOverrideRemark(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)',
                    border: 'var(--border)',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setOverrideStudent(null)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmitOverride}
                  disabled={submittingOverride || !overrideRemark.trim()}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--gradient-primary)',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: submittingOverride || !overrideRemark.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submittingOverride ? 'Saving…' : 'Save Mark'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Subdialog: Skip Room */}
        {skipDialogOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 70,
              background: 'rgba(0,0,0,0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <div className="card" style={{ width: '100%', maxWidth: 440, padding: 20, borderRadius: 'var(--radius-md)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px 0', color: 'var(--text-primary)' }}>
                Skip Room {roomNo}
              </h3>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>
                Reason is mandatory. You can reopen this room later before completing the round.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {['Room locked', 'Students on leave', 'Students at lab', 'Room vacant'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setSkipReason(preset)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 99,
                      fontSize: 11,
                      background: skipReason === preset ? 'var(--bg-card-hover)' : 'var(--bg-input)',
                      color: skipReason === preset ? 'var(--primary-light)' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      cursor: 'pointer',
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <textarea
                rows={3}
                placeholder="Enter mandatory skip reason…"
                value={skipReason}
                onChange={(e) => setSkipReason(e.target.value)}
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-input)',
                  border: 'var(--border)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  marginBottom: 14,
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setSkipDialogOpen(false)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSkipRoom}
                  disabled={submittingSkip || !skipReason.trim()}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--gradient-danger)',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: submittingSkip || !skipReason.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submittingSkip ? 'Skipping…' : 'Confirm Skip'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
