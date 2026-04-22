/**
 * Home Visits Page
 * Warden can view all home visit requests and approve/reject pending ones
 */
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdHome, MdRefresh, MdCheckCircle, MdCancel, MdPhone } from 'react-icons/md';

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
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [actioning, setActioning] = useState(null);

  const fetchVisits = async () => {
    try {
      setLoading(true);
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await api.get(`/homevisit/list${params}`);
      setVisits(res.data.visits);
    } catch (err) {
      toast.error('Failed to fetch home visits');
    } finally {
      setLoading(false);
    }
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

  const handleConfirmCallAndApprove = async (visit) => {
    const visitId = visit._id;
    const phone = visit.parent_phone || visit.student_id?.parentPhone;
    if (!phone) return toast.error('Parent phone not available');

    // Start call (works best on mobile; on desktop may open a calling app)
    window.location.href = `tel:${phone}`;

    const ok = window.confirm(
      `After confirming permission on call with ${phone}, click OK to mark APPROVED.`
    );
    if (!ok) return;

    setActioning(visitId + 'callapprove');
    try {
      await api.post('/homevisit/warden-confirm-call', { visit_id: visitId });
      await api.post('/homevisit/warden-approve', { visit_id: visitId, action: 'approve' });
      toast.success('Approved (call confirmed)');
      fetchVisits();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to approve');
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
          <button className="btn btn-ghost btn-sm" onClick={fetchVisits} disabled={loading}>
            <MdRefresh size={16} /> Refresh
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="tabs">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              className={`tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>

        {loading ? (
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
                      <div style={{ fontWeight: 600 }}>{v.student_id?.name || 'Unknown'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{v.student_id?.rollNumber}</div>
                    </td>
                    <td><span className="badge badge-out">{v.student_id?.hostel || '—'}</span></td>
                    <td style={{ maxWidth: 180, color: 'var(--text-secondary)', fontSize: 13 }}>
                      {v.reason.substring(0, 60)}{v.reason.length > 60 ? '...' : ''}
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{v.leave_date}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{v.return_date}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}>
                          {v.parent_phone || v.student_id?.parentPhone || '—'}
                        </div>
                        <span className={`badge badge-${v.parent_call_confirmed ? 'approved' : 'pending'}`}>
                          {v.parent_call_confirmed ? 'call confirmed' : 'not confirmed'}
                        </span>
                      </div>
                    </td>
                    <td>{statusBadge(v.overall_status)}</td>
                    <td>
                      {v.warden_status === 'pending' ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleConfirmCallAndApprove(v)}
                            disabled={v.parent_call_confirmed || actioning === v._id + 'callapprove'}
                            title="Call parent and approve"
                          >
                            {actioning === v._id + 'callapprove'
                              ? <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                              : <MdPhone />
                            }
                          </button>
                          <button
                            className="btn btn-success btn-sm"
                            onClick={() => handleWardenAction(v._id, 'approve')}
                            disabled={!v.parent_call_confirmed || actioning === v._id + 'approve'}
                            title="Approve"
                          >
                            {actioning === v._id + 'approve'
                              ? <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                              : <MdCheckCircle />
                            }
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleWardenAction(v._id, 'reject')}
                            disabled={actioning === v._id + 'reject'}
                            title="Reject"
                          >
                            {actioning === v._id + 'reject'
                              ? <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                              : <MdCancel />
                            }
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          {v.overall_status === 'completed' ? '✅ Done' : '—'}
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
