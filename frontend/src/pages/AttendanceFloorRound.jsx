/**
 * Attendance Screen 2: Room List for Floor
 * Mobile-first floor round execution with inline Request Attendance, Resend countdown,
 * Skip dialog, live progress, and Room Details navigation.
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../services/api';
import { resolveBackendOrigin } from '../services/backendUrl';
import toast from 'react-hot-toast';
import {
  MdArrowBack,
  MdRefresh,
  MdCheckCircle,
  MdWarning,
  MdSkipNext,
  MdSend,
  MdClose,
  MdLock,
  MdLockOpen,
  MdFilterList,
} from 'react-icons/md';
import AttendanceRoomDetailsModal from '../components/AttendanceRoomDetailsModal';
import Navbar from '../components/Navbar';

export default function AttendanceFloorRound() {
  const { roundId } = useParams();
  const navigate = useNavigate();

  const [roundData, setRoundData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All'); // All | Pending | Needs review | Completed | Skipped
  const [selectedRoomNo, setSelectedRoomNo] = useState(null);

  // Skip Dialog State
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);
  const [skipRoomNo, setSkipRoomNo] = useState(null);
  const [skipReason, setSkipReason] = useState('');
  const [skipSubmitting, setSkipSubmitting] = useState(false);

  // Complete Round Dialog State
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completeSubmitting, setCompleteSubmitting] = useState(false);

  // Request loading tracking by room
  const [actionLoading, setActionLoading] = useState({});

  const fetchRooms = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.get(`/attendance/rounds/${roundId}/rooms`);
      if (res.data?.success) {
        setRoundData(res.data);
      }
    } catch (err) {
      if (!silent) toast.error(err.response?.data?.message || 'Failed to load rooms');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
    // Poll every 3 seconds for fallback live updates
    const interval = setInterval(() => fetchRooms(true), 3000);

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
        if (!data || !data.roundId || String(data.roundId) === String(roundId)) {
          fetchRooms(true);
        }
      });

      socket.on('round_completed', (data) => {
        if (!data || !data.roundId || String(data.roundId) === String(roundId)) {
          fetchRooms(true);
        }
      });
    } catch (_) {}

    return () => {
      clearInterval(interval);
      if (socket) {
        socket.disconnect();
      }
    };
  }, [roundId]);

  // Handle Request Attendance or Resend
  const handleRequestAttendance = async (roomNo, e) => {
    e.stopPropagation();
    try {
      setActionLoading((prev) => ({ ...prev, [roomNo]: true }));
      const res = await api.post(`/attendance/rounds/${roundId}/rooms/${roomNo}/request`);
      if (res.data?.success) {
        toast.success(`Request sent to Room ${roomNo}`);
        fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send request');
    } finally {
      setActionLoading((prev) => ({ ...prev, [roomNo]: false }));
    }
  };

  // Open Skip Dialog
  const handleOpenSkip = (roomNo, e) => {
    e.stopPropagation();
    setSkipRoomNo(roomNo);
    setSkipReason('');
    setSkipDialogOpen(true);
  };

  // Submit Skip
  const handleSubmitSkip = async () => {
    if (!skipReason.trim()) {
      toast.error('A mandatory skip reason is required');
      return;
    }
    try {
      setSkipSubmitting(true);
      const res = await api.post(`/attendance/rounds/${roundId}/rooms/${skipRoomNo}/skip`, {
        reason: skipReason.trim(),
      });
      if (res.data?.success) {
        toast.success(`Room ${skipRoomNo} skipped`);
        setSkipDialogOpen(false);
        fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to skip room');
    } finally {
      setSkipSubmitting(false);
    }
  };

  // Submit Reopen
  const handleReopenRoom = async (roomNo, e) => {
    if (e) e.stopPropagation();
    try {
      const res = await api.post(`/attendance/rounds/${roundId}/rooms/${roomNo}/reopen`);
      if (res.data?.success) {
        toast.success(`Room ${roomNo} reopened`);
        fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reopen room');
    }
  };

  // Handle Complete Round
  const handleCompleteRound = async () => {
    try {
      setCompleteSubmitting(true);
      const res = await api.post(`/attendance/rounds/${roundId}/complete`);
      if (res.data?.success) {
        toast.success('Round completed and finalized!');
        setCompleteDialogOpen(false);
        fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Cannot complete round');
    } finally {
      setCompleteSubmitting(false);
    }
  };

  const round = roundData?.round;
  const rooms = roundData?.rooms || [];

  // Filter rooms
  const filteredRooms = rooms.filter((r) => {
    if (filter === 'All') return true;
    if (filter === 'Pending') return r.status === 'Not started' || r.status === 'Request sent';
    if (filter === 'Needs review') return r.status === 'Needs review';
    if (filter === 'Completed') return r.status === 'Completed';
    if (filter === 'Skipped') return r.status === 'Skipped';
    return true;
  });

  const totalRooms = roundData?.totalRooms || 0;
  const doneRooms = (roundData?.completedRooms || 0) + (roundData?.skippedRooms || 0);
  const progressPct = totalRooms > 0 ? Math.round((doneRooms / totalRooms) * 100) : 0;
  const canComplete = doneRooms === totalRooms && totalRooms > 0 && round?.status === 'active';

  return (
    <div className="fade-in">
      <Navbar title={`Floor Round — Floor ${round?.floor ?? ''} (${round?.hostel || 'Hostel'})`} />
      <div
        className="page-area attendance-floor-page"
        style={{
          padding: 0,
          position: 'relative',
        }}
      >
      {/* Sticky Top Header */}
      <div
        className="floor-round-sticky-header"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'rgba(6,6,26,0.92)',
          backdropFilter: 'blur(16px)',
          borderBottom: 'var(--border)',
          padding: '12px 16px',
        }}
      >
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => navigate('/attendance')}
                style={{
                  background: 'var(--bg-card)',
                  border: 'var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
                aria-label="Back to round selection"
              >
                <MdArrowBack size={18} />
              </button>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {round?.hostel} · Floor {round?.floor}
                </h2>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {round?.session_name} · {round?.date} {round?.status === 'completed' && <strong style={{ color: 'var(--success)' }}>(Locked)</strong>}
                </div>
              </div>
            </div>

            {round?.status === 'active' && (
              <button
                type="button"
                onClick={() => setCompleteDialogOpen(true)}
                disabled={!canComplete}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-sm)',
                  background: canComplete ? 'var(--gradient-success)' : 'var(--bg-input)',
                  color: canComplete ? '#fff' : 'var(--text-muted)',
                  border: 'none',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: canComplete ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <MdLock size={15} /> Complete Round
              </button>
            )}
          </div>

          {/* Progress Bar & Counter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, marginBottom: 10 }}>
            <div
              style={{
                flex: 1,
                height: 7,
                background: 'var(--bg-input)',
                borderRadius: 99,
                overflow: 'hidden',
                border: '1px solid rgba(139,92,246,0.15)',
              }}
            >
              <div
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background: progressPct === 100 ? 'var(--success)' : 'var(--gradient-primary)',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {doneRooms} of {totalRooms} rooms done ({progressPct}%)
            </span>
          </div>

          {/* Filter Chips */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {['All', 'Pending', 'Needs review', 'Completed', 'Skipped'].map((tab) => {
              const active = filter === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 99,
                    fontSize: 11.5,
                    fontWeight: 600,
                    border: active ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                    background: active ? 'var(--bg-card-hover)' : 'transparent',
                    color: active ? 'var(--primary-light)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Room List Body */}
      <div style={{ maxWidth: 900, margin: '16px auto', padding: '0 16px' }}>
        {loading && rooms.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            Loading floor rooms…
          </div>
        ) : filteredRooms.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            No rooms match filter "{filter}"
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredRooms.map((room) => {
              const isLocked = round?.status === 'completed';
              const isLoading = Boolean(actionLoading[room.roomNo]);
              const isOpenRequest = room.requestStatus === 'open' && room.remainingSeconds > 0;

              // Determine status colors
              let chipBg = 'rgba(100,116,139,0.15)';
              let chipColor = '#94a3b8';
              if (room.status === 'Completed') {
                chipBg = 'rgba(16,185,129,0.15)';
                chipColor = '#10b981';
              } else if (room.status === 'Request sent') {
                chipBg = 'rgba(34,211,238,0.15)';
                chipColor = '#22d3ee';
              } else if (room.status === 'Needs review') {
                chipBg = 'rgba(245,158,11,0.15)';
                chipColor = '#f59e0b';
              } else if (room.status === 'Skipped') {
                chipBg = 'rgba(249,115,22,0.15)';
                chipColor = '#f97316';
              } else if (room.status === 'Vacant') {
                chipBg = 'rgba(148,163,184,0.15)';
                chipColor = '#94a3b8';
              }

              return (
                <div
                  key={room.roomNo}
                  className="attendance-floor-room-card"
                  onClick={() => setSelectedRoomNo(room.roomNo)}
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: room.status === 'Completed' ? 'rgba(16,185,129,0.04)' : 'var(--bg-card)',
                    border: room.status === 'Completed' ? '1px solid rgba(16,185,129,0.25)' : 'var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    cursor: 'pointer',
                    transition: 'var(--transition)',
                  }}
                >
                  {/* Left: Room Info & Live Status */}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                        Room {room.roomNo}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 99,
                          background: chipBg,
                          color: chipColor,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        {isOpenRequest && (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: '#22d3ee',
                              animation: 'pulse 1.5s infinite',
                            }}
                          />
                        )}
                        {room.status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                      <span>{room.occupantCount} students</span>
                      <span>·</span>
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{room.summaryText}</span>
                      {room.skipReason && (
                        <>
                          <span>·</span>
                          <span style={{ color: '#f97316' }}>Reason: {room.skipReason}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: Inline Action Buttons */}
                  <div className="attendance-room-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                    {room.status === 'Skipped' ? (
                      <button
                        type="button"
                        onClick={(e) => handleReopenRoom(room.roomNo, e)}
                        disabled={isLocked}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-input)',
                          color: 'var(--accent)',
                          border: '1px solid rgba(34,211,238,0.3)',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: isLocked ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Reopen
                      </button>
                    ) : (
                      <>
                        {/* Request Attendance / Resend Button */}
                        <button
                          type="button"
                          onClick={(e) => handleRequestAttendance(room.roomNo, e)}
                          disabled={isLocked || isLoading || room.isVacant || room.status === 'Vacant'}
                          style={{
                            padding: '8px 14px',
                            borderRadius: 'var(--radius-sm)',
                            background:
                              room.isVacant || room.status === 'Vacant'
                                ? 'rgba(148,163,184,0.1)'
                                : isOpenRequest
                                ? 'rgba(34,211,238,0.15)'
                                : 'var(--gradient-primary)',
                            color:
                              room.isVacant || room.status === 'Vacant'
                                ? '#94a3b8'
                                : isOpenRequest
                                ? 'var(--accent)'
                                : '#fff',
                            border:
                              room.isVacant || room.status === 'Vacant'
                                ? '1px solid rgba(148,163,184,0.2)'
                                : isOpenRequest
                                ? '1px solid var(--accent)'
                                : 'none',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor:
                              isLocked || isLoading || room.isVacant || room.status === 'Vacant'
                                ? 'not-allowed'
                                : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            minWidth: 100,
                            justifyContent: 'center',
                          }}
                        >
                          {isLoading ? (
                            'Sending…'
                          ) : room.isVacant || room.status === 'Vacant' ? (
                            'Vacant'
                          ) : isOpenRequest ? (
                            <>
                              <MdSend size={13} /> Resend ({room.remainingSeconds}s)
                            </>
                          ) : (
                            <>
                              <MdSend size={13} /> Request
                            </>
                          )}
                        </button>

                        {/* Skip Button (hidden if room is vacant) */}
                        {!room.isVacant && room.status !== 'Vacant' && (
                          <button
                            type="button"
                            onClick={(e) => handleOpenSkip(room.roomNo, e)}
                            disabled={isLocked}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--bg-input)',
                            color: 'var(--text-muted)',
                            border: '1px solid var(--border-color)',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: isLocked ? 'not-allowed' : 'pointer',
                          }}
                          title="Skip Room"
                        >
                          Skip
                        </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>

      {/* Skip Room Dialog */}
      {skipDialogOpen && (
        <div className="modal-backdrop show" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 440, padding: 20, borderRadius: 'var(--radius-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Skip Room {skipRoomNo}
              </h3>
              <button
                type="button"
                onClick={() => setSkipDialogOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <MdClose size={20} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
              Skipping a room requires a mandatory reason. You can reopen this room later before completing the round.
            </p>

            {/* Quick Reason Suggestions */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {['Room locked', 'Students on leave', 'Students at lab', 'Room vacant'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSkipReason(preset)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 99,
                    fontSize: 11.5,
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
                marginBottom: 16,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setSkipDialogOpen(false)}
                style={{
                  padding: '8px 14px',
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
                onClick={handleSubmitSkip}
                disabled={skipSubmitting || !skipReason.trim()}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--gradient-danger)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: skipSubmitting || !skipReason.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {skipSubmitting ? 'Skipping…' : 'Confirm Skip'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Round Dialog */}
      {completeDialogOpen && (
        <div className="modal-backdrop show" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 460, padding: 22, borderRadius: 'var(--radius-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Finalize &amp; Lock Attendance Round
              </h3>
              <button
                type="button"
                onClick={() => setCompleteDialogOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <MdClose size={20} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              This will calculate final attendance tallies and lock the round for Floor {round?.floor}. Official attendance records will be saved to the ledger.
            </p>

            <div
              style={{
                background: 'var(--bg-input)',
                padding: 14,
                borderRadius: 'var(--radius-md)',
                fontSize: 12.5,
                color: 'var(--text-secondary)',
                marginBottom: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div>• Total rooms: <strong>{totalRooms}</strong></div>
              <div>• Completed rooms: <strong style={{ color: 'var(--success)' }}>{roundData?.completedRooms || 0}</strong></div>
              <div>• Skipped rooms: <strong style={{ color: '#f97316' }}>{roundData?.skippedRooms || 0}</strong></div>
              {roundData?.skippedRooms > 0 && (
                <div style={{ color: 'var(--warning)', marginTop: 4, fontWeight: 600 }}>
                  ⚠️ Warning: {roundData.skippedRooms} rooms are skipped and will not have verified attendance.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setCompleteDialogOpen(false)}
                style={{
                  padding: '8px 14px',
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
                onClick={handleCompleteRound}
                disabled={completeSubmitting}
                style={{
                  padding: '8px 18px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--gradient-success)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: completeSubmitting ? 'wait' : 'pointer',
                }}
              >
                {completeSubmitting ? 'Locking…' : 'Lock & Finalize Round'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screen 3: Room Details Modal */}
      {selectedRoomNo && (
        <AttendanceRoomDetailsModal
          roundId={roundId}
          roomNo={selectedRoomNo}
          isLocked={round?.status === 'completed'}
          onClose={() => {
            setSelectedRoomNo(null);
            fetchRooms(true);
          }}
          onRefresh={() => fetchRooms(true)}
        />
      )}

      {/* Mobile Responsive Floor Round Styles */}
      <style>{`
        @media (max-width: 640px) {
          .attendance-floor-room-card {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 12px !important;
            padding: 12px 14px !important;
          }
          .attendance-room-actions {
            width: 100% !important;
            justify-content: flex-end !important;
            gap: 8px !important;
          }
          .attendance-room-actions button {
            flex: 1 !important;
          }
        }
      `}</style>
    </div>
  );
}
