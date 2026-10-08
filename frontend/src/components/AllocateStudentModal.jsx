/**
 * AllocateStudentModal
 * Allows Warden/Admin to manually allocate an unassigned student to a hostel room.
 */

import { useState, useEffect } from 'react';
import { MdClose, MdPerson, MdMeetingRoom, MdCheckCircle } from 'react-icons/md';
import toast from 'react-hot-toast';
import api from '../services/api';
import allocationApi from '../services/allocationApi';

export default function AllocateStudentModal({
  isOpen,
  onClose,
  initialRoom = null,
  floors = [],
  onAllocated = () => {},
}) {
  const [students, setStudents] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(initialRoom?._id || '');
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedFloorId, setSelectedFloorId] = useState(initialRoom?.floor_id?._id || initialRoom?.floor_id || '');
  const [bedNumber, setBedNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchingStudents, setSearchingStudents] = useState(false);

  useEffect(() => {
    if (initialRoom) {
      setSelectedRoomId(initialRoom._id);
      setSelectedFloorId(initialRoom.floor_id?._id || initialRoom.floor_id || '');
    }
  }, [initialRoom]);

  // Load rooms when floor changes (if not locked to initialRoom)
  useEffect(() => {
    if (!initialRoom && selectedFloorId) {
      allocationApi.getRooms(selectedFloorId, 'available')
        .then((rooms) => {
          setAvailableRooms(rooms.filter((r) => r.vacantBeds > 0));
        })
        .catch(() => {});
    }
  }, [selectedFloorId, initialRoom]);

  // Search students
  useEffect(() => {
    if (!studentSearch.trim()) {
      setStudents([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingStudents(true);
      try {
        const res = await api.get(`/student/search?q=${encodeURIComponent(studentSearch.trim())}`);
        const found = res.data?.students || res.data?.data || [];
        setStudents(found);
      } catch {
        // Fallback to general students
        setStudents([]);
      } finally {
        setSearchingStudents(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [studentSearch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedStudent) {
      toast.error('Please select a student');
      return;
    }
    const targetRoomId = initialRoom?._id || selectedRoomId;
    if (!targetRoomId) {
      toast.error('Please select a room');
      return;
    }

    setLoading(true);
    try {
      await allocationApi.allocateStudent({
        student_id: selectedStudent._id,
        room_id: targetRoomId,
        bed_number: bedNumber.trim() || null,
        remarks: remarks.trim() || 'Manual allocation',
      });
      toast.success(`Allocated ${selectedStudent.name} successfully`);
      onAllocated();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Allocation failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-box" style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <MdMeetingRoom size={24} style={{ color: 'var(--primary-light)' }} />
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {initialRoom ? `Allocate to Room ${initialRoom.room_number}` : 'Allocate Student to Room'}
            </h3>
          </div>
          <button className="modal-close-btn" onClick={onClose} disabled={loading}>
            <MdClose size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 16 }}>
          {/* Student Search & Selection */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Select Student (by Name or Roll No) *
            </label>
            {selectedStudent ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(139,92,246,0.15)',
                  border: '1px solid var(--primary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <MdPerson size={20} style={{ color: 'var(--primary-light)' }} />
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>
                      {selectedStudent.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Roll No: {selectedStudent.rollNo || 'N/A'} {selectedStudent.hostel ? `(${selectedStudent.hostel})` : ''}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStudent(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Type name or roll number..."
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  autoFocus
                />
                {searchingStudents && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Searching students...</div>
                )}
                {students.length > 0 && (
                  <div
                    style={{
                      maxHeight: 180,
                      overflowY: 'auto',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 8,
                      marginTop: 6,
                      backgroundColor: 'var(--bg-surface)',
                    }}
                  >
                    {students.map((s) => (
                      <div
                        key={s._id}
                        onClick={() => setSelectedStudent(s)}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          borderBottom: '1px solid rgba(139,92,246,0.1)',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Roll: {s.rollNo || 'N/A'}</div>
                        </div>
                        {s.roomNo ? (
                          <span style={{ fontSize: 11, color: 'var(--warning)', alignSelf: 'center' }}>
                            Room {s.roomNo}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--success)', alignSelf: 'center' }}>
                            Unassigned
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Floor & Room selection if not initialRoom */}
          {!initialRoom && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Floor *
                </label>
                <select
                  className="form-select"
                  value={selectedFloorId}
                  onChange={(e) => setSelectedFloorId(e.target.value)}
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
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Room *
                </label>
                <select
                  className="form-select"
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  disabled={!selectedFloorId}
                >
                  <option value="">Select Room</option>
                  {availableRooms.map((r) => (
                    <option key={r._id} value={r._id}>
                      Room {r.room_number} ({r.vacantBeds} vacant)
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Bed Number & Remarks */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Bed No (optional)
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Bed 1"
                value={bedNumber}
                onChange={(e) => setBedNumber(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Remarks / Allocation Note
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Regular semester allocation"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !selectedStudent || (!initialRoom && !selectedRoomId)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <MdCheckCircle size={18} />
              {loading ? 'Allocating...' : 'Confirm Allocation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
