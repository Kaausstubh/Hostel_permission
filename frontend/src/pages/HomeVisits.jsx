/**
 * Home Visits Page
 * Warden can view all home visit requests and approve/reject pending ones
 */
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdHome, MdRefresh, MdCheckCircle, MdCancel, MdPhone, MdPhoneInTalk } from 'react-icons/md';
import StudentAvatar from '../components/StudentAvatar';
import { getHostelLabel } from '../utils/hostel';

const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'completed'];

const statusBadge = (status) => {
  const map = {
    pending: 'pending',
    approved: 'approved',
    rejected: 'rejected',
    completed: 'resolved',
  };
  return <span className={`badge badge-${map[status] || 'pending'}`}>{status.replace('_', ' ')}</span>;
};

export default function HomeVisits() {
  const [visits, setVisits] = useState(() => {
    try {
      const cached = sessionStorage.getItem('heimdall_home_visits_cache_all');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(() => {
    try {
      const cached = sessionStorage.getItem('heimdall_home_visits_cache_all');
      return !cached;
    } catch {
      return true;
    }
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [actioning, setActioning] = useState(null);

  const fetchVisits = async () => {
    try {
      if (visits.length === 0) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await api.get(`/homevisit/list${params}`);
      const fetchedVisits = res.data.visits || [];
      setVisits(fetchedVisits);
      try {
        sessionStorage.setItem(`heimdall_home_visits_cache_${filter}`, JSON.stringify(fetchedVisits));
      } catch {}
    } catch (err) {
      toast.error('Failed to fetch home visits');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
    try {
      const cached = sessionStorage.getItem(`heimdall_home_visits_cache_${newFilter}`);
      if (cached) {
        setVisits(JSON.parse(cached));
      }
    } catch {}
  };

  useEffect(() => { fetchVisits(); }, [filter]);

  const handleWardenAction = async (visitId, action) => {
    setActioning(visitId + action);
    try {
      await api.post('/homevisit/warden-approve', { visit_id: visitId, action });
      toast.success(`Visit ${action}d successfully`);
      fetchVisits();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action failed');
    } finally {
      setActioning(null);
    }
  };

  const handleCallParent = async (visit, phone, label = 'Parent 1') => {
    if (!phone) return toast.error(`${label} phone number not available`);

    const visitId = visit._id;
    const actionKey = label.includes('2') || label.includes('Alt') ? 'call2' : 'call1';
    setActioning(visitId + actionKey);

    try {
      // 1. Initiate call via tel: link
      window.location.href = `tel:${phone}`;

      // 2. Automatically mark call confirmed on backend if not already confirmed
      if (!visit.parent_call_confirmed) {
        await api.post('/homevisit/warden-confirm-call', { visit_id: visitId });

        // Optimistically update local visits state so Approve checkmark is immediately enabled
        setVisits((prev) =>
          prev.map((item) =>
            item._id === visitId ? { ...item, parent_call_confirmed: true } : item
          )
        );
        toast.success(`Dialing ${label} (${phone}). Call confirmed — Approve button is now enabled!`, { duration: 4000 });
      } else {
        toast(`Dialing ${label} (${phone}).`, { icon: '📞' });
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update call confirmation');
    } finally {
      setActioning(null);
    }
  };

  const handleManualConfirmCall = async (visit) => {
    const visitId = visit._id;
    setActioning(visitId + 'manualconfirm');
    try {
      await api.post('/homevisit/warden-confirm-call', { visit_id: visitId });
      setVisits((prev) =>
        prev.map((item) =>
          item._id === visitId ? { ...item, parent_call_confirmed: true } : item
        )
      );
      toast.success('Parent call confirmed! Approve button is now enabled.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to confirm call');
    } finally {
      setActioning(null);
    }
  };

  return (
    <div className="fade-in">
      <Navbar title="Home Visits" />
      <div className="page-area">

        <div className="section-header">
          <div>
            <div className="section-title"><MdHome /> Home Visit Requests</div>
            <div className="section-subtitle">{visits.length} request(s) shown</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchVisits} disabled={loading && visits.length === 0}>
            <MdRefresh size={16} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} /> {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="tabs">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              className={`tab ${filter === f ? 'active' : ''}`}
              onClick={() => handleFilterChange(f)}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>

        {(loading && visits.length === 0) ? (
          <div className="loading-page"><div className="loading-spinner" style={{ width: 40, height: 40 }} /></div>
        ) : visits.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 60 }}>🏠</div>
            <div style={{ fontWeight: 700, marginTop: 12 }}>No requests found</div>
            <p>No home visit requests match the current filter.</p>
          </div>
        ) : (
          <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Hostel</th>
                      <th>Place</th>
                      <th>Reason</th>
                      <th>Leave Date</th>
                      <th>Return Date</th>
                      <th>Parent Phone</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map((v) => (
                      <tr key={v._id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <StudentAvatar
                              student={v.student_id}
                              recordPhoto={v.student_photo}
                              name={v.student_id?.name || v.name}
                            />
                            <div>
                              <div style={{ fontWeight: 600 }}>{v.student_id?.name || v.name || 'Unknown'}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{v.student_id?.rollNo || v.rollNo || '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span className="badge badge-out">{getHostelLabel(v.student_id?.hostel || v.hostel)}</span>
                            {(v.student_id?.roomNo || v.roomNo) && (
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                                Room {v.student_id?.roomNo || v.roomNo}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{v.place || '—'}</td>
                        <td style={{ maxWidth: 180, color: 'var(--text-secondary)', fontSize: 13 }} title={v.reason}>
                          {v.reason ? (v.reason.substring(0, 60) + (v.reason.length > 60 ? '...' : '')) : '—'}
                        </td>
                        <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{v.leave_date}</td>
                        <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{v.return_date}</td>
                        <td>
                          {(() => {
                            const phone1 = v.parent_phone || v.student_id?.parentPhone;
                            const phone2 = v.parent_phone_alt || v.student_id?.parentPhone2;
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {phone1 ? (
                                  <a
                                    href={`tel:${phone1}`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      handleCallParent(v, phone1, 'Parent 1');
                                    }}
                                    style={{
                                      fontFamily: 'JetBrains Mono, monospace',
                                      fontSize: 12.5,
                                      color: 'var(--text-primary)',
                                      textDecoration: 'none',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                    title="Click to call Parent 1"
                                  >
                                    📞 {phone1}
                                  </a>
                                ) : (
                                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>—</span>
                                )}
                                {phone2 && (
                                  <a
                                    href={`tel:${phone2}`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      handleCallParent(v, phone2, 'Parent 2 (Alt)');
                                    }}
                                    style={{
                                      fontFamily: 'JetBrains Mono, monospace',
                                      fontSize: 11,
                                      color: 'var(--text-muted)',
                                      textDecoration: 'none',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                    title="Click to call Parent 2 (Alt)"
                                  >
                                    Alt: {phone2}
                                  </a>
                                )}
                                <span
                                  className={`badge badge-${v.parent_call_confirmed ? 'approved' : 'pending'}`}
                                  onClick={!v.parent_call_confirmed ? () => handleManualConfirmCall(v) : undefined}
                                  style={{
                                    cursor: !v.parent_call_confirmed ? 'pointer' : 'default',
                                    width: 'fit-content',
                                  }}
                                  title={!v.parent_call_confirmed ? 'Click to mark call confirmed manually' : 'Call confirmed'}
                                >
                                  {v.parent_call_confirmed ? 'call confirmed' : 'not confirmed'}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td>{statusBadge(v.overall_status)}</td>
                        <td>
                          {v.warden_status === 'pending' ? (
                            (() => {
                              const phone1 = v.parent_phone || v.student_id?.parentPhone;
                              const phone2 = v.parent_phone_alt || v.student_id?.parentPhone2;
                              return (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  {/* Call Parent 1 Button */}
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleCallParent(v, phone1, 'Parent 1')}
                                    disabled={!phone1 || actioning === v._id + 'call1'}
                                    title={phone1 ? `Call Parent 1: ${phone1} (Enables approval)` : 'Parent 1 phone not available'}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      color: '#38bdf8',
                                      background: 'rgba(56, 189, 248, 0.12)',
                                      border: '1px solid rgba(56, 189, 248, 0.3)',
                                      padding: '5px 8px',
                                      borderRadius: '6px',
                                      cursor: phone1 ? 'pointer' : 'not-allowed',
                                    }}
                                  >
                                    {actioning === v._id + 'call1' ? (
                                      <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                                    ) : (
                                      <>
                                        <MdPhone size={14} />
                                        <span style={{ fontSize: 11, fontWeight: 700 }}>P1</span>
                                      </>
                                    )}
                                  </button>

                                  {/* Call Parent 2 (Alternate) Button */}
                                  {phone2 && (
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => handleCallParent(v, phone2, 'Parent 2 (Alt)')}
                                      disabled={!phone2 || actioning === v._id + 'call2'}
                                      title={`Call Parent 2 (Alt): ${phone2} (Enables approval)`}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        color: '#a78bfa',
                                        background: 'rgba(167, 139, 250, 0.12)',
                                        border: '1px solid rgba(167, 139, 250, 0.3)',
                                        padding: '5px 8px',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      {actioning === v._id + 'call2' ? (
                                        <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                                      ) : (
                                        <>
                                          <MdPhoneInTalk size={14} />
                                          <span style={{ fontSize: 11, fontWeight: 700 }}>P2</span>
                                        </>
                                      )}
                                    </button>
                                  )}

                                  {/* Approve Button */}
                                  <button
                                    className="btn btn-success btn-sm"
                                    onClick={() => handleWardenAction(v._id, 'approve')}
                                    disabled={!v.parent_call_confirmed || actioning === v._id + 'approve'}
                                    title={v.parent_call_confirmed ? 'Approve Home Visit' : 'Call parent first to enable approval'}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: v.parent_call_confirmed ? 'pointer' : 'not-allowed',
                                      opacity: v.parent_call_confirmed ? 1 : 0.45,
                                      transition: 'all 0.2s ease',
                                    }}
                                  >
                                    {actioning === v._id + 'approve' ? (
                                      <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                                    ) : (
                                      <MdCheckCircle size={16} />
                                    )}
                                  </button>

                                  {/* Reject Button */}
                                  <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() => handleWardenAction(v._id, 'reject')}
                                    disabled={actioning === v._id + 'reject'}
                                    title="Reject Home Visit"
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    }}
                                  >
                                    {actioning === v._id + 'reject' ? (
                                      <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                                    ) : (
                                      <MdCancel size={16} />
                                    )}
                                  </button>
                                </div>
                              );
                            })()
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                              {v.overall_status === 'completed' ? '✅ Done' : (v.overall_status || '—')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
          </div>
        )}
      </div>
    </div>
  );
}
