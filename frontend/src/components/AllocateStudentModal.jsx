/**
 * AllocateStudentModal
 * Allows Warden/Admin to manually allocate a student to a hostel room.
 * Supports searching existing students or directly entering a student roll number/name,
 * and handles direct room number input with conflict re-assignment.
 */

import { useState, useEffect } from 'react';
import {
  MdClose, MdPerson, MdMeetingRoom, MdCheckCircle, MdApartment,
  MdSwapHoriz, MdSearch, MdPersonAdd, MdWarning,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import allocationApi from '../services/allocationApi';
import { getHostelLabel } from '../utils/hostel';

export default function AllocateStudentModal({
  isOpen,
  onClose,
  initialRoom = null,
  floors = [],
  hostel = null,
  onAllocated = () => {},
}) {
  // Input modes: 'search' | 'manual'
  const [entryMode, setEntryMode] = useState('search');

  // Search mode state
  const [students, setStudents] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [searchingStudents, setSearchingStudents] = useState(false);

  // Manual entry mode state
  const [manualRollNo, setManualRollNo] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualEmail, setManualEmail] = useState('');

  // Room & allocation details
  const [roomNumber, setRoomNumber] = useState(initialRoom?.room_number || '');
  const [bedNumber, setBedNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);

  // Conflict / Re-allocate state
  const [conflictInfo, setConflictInfo] = useState(null);

  useEffect(() => {
    if (initialRoom) {
      setRoomNumber(initialRoom.room_number || '');
    } else {
      setRoomNumber('');
    }
  }, [initialRoom]);

  // Search students with debounce
  useEffect(() => {
    if (!studentSearch.trim() || entryMode !== 'search') {
      setStudents([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingStudents(true);
      try {
        const found = await allocationApi.searchStudents(studentSearch.trim());
        setStudents(found || []);
      } catch {
        setStudents([]);
      } finally {
        setSearchingStudents(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [studentSearch, entryMode]);

  const handleSelectStudent = (s) => {
    setSelectedStudent(s);
    setConflictInfo(null);
  };

  const handleClearSelectedStudent = () => {
    setSelectedStudent(null);
    setConflictInfo(null);
  };

  const executeAllocation = async (reallocate = false) => {
    const finalRoomNumber = (initialRoom?.room_number || roomNumber).trim().toUpperCase();
    if (!finalRoomNumber && !initialRoom?._id) {
      toast.error('Please enter a room number');
      return;
    }

    const payload = {
      room_id: initialRoom?._id || undefined,
      room_number: finalRoomNumber,
      hostel_id: hostel?._id || initialRoom?.hostel_id?._id || initialRoom?.hostel_id,
      bed_number: bedNumber.trim() || null,
      remarks: remarks.trim() || 'Manual allocation',
      reallocate,
    };

    if (entryMode === 'search') {
      if (!selectedStudent) {
        toast.error('Please select a student from search or switch to Direct Entry');
        return;
      }
      payload.student_id = selectedStudent._id;
      payload.student_roll_no = selectedStudent.rollNo;
      payload.student_name = selectedStudent.name;
    } else {
      if (!manualRollNo.trim()) {
        toast.error('Please enter student Roll / MIS number');
        return;
      }
      payload.student_roll_no = manualRollNo.trim();
      payload.student_name = manualName.trim() || `Student ${manualRollNo.trim()}`;
      payload.student_email = manualEmail.trim() || `${manualRollNo.trim()}@iiitp.ac.in`.toLowerCase();
    }

    setLoading(true);
    try {
      await allocationApi.allocateStudent(payload);
      const studentLabel = entryMode === 'search' ? selectedStudent.name : (manualName || manualRollNo);
      toast.success(`Allocated ${studentLabel} to Room ${finalRoomNumber} successfully`);
      onAllocated();
      onClose();
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'STUDENT_ALREADY_ALLOCATED') {
        setConflictInfo({
          existingRoom: data.existingRoom || 'another room',
          message: data.message || 'Student is already allocated to a room',
        });
      } else {
        const msg = data?.message || err.message || 'Allocation failed';
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    executeAllocation(false);
  };

  if (!isOpen) return null;

  const targetHostelCode = hostel?.code || initialRoom?.hostel_id?.code || '';
  const targetHostelLabel = targetHostelCode ? getHostelLabel(targetHostelCode) : (hostel?.name || '');

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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 14 }}>
          {/* Target Hostel Banner */}
          {targetHostelLabel && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(139,92,246,0.1)',
                border: '1px solid rgba(139,92,246,0.25)',
                fontSize: 13,
                color: 'var(--text-primary)',
              }}
            >
              <MdApartment style={{ color: 'var(--primary-light)', fontSize: 18 }} />
              <span>Target Hostel:</span>
              <strong style={{ color: 'var(--primary-light)' }}>{targetHostelLabel}</strong>
            </div>
          )}

          {/* Mode Tabs: Search vs Direct Entry */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--bg-input, rgba(255,255,255,0.04))',
              borderRadius: 8,
              padding: 3,
              border: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={() => { setEntryMode('search'); setConflictInfo(null); }}
              style={{
                flex: 1,
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                background: entryMode === 'search' ? 'var(--primary)' : 'transparent',
                color: entryMode === 'search' ? '#fff' : 'var(--text-muted)',
                fontWeight: 600,
                fontSize: 12.5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
            >
              <MdSearch size={16} />
              Search Directory
            </button>
            <button
              type="button"
              onClick={() => { setEntryMode('manual'); setConflictInfo(null); }}
              style={{
                flex: 1,
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                background: entryMode === 'manual' ? 'var(--primary)' : 'transparent',
                color: entryMode === 'manual' ? '#fff' : 'var(--text-muted)',
                fontWeight: 600,
                fontSize: 12.5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
            >
              <MdPersonAdd size={16} />
              Direct Roll No Entry
            </button>
          </div>

          {/* Conflict Banner if Student Already Allocated */}
          {conflictInfo && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                backgroundColor: 'rgba(234, 179, 8, 0.12)',
                border: '1px solid rgba(234, 179, 8, 0.35)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#eab308', fontWeight: 600, fontSize: 13 }}>
                <MdWarning size={18} />
                <span>Existing Allocation Detected</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
                {conflictInfo.message}. Would you like to reassign this student to{' '}
                <strong>Room {(initialRoom?.room_number || roomNumber).trim().toUpperCase()}</strong>?
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => executeAllocation(true)}
                disabled={loading}
                style={{
                  alignSelf: 'flex-start',
                  fontSize: 12,
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 2,
                }}
              >
                <MdSwapHoriz size={16} />
                {loading ? 'Reassigning...' : `Reassign & Confirm to Room ${(initialRoom?.room_number || roomNumber).trim().toUpperCase()}`}
              </button>
            </div>
          )}

          {/* Option A: Search Directory */}
          {entryMode === 'search' && (
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Select Student *
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
                    <MdPerson size={22} style={{ color: 'var(--primary-light)' }} />
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>
                        {selectedStudent.name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Roll No: <strong>{selectedStudent.rollNo || 'N/A'}</strong>
                        {selectedStudent.currentAllocation?.room_number && (
                          <span style={{ color: 'var(--warning)', marginLeft: 8 }}>
                            (Currently in Room {selectedStudent.currentAllocation.room_number})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearSelectedStudent}
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
                    placeholder="Type name, roll number, or room..."
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    autoFocus
                  />
                  {searchingStudents && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      Searching students...
                    </div>
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
                          onClick={() => handleSelectStudent(s)}
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
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              Roll: {s.rollNo || 'N/A'}
                            </div>
                          </div>
                          {s.currentAllocation?.room_number ? (
                            <span style={{ fontSize: 11, color: 'var(--warning)', alignSelf: 'center' }}>
                              Room {s.currentAllocation.room_number}
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
                  {!searchingStudents && studentSearch.trim() && students.length === 0 && (
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px dashed var(--border)',
                        marginTop: 6,
                        fontSize: 12,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>
                        No user found for "{studentSearch}"
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setManualRollNo(studentSearch.trim());
                          setEntryMode('manual');
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--primary-light)',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        Enter as New Roll No &gt;
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Option B: Direct Roll No & Name Entry */}
          {entryMode === 'manual' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Roll / MIS Number *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 112515025"
                    value={manualRollNo}
                    onChange={(e) => setManualRollNo(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Student Full Name *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Akash Kale"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="Defaults to rollNo@iiitp.ac.in"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Room Number Input */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Room Number *
            </label>
            {initialRoom ? (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                    Room {initialRoom.room_number}
                  </span>
                  {initialRoom.floor_id?.label && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                      ({initialRoom.floor_id.label})
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>Locked</span>
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter Room Number (e.g. 101, 204, B01, 11)"
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  required
                  autoComplete="off"
                />
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  Type the room number to assign this student into.
                </div>
              </div>
            )}
          </div>

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

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
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
              disabled={loading}
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
