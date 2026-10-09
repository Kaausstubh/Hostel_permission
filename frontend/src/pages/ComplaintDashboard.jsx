import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import StudentAvatar from '../components/StudentAvatar';
import api from '../services/api';
import { resolvePhotoUrl } from '../services/backendUrl';
import toast from 'react-hot-toast';
import { MdReport, MdRefresh, MdCheckCircle, MdPhotoCamera, MdClose, MdZoomIn } from 'react-icons/md';
import { getHostelLabel } from '../utils/hostel';

const TYPE_CONFIG = {
  carpenter: { label: 'Carpenter', icon: '🔨', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  plumber: { label: 'Plumber', icon: '🔧', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)' },
  electricity: { label: 'Electricity', icon: '⚡', color: '#eab308', bg: 'rgba(234, 179, 8, 0.15)' },
  wifi: { label: 'WiFi', icon: '📶', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
  washing_machine: { label: 'Washing Machine', icon: '🧺', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
  others: { label: 'Others', icon: '🛠️', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' },
};

const getTypeConfig = (type = '') => {
  const normalized = (type || '').toLowerCase();
  return TYPE_CONFIG[normalized] || TYPE_CONFIG.others;
};

export default function ComplaintDashboard() {
  const [complaints, setComplaints] = useState(() => {
    try {
      const cached = sessionStorage.getItem('heimdall_complaints_cache');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(() => {
    try {
      const cached = sessionStorage.getItem('heimdall_complaints_cache');
      return !cached;
    } catch {
      return true;
    }
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hostelFilter, setHostelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [resolving, setResolving] = useState(null);
  const [previewPhoto, setPreviewPhoto] = useState(null);

  const fetchComplaints = async () => {
    try {
      if (complaints.length === 0) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const params = new URLSearchParams();
      if (hostelFilter) params.append('hostel', hostelFilter);
      if (statusFilter) params.append('status', statusFilter);
      const res = await api.get(`/complaints/all?${params.toString()}`);
      const fetched = res.data.complaints || [];
      setComplaints(fetched);
      if (!hostelFilter && !statusFilter) {
        try {
          sessionStorage.setItem('heimdall_complaints_cache', JSON.stringify(fetched));
        } catch {}
      }
    } catch (err) {
      toast.error('Failed to load complaints');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => { fetchComplaints(); }, [hostelFilter, statusFilter]);

  const handleResolve = async (id) => {
    setResolving(id);
    try {
      await api.patch(`/complaints/${id}/resolve`, { resolutionNote: 'Resolved by hostel staff' });
      toast.success('Complaint resolved');
      fetchComplaints();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resolve');
    } finally {
      setResolving(null);
    }
  };

  const filteredComplaints = complaints.filter((c) => {
    if (!typeFilter) return true;
    const type = (c.complaint_type || '').toLowerCase();
    return type === typeFilter || (typeFilter === 'others' && !type);
  });

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
          <button className="btn btn-ghost btn-sm" onClick={fetchComplaints} disabled={loading && complaints.length === 0}>
            <MdRefresh size={16} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} /> {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Filters */}
        <div className="filters-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <select
            id="hostel-filter"
            className="form-select"
            style={{ maxWidth: 170 }}
            value={hostelFilter}
            onChange={(e) => setHostelFilter(e.target.value)}
          >
            <option value="">All Hostels</option>
            <option value="BH1">Brahmaputra (BH1)</option>
            <option value="BH2">Krishna (BH2)</option>
            <option value="GH1">Indrayani (GH1)</option>
            <option value="GH2">Sindhu (GH2)</option>
          </select>

          <select
            id="status-filter"
            className="form-select"
            style={{ maxWidth: 170 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>

          <select
            id="type-filter"
            className="form-select"
            style={{ maxWidth: 190 }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All Categories</option>
            <option value="carpenter">🔨 Carpenter</option>
            <option value="plumber">🔧 Plumber</option>
            <option value="electricity">⚡ Electricity</option>
            <option value="wifi">📶 WiFi</option>
            <option value="washing_machine">🧺 Washing Machine</option>
            <option value="others">🛠️ Others</option>
          </select>
        </div>

        {(loading && complaints.length === 0) ? (
          <div className="loading-page"><div className="loading-spinner" style={{ width: 40, height: 40 }} /></div>
        ) : filteredComplaints.length === 0 ? (
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
                  <th>Category</th>
                  <th>Complaint</th>
                  <th>Photo Evidence</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredComplaints.map((c) => {
                  const student = c.student_id || {};
                  const studentAvatar = student.studentPhoto || student.picture || c.student_photo;
                  const typeCfg = getTypeConfig(c.complaint_type);

                  return (
                    <tr key={c._id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <StudentAvatar
                            student={student}
                            name={student.name || c.name}
                          />
                          <div>
                            <div style={{ fontWeight: 600 }}>{student.name || c.name || 'Unknown'}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{student.rollNo || c.rollNo}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="badge badge-out">{getHostelLabel(c.hostel)}</span></td>
                      <td>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '4px 10px',
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 700,
                          color: typeCfg.color,
                          background: typeCfg.bg,
                          border: `1px solid ${typeCfg.color}33`,
                        }}>
                          <span>{typeCfg.icon}</span> {typeCfg.label}
                        </span>
                      </td>
                      <td style={{ maxWidth: 260, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.4 }}>
                        {c.complaint_text}
                      </td>
                      <td>
                        {(c.hasPhoto || c.photo || c.photoUrl) ? (
                          <button
                            type="button"
                            onClick={() => setPreviewPhoto({
                              url: resolvePhotoUrl(c.photo || c.photoUrl || `/api/complaints/${c._id}/photo`),
                              title: `${student.name || c.name || 'Student'} - ${typeCfg.label}`,
                              description: c.complaint_text,
                              hostel: c.hostel,
                              date: new Date(c.timestamp).toLocaleString('en-IN', { hour12: false }),
                            })}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '5px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--primary)',
                              background: 'rgba(99, 102, 241, 0.1)',
                              color: 'var(--primary-light)',
                              cursor: 'pointer',
                              fontSize: 12,
                              fontWeight: 600,
                              transition: 'all 0.15s',
                            }}
                          >
                            <MdPhotoCamera size={16} />
                            <span>View Photo</span>
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                        )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Photo Preview Modal ── */}
      {previewPhoto && (
        <div
          onClick={() => setPreviewPhoto(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 20,
              padding: 24,
              maxWidth: 580,
              width: '100%',
              border: '1px solid var(--glass-border)',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>
                  📸 Complaint Photo Evidence
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {previewPhoto.title} · {getHostelLabel(previewPhoto.hostel)} · {previewPhoto.date}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPreviewPhoto(null)}
                style={{ width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <MdClose size={20} />
              </button>
            </div>

            <div style={{
              borderRadius: 12,
              overflow: 'hidden',
              background: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              maxHeight: 450,
            }}>
              <img
                src={previewPhoto.url}
                alt="Complaint evidence"
                style={{
                  maxWidth: '100%',
                  maxHeight: 450,
                  objectFit: 'contain',
                }}
              />
            </div>

            <div style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--bg-input)',
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              border: '1px solid var(--glass-border)',
            }}>
              <strong>Complaint Description:</strong>
              <div style={{ marginTop: 4 }}>{previewPhoto.description}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
