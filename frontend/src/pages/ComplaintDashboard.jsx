/**
 * Complaints Dashboard
 * Warden can filter by hostel/status, resolve complaints inline
 */
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdReport, MdRefresh, MdCheckCircle } from 'react-icons/md';

export default function ComplaintDashboard() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hostelFilter, setHostelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [resolving, setResolving] = useState(null);

  const fetchComplaints = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (hostelFilter) params.append('hostel', hostelFilter);
      if (statusFilter) params.append('status', statusFilter);
      const res = await api.get(`/complaints/all?${params.toString()}`);
      setComplaints(res.data.complaints);
    } catch (err) {
      toast.error('Failed to load complaints');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchComplaints(); }, [hostelFilter, statusFilter]);

  const handleResolve = async (id) => {
    setResolving(id);
    try {
      await api.patch(`/complaints/${id}/resolve`, { resolutionNote: 'Resolved by warden' });
      toast.success('Complaint resolved');
      fetchComplaints();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resolve');
    } finally {
      setResolving(null);
    }
  };

  const pending = complaints.filter((c) => c.status === 'pending').length;
  const resolved = complaints.filter((c) => c.status === 'resolved').length;

  return (
    <div className="fade-in">
      <Navbar title="Complaint Dashboard" />
      <div className="page-area">

        <div className="section-header">
          <div>
            <div className="section-title"><MdReport /> Hostel Complaints</div>
            <div className="section-subtitle">
              {pending} pending · {resolved} resolved · {complaints.length} total
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchComplaints} disabled={loading}>
            <MdRefresh size={16} /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <select
            id="hostel-filter"
            className="form-select"
            style={{ maxWidth: 180 }}
            value={hostelFilter}
            onChange={(e) => setHostelFilter(e.target.value)}
          >
            <option value="">All Hostels</option>
            <option value="BH1">BH1</option>
            <option value="BH2">BH2</option>
            <option value="GH">GH</option>
          </select>

          <select
            id="status-filter"
            className="form-select"
            style={{ maxWidth: 180 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        {loading ? (
          <div className="loading-page"><div className="loading-spinner" style={{ width: 40, height: 40 }} /></div>
        ) : complaints.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 60 }}>📋</div>
            <div style={{ fontWeight: 700, marginTop: 12 }}>No complaints found</div>
            <p>No complaints match the current filter.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Hostel</th>
                  <th>Complaint</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {complaints.map((c) => (
                  <tr key={c._id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.student_id?.name || 'Unknown'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.student_id?.rollNumber}</div>
                    </td>
                    <td><span className="badge badge-out">{c.hostel}</span></td>
                    <td style={{ maxWidth: 250, color: 'var(--text-secondary)', fontSize: 13 }}>
                      {c.complaint_text}
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                      {new Date(c.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td>
                      <span className={`badge badge-${
                        c.status === 'resolved' ? 'resolved' :
                        c.status === 'in_progress' ? 'progress' : 'pending'
                      }`}>
                        {c.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      {c.status !== 'resolved' ? (
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => handleResolve(c._id)}
                          disabled={resolving === c._id}
                        >
                          {resolving === c._id
                            ? <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                            : <><MdCheckCircle /> Resolve</>
                          }
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          ✅ {c.resolvedBy?.name || 'Resolved'}
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
