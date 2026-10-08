/**
 * StudentRoomInfoModal Component
 * Shows student's own room assignment and roommates (privacy-safe: names & roll numbers only).
 */

import { useState, useEffect } from 'react';
import { MdMeetingRoom, MdPerson, MdClose, MdInfoOutline } from 'react-icons/md';
import allocationApi from '../services/allocationApi';

export default function StudentRoomInfoModal({ isOpen, onClose, studentId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && studentId) {
      setLoading(true);
      allocationApi.getStudentAllocation(studentId)
        .then((res) => setData(res))
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    }
  }, [isOpen, studentId]);

  if (!isOpen) return null;

  const allocation = data?.allocation;
  const room = allocation?.room_id;
  const roommates = data?.roommates || [];

  return (
    <div className="modal-backdrop">
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <MdMeetingRoom size={24} style={{ color: 'var(--primary-light)' }} />
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              My Room Assignment
            </h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <MdClose size={20} />
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="loading-spinner" style={{ width: 32, height: 32, margin: '0 auto 8px' }} />
            Loading room details...
          </div>
        ) : !data?.allocated ? (
          <div style={{ padding: 24, textAlign: 'center', backgroundColor: 'rgba(139,92,246,0.06)', borderRadius: 12 }}>
            <MdInfoOutline size={32} style={{ color: 'var(--warning)', marginBottom: 8 }} />
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No Room Assigned</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              You do not currently have an active hostel room allocation. Please contact the hostel warden.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
            {/* Room Card */}
            <div
              style={{
                padding: 16,
                backgroundColor: 'rgba(139,92,246,0.12)',
                borderRadius: 12,
                border: '1px solid var(--primary)',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>HOSTEL & ROOM</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
                Room {room?.room_number}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
                {room?.hostel_id?.code} ({room?.hostel_id?.name || 'Boys Hostel'}) • {room?.floor_id?.label}
              </div>
              {allocation?.bed_number && (
                <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6, fontWeight: 600 }}>
                  Assigned Bed: {allocation.bed_number}
                </div>
              )}
            </div>

            {/* Roommates */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Roommates ({roommates.length})
              </div>
              {roommates.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No roommates currently assigned to this room.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {roommates.map((rm, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 12px',
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          backgroundColor: 'rgba(139,92,246,0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--primary-light)',
                        }}
                      >
                        <MdPerson size={18} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                          {rm.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          MIS: {rm.rollNo} {rm.bed_number ? `• Bed ${rm.bed_number}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
