/**
 * StudentAttendanceHistoryModal Component
 * Shows personal attendance ledger history for the student.
 */

import { useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdClose,
  MdHistory,
  MdCheckCircle,
  MdCancel,
  MdHome,
  MdSchedule,
} from 'react-icons/md';

export default function StudentAttendanceHistoryModal({ onClose = () => {} }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const res = await api.get('/attendance/history');
      if (res.data?.success) {
        setHistory(res.data.records || []);
      }
    } catch {
      toast.error('Failed to load attendance history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  return (
    <div
      className="modal-backdrop show"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
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
        className="card"
        style={{
          width: '100%',
          maxWidth: 540,
          maxHeight: '85vh',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MdHistory size={20} style={{ color: 'var(--primary-light)' }} />
            <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              My Attendance History
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <MdClose size={22} />
          </button>
        </div>

        {/* History List */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
              Loading attendance history…
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
              No attendance records found yet.
            </div>
          ) : (
            history.map((record) => {
              let chipBg = 'rgba(239,68,68,0.15)';
              let chipColor = '#ef4444';
              let icon = <MdCancel size={14} />;

              if (record.status === 'present') {
                chipBg = 'rgba(16,185,129,0.15)';
                chipColor = '#10b981';
                icon = <MdCheckCircle size={14} />;
              } else if (record.status === 'on_leave') {
                chipBg = 'rgba(168,85,247,0.15)';
                chipColor = '#c084fc';
                icon = <MdHome size={14} />;
              }

              return (
                <div
                  key={record.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-card)',
                    border: 'var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                        📅 {record.formattedDate || record.date}
                      </span>
                      {(record.time || record.createdAt) && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: 'var(--primary-light)',
                            background: 'rgba(99, 102, 241, 0.12)',
                            padding: '1px 8px',
                            borderRadius: 6,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          ⏰ {record.time || new Date(record.createdAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                        </span>
                      )}
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {record.hostel ? `${record.hostel} · ` : ''}{record.session}
                      </span>
                    </div>

                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      Hostel {record.hostel || 'Assigned'} · Room {record.roomNo} · Method: {record.method === 'self_approved' ? 'Automatic (GPS Geofence)' : `Manual (${record.verifiedBy})`}
                      {record.remark && <span> · "{record.remark}"</span>}
                    </div>
                  </div>

                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 700,
                      background: chipBg,
                      color: chipColor,
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {icon} {record.status.replace('_', ' ')}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
