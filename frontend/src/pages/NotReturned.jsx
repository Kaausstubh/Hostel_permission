import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdWarning, MdRefresh, MdPhone, MdAccessTime, MdInfoOutline } from 'react-icons/md';
import { getHostelLabel } from '../utils/hostel';

export default function NotReturned() {
  const [students, setStudents] = useState(() => {
    try {
      const cached = sessionStorage.getItem('heimdall_not_returned_cache');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(() => {
    try {
      return !sessionStorage.getItem('heimdall_not_returned_cache');
    } catch {
      return true;
    }
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [curfewInfo, setCurfewInfo] = useState(() => {
    try {
      const cached = sessionStorage.getItem('heimdall_curfew_info_cache');
      return cached ? JSON.parse(cached) : { curfewTime: '8:00 PM', isPastCurfew: false };
    } catch {
      return { curfewTime: '8:00 PM', isPastCurfew: false };
    }
  });

  const fetchNotReturned = async () => {
    try {
      if (students.length === 0) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const res = await api.get('/inout/not-returned');
      const fetchedStudents = res.data.students || [];
      const newCurfewInfo = {
        curfewTime: res.data.curfewTime || '8:00 PM',
        isPastCurfew: Boolean(res.data.isPastCurfew),
      };
      setStudents(fetchedStudents);
      setCurfewInfo(newCurfewInfo);
      try {
        sessionStorage.setItem('heimdall_not_returned_cache', JSON.stringify(fetchedStudents));
        sessionStorage.setItem('heimdall_curfew_info_cache', JSON.stringify(newCurfewInfo));
      } catch {}
    } catch (err) {
      toast.error('Failed to fetch data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const triggerAlertManually = async () => {
    setTriggering(true);
    try {
      const res = await api.post('/dev/trigger-alert');
      toast.success(`Alert sent to ${res.data.result?.processed || 0} student(s)`);
      fetchNotReturned();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Trigger failed');
    } finally {
      setTriggering(false);
    }
  };

  useEffect(() => {
    fetchNotReturned();
    const interval = setInterval(fetchNotReturned, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fade-in">
      <Navbar title="Not Returned Students" />
      <div className="page-area">

        {/* Scope Note Banner */}
        <div style={{
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
          color: 'var(--text-secondary)',
        }}>
          <MdInfoOutline size={20} color="var(--primary-light)" style={{ flexShrink: 0 }} />
          <div>
            <strong>In/Out Daily Pass Curfew: 8:00 PM</strong> — This list tracks students who scanned OUT on daily passes and have not returned to campus. Approved multi-day Home Visit passes are excluded.
          </div>
        </div>

        {/* Alert Banner */}
        {students.length > 0 && (
          <div style={{
            background: curfewInfo.isPastCurfew ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
            border: `1px solid ${curfewInfo.isPastCurfew ? 'rgba(239,68,68,0.5)' : 'rgba(245,158,11,0.5)'}`,
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            animation: curfewInfo.isPastCurfew ? 'pulse-red 2s ease-in-out infinite' : 'none',
          }}>
            <MdWarning size={30} color={curfewInfo.isPastCurfew ? '#ef4444' : '#f59e0b'} style={{ flexShrink: 0 }} />
            <div>
              <div style={{ color: curfewInfo.isPastCurfew ? '#ef4444' : '#f59e0b', fontWeight: 800, fontSize: 16 }}>
                {curfewInfo.isPastCurfew ? '🚨 8:00 PM Curfew Breached' : '⏰ In/Out Return Pending'} — {students.length} Student{students.length > 1 ? 's' : ''} Not Returned Today
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 3 }}>
                {curfewInfo.isPastCurfew
                  ? 'These students have not returned to the hostel before the 8:00 PM curfew. Automated WhatsApp return alerts will be dispatched.'
                  : 'Students are currently out on daily pass. Campus curfew is strictly 8:00 PM.'}
              </div>
            </div>
          </div>
        )}

        <div className="section-header">
          <div>
            <div className="section-title"><MdWarning color="#ef4444" /> Students Not Returned</div>
            <div className="section-subtitle">
              {loading ? 'Loading...' : `${students.length} student(s) currently unaccounted for (Curfew: 8:00 PM)`}
            </div>
          </div>
          <div className="section-actions">
            <button className="btn btn-ghost btn-sm" onClick={fetchNotReturned} disabled={loading && students.length === 0}>
              <MdRefresh size={16} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} /> {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button className="btn btn-danger btn-sm" onClick={triggerAlertManually} disabled={triggering}>
              {triggering
                ? <><span className="loading-spinner" style={{ width: 14, height: 14 }} /> Sending...</>
                : '⚡ Trigger Alert Now'
              }
            </button>
          </div>
        </div>

        {(loading && students.length === 0) ? (
          <div className="loading-page">
            <div className="loading-spinner" style={{ width: 40, height: 40 }} />
          </div>
        ) : students.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 60 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 12, color: '#10b981' }}>
              All Students Have Returned!
            </div>
            <p>No students on daily in/out passes are currently outside past curfew.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Roll Number</th>
                  <th>Hostel</th>
                  <th>Exit Time</th>
                  <th>Curfew</th>
                  <th>Status</th>
                  <th>Parent / Contact</th>
                </tr>
              </thead>
              <tbody>
                {students.map((log) => {
                  const student = log.student_id;
                  const photoSrc = student?.studentPhoto || (!student?.picture?.includes('googleusercontent.com') ? student?.picture : null);
                  return (
                    <tr key={log._id} style={{
                      background: curfewInfo.isPastCurfew ? 'rgba(239,68,68,0.05)' : 'rgba(245,158,11,0.04)',
                      borderLeft: `3px solid ${curfewInfo.isPastCurfew ? '#ef4444' : '#f59e0b'}`,
                    }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {photoSrc ? (
                            <img
                              src={photoSrc}
                              alt=""
                              style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%',
                              background: 'var(--primary)', color: '#fff',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 700, fontSize: 13,
                            }}>
                              {student?.name?.charAt(0).toUpperCase() || 'S'}
                            </div>
                          )}
                          <div style={{ fontWeight: 600 }}>{student?.name || 'Unknown'}</div>
                        </div>
                      </td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                        {student?.rollNo || '—'}
                      </td>
                      <td>
                        <span className="badge badge-out">{getHostelLabel(student?.hostel)}</span>
                      </td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#ef4444' }}>
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN') : '—'}
                      </td>
                      <td style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <MdAccessTime size={14} /> 8:00 PM
                        </span>
                      </td>
                      <td>
                        {curfewInfo.isPastCurfew ? (
                          <span className="badge badge-rejected" style={{ animation: 'pulse-red 2s infinite' }}>
                            🔴 Curfew Breached
                          </span>
                        ) : (
                          <span className="badge" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
                            ⏳ Out (Pending 8 PM)
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                          {student?.phone && (
                            <a href={`tel:${student.phone}`} style={{ color: 'var(--primary-light)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <MdPhone size={13} /> {student.phone}
                            </a>
                          )}
                          {student?.parentPhone && (
                            <a href={`tel:${student.parentPhone}`} style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              👨‍👩‍👧 {student.parentPhone}
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
