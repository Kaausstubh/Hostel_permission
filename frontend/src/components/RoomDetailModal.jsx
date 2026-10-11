/**
 * RoomDetailModal Component
 * Shows room details, active occupants, transfer/vacate actions,
 * allocation history, and room status management (capacity & maintenance).
 */

import { useState, useEffect } from 'react';
import {
  MdClose, MdPerson, MdSwapHoriz, MdExitToApp, MdBuild,
  MdHistory, MdAdd, MdSave, MdCheckCircle, MdInfoOutline,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import allocationApi from '../services/allocationApi';
import AllocateStudentModal from './AllocateStudentModal';

export default function RoomDetailModal({
  isOpen,
  onClose,
  roomId,
  floors = [],
  onRoomUpdated = () => {},
}) {
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('occupants'); // 'occupants' | 'history' | 'settings'

  // Sub-dialog states
  const [transferringOccupant, setTransferringOccupant] = useState(null);
  const [transferFloorId, setTransferFloorId] = useState('');
  const [transferRoomId, setTransferRoomId] = useState('');
  const [transferBed, setTransferBed] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [availableTargetRooms, setAvailableTargetRooms] = useState([]);
  const [submittingAction, setSubmittingAction] = useState(false);

  const [vacatingOccupant, setVacatingOccupant] = useState(null);
  const [vacateReason, setVacateReason] = useState('');

  const [showAllocateModal, setShowAllocateModal] = useState(false);

  // Room settings state
  const [editCapacity, setEditCapacity] = useState(4);
  const [editStatus, setEditStatus] = useState('available');
  const [editRemarks, setEditRemarks] = useState('');

  const loadDetails = async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const data = await allocationApi.getRoomDetails(roomId);
      setRoom(data);
      setEditCapacity(data.capacity || 4);
      setEditStatus(data.status || 'available');
      setEditRemarks(data.remarks || '');
    } catch (err) {
      toast.error('Failed to load room details');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && roomId) {
      loadDetails();
      setActiveTab('occupants');
      setTransferringOccupant(null);
      setVacatingOccupant(null);
    }
  }, [isOpen, roomId]);

  // Load available target rooms when transfer floor changes
  useEffect(() => {
    if (transferFloorId) {
      allocationApi.getRooms(transferFloorId)
        .then((rooms) => {
          setAvailableTargetRooms(
            rooms.filter((r) => r._id !== roomId && r.vacantBeds > 0 && r.status !== 'maintenance' && r.status !== 'blocked')
          );
        })
        .catch(() => {});
    } else {
      setAvailableTargetRooms([]);
    }
  }, [transferFloorId, roomId]);

  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    if (!transferRoomId || !transferReason.trim()) {
      toast.error('Please select target room and provide a transfer reason');
      return;
    }
    setSubmittingAction(true);
    try {
      await allocationApi.transferStudent(transferringOccupant._id, {
        new_room_id: transferRoomId,
        bed_number: transferBed.trim() || null,
        reason: transferReason.trim(),
      });
      toast.success('Student transferred successfully');
      setTransferringOccupant(null);
      setTransferReason('');
      await loadDetails();
      onRoomUpdated();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Transfer failed');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleVacateSubmit = async (e) => {
    e.preventDefault();
    if (!vacateReason.trim()) {
      toast.error('Vacate reason is mandatory');
      return;
    }
    setSubmittingAction(true);
    try {
      await allocationApi.vacateStudent(vacatingOccupant._id, {
        reason: vacateReason.trim(),
      });
      toast.success('Allocation vacated successfully');
      setVacatingOccupant(null);
      setVacateReason('');
      await loadDetails();
      onRoomUpdated();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Vacate failed');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSubmittingAction(true);
    try {
      await allocationApi.updateRoom(roomId, {
        capacity: Number(editCapacity),
        status: editStatus,
        remarks: editRemarks.trim(),
      });
      toast.success('Room settings updated successfully');
      await loadDetails();
      onRoomUpdated();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to update room');
    } finally {
      setSubmittingAction(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-backdrop">
        <div className="modal-box" style={{ maxWidth: 680, width: '95%' }}>
          {/* Header */}
          <div className="modal-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                  Room {room?.room_number || '...'}
                </h3>
                {room && (
                  <span
                    className={`badge badge-${
                      room.status === 'maintenance'
                        ? 'warning'
                        : room.status === 'blocked'
                        ? 'danger'
                        : room.vacantBeds === 0
                        ? 'info'
                        : 'success'
                    }`}
                  >
                    {room.status === 'maintenance'
                      ? 'Maintenance'
                      : room.status === 'blocked'
                      ? 'Blocked'
                      : room.vacantBeds === 0
                      ? 'Full'
                      : `${room.vacantBeds} Bed${room.vacantBeds > 1 ? 's' : ''} Vacant`}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                {room?.hostel_id?.code} ({room?.hostel_id?.name}) • {room?.floor_id?.label} • Capacity: {room?.capacity || 4}
              </div>
            </div>
            <button className="modal-close-btn" onClick={onClose} disabled={submittingAction}>
              <MdClose size={20} />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              borderBottom: '1px solid var(--glass-border)',
              marginTop: 16,
              marginBottom: 16,
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('occupants')}
              style={{
                padding: '8px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
                color: activeTab === 'occupants' ? 'var(--primary-light)' : 'var(--text-muted)',
                borderBottom: activeTab === 'occupants' ? '2px solid var(--primary)' : '2px solid transparent',
              }}
            >
              Occupants ({room?.occupantsCount || 0}/{room?.capacity || 4})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              style={{
                padding: '8px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
                color: activeTab === 'history' ? 'var(--primary-light)' : 'var(--text-muted)',
                borderBottom: activeTab === 'history' ? '2px solid var(--primary)' : '2px solid transparent',
              }}
            >
              Audit & History
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              style={{
                padding: '8px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
                color: activeTab === 'settings' ? 'var(--primary-light)' : 'var(--text-muted)',
                borderBottom: activeTab === 'settings' ? '2px solid var(--primary)' : '2px solid transparent',
              }}
            >
              Room Settings
            </button>
          </div>

          {/* Tab 1: Current Occupants */}
          {activeTab === 'occupants' && (
            <div>
              {loading ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading occupants...</div>
              ) : (
                <>
                  {room?.activeOccupants?.length === 0 ? (
                    <div
                      style={{
                        padding: 32,
                        textAlign: 'center',
                        backgroundColor: 'rgba(139,92,246,0.05)',
                        borderRadius: 12,
                        border: '1px dashed var(--glass-border)',
                      }}
                    >
                      <MdInfoOutline size={32} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No active occupants</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                        This room is currently empty and has {room.capacity} vacant beds.
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {room?.activeOccupants?.map((alloc) => {
                        const student = alloc.student_id;
                        return (
                          <div
                            key={alloc._id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '12px 16px',
                              backgroundColor: 'rgba(139,92,246,0.08)',
                              border: '1px solid var(--glass-border)',
                              borderRadius: 10,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 8,
                                  backgroundColor: 'rgba(139,92,246,0.2)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: 'var(--primary-light)',
                                }}
                              >
                                <MdPerson size={20} />
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                                  {student?.name || 'Unknown Student'}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  MIS / Roll: <b>{student?.rollNo || 'N/A'}</b>
                                  {alloc.bed_number && ` • Bed ${alloc.bed_number}`}
                                  {alloc.allocated_on && ` • Since ${new Date(alloc.allocated_on).toLocaleDateString()}`}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline"
                                onClick={() => setTransferringOccupant(alloc)}
                                title="Transfer to another room"
                                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                              >
                                <MdSwapHoriz size={16} />
                                Transfer
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline"
                                onClick={() => setVacatingOccupant(alloc)}
                                title="Vacate allocation"
                                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}
                              >
                                <MdExitToApp size={16} />
                                Vacate
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Allocate Student Action */}
                  {room && room.vacantBeds > 0 && room.status !== 'maintenance' && room.status !== 'blocked' && (
                    <div style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                        onClick={() => setShowAllocateModal(true)}
                      >
                        <MdAdd size={18} />
                        Allocate Student ({room.vacantBeds} bed{room.vacantBeds > 1 ? 's' : ''} left)
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Tab 2: History & Audit Log */}
          {activeTab === 'history' && (
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px 0', color: 'var(--text-secondary)' }}>
                  Audit Log & History
                </h4>
                {room?.auditLogs?.length === 0 && room?.history?.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No historical events recorded yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {room?.auditLogs?.map((audit) => (
                      <div
                        key={audit._id}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          backgroundColor: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          fontSize: 12,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ fontWeight: 700, color: 'var(--primary-light)' }}>
                            {audit.action}
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>
                            {new Date(audit.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ color: 'var(--text-primary)' }}>
                          Student: {audit.student_id?.name || 'N/A'} ({audit.student_id?.rollNo || 'N/A'})
                        </div>
                        <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                          Reason: <i>{audit.reason}</i>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 3: Room Settings */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Room Capacity
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    min={room?.occupantsCount || 1}
                    max={12}
                    value={editCapacity}
                    onChange={(e) => setEditCapacity(e.target.value)}
                    required
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Active occupants: {room?.occupantsCount || 0}
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Room Status
                  </label>
                  <select
                    className="form-select"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                  >
                    <option value="available">Available / Standard</option>
                    <option value="maintenance">Under Maintenance</option>
                    <option value="blocked">Blocked / Closed</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Room Remarks
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Near stairs, AC working, PWD accessible"
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingAction}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <MdSave size={18} />
                  {submittingAction ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          )}

          {/* Sub-Dialog: Transfer Student */}
          {transferringOccupant && (
            <div
              style={{
                marginTop: 20,
                padding: 16,
                backgroundColor: 'rgba(34,211,238,0.08)',
                border: '1px solid var(--accent)',
                borderRadius: 12,
              }}
            >
              <h4 style={{ margin: '0 0 10px 0', fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
                Transfer: {transferringOccupant.student_id?.name} ({transferringOccupant.student_id?.rollNo})
              </h4>
              <form onSubmit={handleTransferSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Target Floor *
                    </label>
                    <select
                      className="form-select"
                      value={transferFloorId}
                      onChange={(e) => {
                        setTransferFloorId(e.target.value);
                        setTransferRoomId('');
                      }}
                      required
                    >
                      <option value="">Select Floor</option>
                      {floors.map((f) => (
                        <option key={f._id} value={f._id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Target Room *
                    </label>
                    <select
                      className="form-select"
                      value={transferRoomId}
                      onChange={(e) => setTransferRoomId(e.target.value)}
                      disabled={!transferFloorId}
                      required
                    >
                      <option value="">Select Room</option>
                      {availableTargetRooms.map((r) => (
                        <option key={r._id} value={r._id}>
                          Room {r.room_number} ({r.vacantBeds} vacant)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      New Bed (optional)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Bed 2"
                      value={transferBed}
                      onChange={(e) => setTransferBed(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Transfer Reason (mandatory) *
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Student requested room swap with roommate"
                      value={transferReason}
                      onChange={(e) => setTransferReason(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => setTransferringOccupant(null)}
                    disabled={submittingAction}
                  >
                    Cancel Transfer
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={submittingAction || !transferRoomId || !transferReason.trim()}
                  >
                    {submittingAction ? 'Transferring...' : 'Execute Transfer'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Sub-Dialog: Vacate Student */}
          {vacatingOccupant && (
            <div
              style={{
                marginTop: 20,
                padding: 16,
                backgroundColor: 'rgba(239,68,68,0.08)',
                border: '1px solid var(--danger)',
                borderRadius: 12,
              }}
            >
              <h4 style={{ margin: '0 0 10px 0', fontSize: 15, fontWeight: 700, color: 'var(--danger)' }}>
                Vacate: {vacatingOccupant.student_id?.name} ({vacatingOccupant.student_id?.rollNo})
              </h4>
              <form onSubmit={handleVacateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Reason for Vacating (mandatory) *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Left hostel / Graduated / Semester break"
                    value={vacateReason}
                    onChange={(e) => setVacateReason(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => setVacatingOccupant(null)}
                    disabled={submittingAction}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-danger"
                    disabled={submittingAction || !vacateReason.trim()}
                  >
                    {submittingAction ? 'Vacating...' : 'Confirm Vacate'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Allocate Student Modal */}
      {showAllocateModal && (
        <AllocateStudentModal
          isOpen={showAllocateModal}
          onClose={() => setShowAllocateModal(false)}
          initialRoom={room}
          floors={floors}
          hostel={room?.hostel_id}
          onAllocated={() => {
            loadDetails();
            onRoomUpdated();
          }}
        />
      )}
    </>
  );
}
