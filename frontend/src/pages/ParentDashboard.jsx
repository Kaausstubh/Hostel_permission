/**
 * Parent Dashboard Page
 * Mobile-first dashboard for parents/guardians.
 * Displays linked wards (supporting multiple siblings), pending leave requests requiring action,
 * and historical request outcomes.
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdLogout, MdFamilyRestroom, MdAccessTime, MdCheckCircle, MdCancel, MdRefresh, MdChevronRight, MdHistory } from 'react-icons/md';

export default function ParentDashboard() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [parent, setParent] = useState(null);
  const [wards, setWards] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboardData = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [meRes, wardsRes, reqsRes] = await Promise.all([
        api.get('/parent/me'),
        api.get('/parent/wards'),
        api.get('/parent/requests'),
      ]);

      setParent(meRes.data.parent);
      setWards(wardsRes.data.wards || []);
      setRequests(reqsRes.data.requests || []);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/parent/login');
      } else {
        toast.error('Failed to load dashboard data');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate('/parent/login');
  };

  const pendingRequests = requests.filter((r) => r.parent_approval_status === 'pending');
  const pastRequests = requests.filter((r) => r.parent_approval_status !== 'pending');

  const getStatusBadge = (status, source) => {
    if (status === 'pending') {
      return <span className="badge badge-pending" style={{ fontSize: 12 }}>Awaiting Your Decision</span>;
    }
    if (status === 'parent_approved') {
      return (
        <span className="badge badge-approved" style={{ fontSize: 12 }}>
          {source === 'STAFF_PHONE_OVERRIDE' ? '📞 Staff Phone Override' : '✅ Parent Approved'}
        </span>
      );
    }
    if (status === 'parent_rejected') {
      return <span className="badge badge-rejected" style={{ fontSize: 12 }}>❌ Rejected</span>;
    }
    if (status === 'parent_no_response') {
      return <span className="badge badge-rejected" style={{ fontSize: 12 }}>⌛ No Response (Expired)</span>;
    }
    return <span className="badge badge-out" style={{ fontSize: 12 }}>{status}</span>;
  };

  if (loading) {
    return (
      <div className="loading-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" style={{ width: 44, height: 44, marginBottom: 12 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading Parent Dashboard...</span>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary, #0b0f19)',
      color: '#f3f4f6',
      paddingBottom: 40,
    }}>
      {/* Top Header */}
      <header style={{
        background: 'rgba(17, 24, 39, 0.95)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '14px 20px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>🏛️</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#f9fafb', letterSpacing: 0.5 }}>HEIMDALL</div>
            <div style={{ fontSize: 11.5, color: '#9ca3af' }}>Parent & Guardian Command</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => fetchDashboardData(true)}
            disabled={refreshing}
            className="btn btn-ghost btn-sm"
            style={{ padding: '6px 10px', fontSize: 12 }}
            title="Refresh dashboard"
          >
            <MdRefresh size={16} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button
            onClick={handleLogout}
            className="btn btn-ghost btn-sm"
            style={{ padding: '6px 10px', fontSize: 12, color: '#ef4444' }}
            title="Sign out"
          >
            <MdLogout size={16} /> Sign Out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 840, margin: '0 auto', padding: '20px 16px' }}>
        {/* Welcome Greeting */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.3) 0%, rgba(17, 24, 39, 0.6) 100%)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          borderRadius: 16,
          padding: '20px',
          marginBottom: 24,
        }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 20, color: '#ffffff' }}>
            Hello, {parent?.name || 'Guardian'}
          </h2>
          <p style={{ margin: 0, fontSize: 13.5, color: '#93c5fd' }}>
            Registered email: <strong>{parent?.email}</strong>
          </p>
        </div>

        {/* 1. Linked Wards Section */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <MdFamilyRestroom size={20} color="#60a5fa" />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              Linked Students ({wards.length})
            </h3>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}>
            {wards.map((w, idx) => {
              const student = w.student || {};
              return (
                <div
                  key={student._id || idx}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <div style={{
                    width: 52,
                    height: 52,
                    borderRadius: '50%',
                    background: '#1e293b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    color: '#60a5fa',
                    fontWeight: 700,
                    overflow: 'hidden',
                    flexShrink: 0,
                    border: '2px solid rgba(59, 130, 246, 0.3)',
                  }}>
                    {student.studentPhoto || student.picture ? (
                      <img
                        src={student.studentPhoto || student.picture}
                        alt={student.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      (student.name || 'S')[0]
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#f3f4f6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {student.name}
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                      MIS: <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{student.rollNo || 'N/A'}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                      Hostel {student.hostel || 'Assigned'} • Room {student.roomNo || 'N/A'}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#38bdf8', marginTop: 4, fontWeight: 500 }}>
                      Role: {w.relationship} | Completed Leaves: {w.leaveCount || 0}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 2. Action Required: Pending Requests */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MdAccessTime size={20} color="#f59e0b" />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                Pending Home-Visit Approvals
              </h3>
            </div>
            {pendingRequests.length > 0 && (
              <span className="badge badge-pending" style={{ fontSize: 12, fontWeight: 700 }}>
                {pendingRequests.length} ACTION NEEDED
              </span>
            )}
          </div>

          {pendingRequests.length === 0 ? (
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px dashed rgba(255, 255, 255, 0.1)',
              borderRadius: 14,
              padding: '24px 20px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 14,
            }}>
              ✅ All caught up! No pending leave requests requiring your decision right now.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingRequests.map((req) => (
                <div
                  key={req._id}
                  style={{
                    background: 'rgba(245, 158, 11, 0.06)',
                    border: '1.5px solid rgba(245, 158, 11, 0.35)',
                    borderRadius: 14,
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: '#fef3c7' }}>
                        {req.student_id?.name || req.name} ({req.student_id?.rollNo || req.rollNo})
                      </div>
                      <div style={{ fontSize: 13, color: '#d1d5db', marginTop: 3 }}>
                        📍 Destination: <strong>{req.place || 'Home'}</strong>
                      </div>
                    </div>
                    {getStatusBadge(req.parent_approval_status, req.parent_decision_source)}
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: 10,
                    background: 'rgba(0,0,0,0.25)',
                    padding: '10px 14px',
                    borderRadius: 10,
                    fontSize: 12.5,
                  }}>
                    <div>
                      <span style={{ color: '#9ca3af' }}>Departure:</span><br />
                      <strong style={{ color: '#f3f4f6' }}>{req.leave_date}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#9ca3af' }}>Return Date:</span><br />
                      <strong style={{ color: '#f3f4f6' }}>{req.return_date}</strong>
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      <span style={{ color: '#9ca3af' }}>Reason:</span><br />
                      <span style={{ color: '#e5e7eb' }}>{req.reason}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Link
                      to={`/parent/requests/${req._id}`}
                      className="btn btn-primary"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '10px 18px',
                        fontSize: 13.5,
                        fontWeight: 700,
                        textDecoration: 'none',
                        borderRadius: 10,
                      }}
                    >
                      Review & Decide <MdChevronRight size={18} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. Past Requests & History */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <MdHistory size={20} color="#9ca3af" />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              Leave History ({pastRequests.length})
            </h3>
          </div>

          {pastRequests.length === 0 ? (
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px dashed rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
              padding: '20px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}>
              No past leave records found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pastRequests.map((req) => (
                <div
                  key={req._id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {req.student_id?.name || req.name} • <span style={{ color: '#9ca3af' }}>{req.place || 'Home'}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {req.leave_date} → {req.return_date} ({req.reason?.slice(0, 50)})
                    </div>
                    {req.approvalRecord?.remarks && (
                      <div style={{ fontSize: 11.5, color: '#93c5fd', marginTop: 4 }}>
                        Remarks: "{req.approvalRecord.remarks}"
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {getStatusBadge(req.parent_approval_status, req.parent_decision_source)}
                    <Link
                      to={`/parent/requests/${req._id}`}
                      style={{ color: '#9ca3af', textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                      title="View details"
                    >
                      <MdChevronRight size={20} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
