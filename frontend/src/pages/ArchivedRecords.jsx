/**
 * Archived Records — Admin Dashboard & Historical Cloudflare R2 Store
 * Displays archive job manifests, storage metrics, signed download links,
 * and historical record search directly from R2 archives.
 */

import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdCloudDownload,
  MdRefresh,
  MdSearch,
  MdStorage,
  MdCheckCircle,
  MdWarning,
  MdPlayArrow,
  MdHistory,
  MdClose,
  MdInventory2,
} from 'react-icons/md';

export default function ArchivedRecords() {
  const [statusData, setStatusData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [triggerLoading, setTriggerLoading] = useState(false);

  // Manual Trigger Modal State
  const [showTriggerModal, setShowTriggerModal] = useState(false);
  const [triggerCollection, setTriggerCollection] = useState('InOutLog');
  const [triggerYearMonth, setTriggerYearMonth] = useState('');

  // Historical Search Modal State
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchJob, setSearchJob] = useState(null);
  const [searchTarget, setSearchTarget] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Audit Logs Modal State
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchArchiveStatusAndJobs = async () => {
    try {
      setLoading(true);
      const [statusRes, jobsRes] = await Promise.all([
        api.get('/archive/status'),
        api.get('/archive/jobs?limit=50'),
      ]);
      setStatusData(statusRes.data);
      setJobs(jobsRes.data.jobs || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load archive data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArchiveStatusAndJobs();
  }, []);

  const handleManualTrigger = async (e) => {
    e.preventDefault();
    if (!triggerYearMonth || !/^\d{4}-\d{2}$/.test(triggerYearMonth)) {
      return toast.error('Enter valid YYYY-MM month (e.g. 2026-01)');
    }

    try {
      setTriggerLoading(true);
      const res = await api.post('/archive/trigger', {
        collectionName: triggerCollection,
        yearMonthStr: triggerYearMonth,
        synchronous: true,
      });
      toast.success(res.data.message || 'Archival job processed');
      setShowTriggerModal(false);
      fetchArchiveStatusAndJobs();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to trigger archive job');
    } finally {
      setTriggerLoading(false);
    }
  };

  const handleOpenSearchModal = (job) => {
    setSearchJob(job);
    setSearchTarget('');
    setSearchResults(null);
    setShowSearchModal(true);
  };

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    if (!searchJob) return;

    try {
      setSearchLoading(true);
      const [year, month] = new Date(searchJob.periodStart).toISOString().slice(0, 7).split('-');
      const yearMonthStr = `${year}-${month}`;

      const res = await api.post('/archive/retrieve', {
        yearMonthStr,
        collectionName: searchJob.collectionName,
        searchTarget,
      });
      setSearchResults(res.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleDownloadSignedUrl = async (jobId) => {
    try {
      const res = await api.get(`/archive/download-url/${jobId}`);
      if (res.data?.downloadUrl) {
        window.open(res.data.downloadUrl, '_blank');
        toast.success('Download link generated (valid 15m)');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to generate download URL');
    }
  };

  const handleFetchAuditLogs = async () => {
    try {
      setAuditLoading(true);
      setShowAuditModal(true);
      const res = await api.get('/archive/audit-logs?limit=50');
      setAuditLogs(res.data.logs || []);
    } catch (err) {
      toast.error('Failed to load audit logs');
    } finally {
      setAuditLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatMonthTitle = (isoStart) => {
    if (!isoStart) return '—';
    const date = new Date(isoStart);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  };

  return (
    <div className="fade-in">
      <Navbar title="Archived Records" />
      <div className="page-area">
        {/* Header section */}
        <div className="section-header">
          <div>
            <div className="section-title">
              <MdInventory2 /> Historical Archived Records
            </div>
            <div className="section-subtitle">
              Cloudflare R2 long-term storage manifests, metrics, signed downloads & search
            </div>
          </div>
          <div className="section-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleFetchAuditLogs}
            >
              <MdHistory size={16} /> Audit Trail
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowTriggerModal(true)}
            >
              <MdPlayArrow size={16} /> Run Manual Archive
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={fetchArchiveStatusAndJobs}
              disabled={loading}
            >
              <MdRefresh size={16} /> Refresh
            </button>
          </div>
        </div>

        {/* Top metrics summary grid */}
        {statusData && (
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-edge-glow" />
              <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
                <MdCheckCircle />
              </div>
              <div className="stat-value">
                {statusData.summary.totalRecordsArchived.toLocaleString()}
              </div>
              <div className="stat-label">Total Archived Records</div>
            </div>

            <div className="stat-card">
              <div className="stat-edge-glow" />
              <div className="stat-icon" style={{ background: 'rgba(34,211,238,0.15)', color: '#22d3ee' }}>
                <MdStorage />
              </div>
              <div className="stat-value">
                {statusData.summary.totalCompressedSizeMB} MB
              </div>
              <div className="stat-label">R2 Storage Used (gzip)</div>
            </div>

            <div className="stat-card">
              <div className="stat-edge-glow" />
              <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--primary-light)' }}>
                📅
              </div>
              <div className="stat-value">
                {statusData.retentionMonths} Months
              </div>
              <div className="stat-label">Retention Threshold</div>
            </div>

            <div className="stat-card">
              <div className="stat-edge-glow" />
              <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                ⚡
              </div>
              <div className="stat-value" style={{ fontSize: 18 }}>
                {statusData.summary.lastSuccessfulArchive
                  ? statusData.summary.lastSuccessfulArchive.archiveId
                  : 'None'}
              </div>
              <div className="stat-label">Last Successful Archive</div>
            </div>
          </div>
        )}

        {/* Archive Jobs List */}
        <div className="card" style={{ marginTop: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>📦 Cloudflare R2 Archive Manifests ({jobs.length})</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
              Bucket: <code>{statusData?.hasR2Credentials ? process.env.R2_BUCKET_NAME || 'heimdall-archives' : 'Local Fallback (Dev)'}</code>
            </span>
          </div>

          {loading ? (
            <div className="loading-page" style={{ padding: 48 }}>
              <div className="loading-spinner" />
            </div>
          ) : jobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
              <div>No archive manifests found yet.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                The automated scheduler runs monthly, or click <strong>Run Manual Archive</strong> above.
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Month / Year</th>
                    <th>Collection</th>
                    <th>Archive ID</th>
                    <th>Records</th>
                    <th>Compressed Size</th>
                    <th>Status</th>
                    <th>Created At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job._id}>
                      <td style={{ fontWeight: 700 }}>
                        {formatMonthTitle(job.periodStart)}
                      </td>
                      <td>
                        <span className="badge badge-progress" style={{ textTransform: 'none' }}>
                          {job.collectionName}
                        </span>
                      </td>
                      <td>
                        <code style={{ fontSize: 12, color: 'var(--primary-light)' }}>
                          {job.archiveId}
                        </code>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {job.recordCount?.toLocaleString() || 0}
                      </td>
                      <td>{formatBytes(job.compressedSize)}</td>
                      <td>
                        <span
                          className={`badge ${
                            job.status === 'COMPLETED' || job.status === 'VERIFIED'
                              ? 'badge-approved'
                              : job.status === 'FAILED'
                                ? 'badge-rejected'
                                : 'badge-pending'
                          }`}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(job.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Search inside this archive"
                            onClick={() => handleOpenSearchModal(job)}
                          >
                            <MdSearch size={14} /> Search
                          </button>
                          {(job.status === 'COMPLETED' || job.status === 'VERIFIED') && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title="Download compressed gzip from R2"
                              onClick={() => handleDownloadSignedUrl(job._id)}
                            >
                              <MdCloudDownload size={14} /> Download
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Manual Trigger Modal ── */}
      {showTriggerModal && (
        <div className="calendar-modal-backdrop" onClick={() => setShowTriggerModal(false)}>
          <div className="calendar-modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
            <div className="calendar-modal-header">
              <div>
                <div className="calendar-modal-eyebrow">Manual trigger</div>
                <div className="calendar-modal-title">Run Archival Job</div>
              </div>
              <button type="button" className="calendar-nav-btn" onClick={() => setShowTriggerModal(false)}>
                <MdClose size={16} />
              </button>
            </div>

            <form onSubmit={handleManualTrigger} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Target Collection</label>
                <select
                  className="form-select"
                  value={triggerCollection}
                  onChange={(e) => setTriggerCollection(e.target.value)}
                >
                  <option value="InOutLog">InOutLog (Daily Entry/Exit)</option>
                  <option value="HomeVisitLog">HomeVisitLog (Home Passes)</option>
                  <option value="Complaint">Complaint (Hostel Complaints)</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Target Month (YYYY-MM)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 2026-01"
                  value={triggerYearMonth}
                  onChange={(e) => setTriggerYearMonth(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  disabled={triggerLoading}
                >
                  {triggerLoading ? 'Processing...' : 'Start Archival Workflow'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowTriggerModal(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Search Historical Records Modal ── */}
      {showSearchModal && searchJob && (
        <div className="calendar-modal-backdrop" onClick={() => setShowSearchModal(false)}>
          <div className="calendar-modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 680, maxWidth: '94vw' }}>
            <div className="calendar-modal-header">
              <div>
                <div className="calendar-modal-eyebrow">R2 Historical Search</div>
                <div className="calendar-modal-title">
                  Search {searchJob.collectionName} ({formatMonthTitle(searchJob.periodStart)})
                </div>
              </div>
              <button type="button" className="calendar-nav-btn" onClick={() => setShowSearchModal(false)}>
                <MdClose size={16} />
              </button>
            </div>

            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search by student name, roll no, phone, place..."
                value={searchTarget}
                onChange={(e) => setSearchTarget(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btn-primary" disabled={searchLoading}>
                {searchLoading ? 'Searching...' : 'Search'}
              </button>
            </form>

            {searchResults && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                  Found <strong>{searchResults.matchedRecordsCount}</strong> match(es) out of {searchResults.totalRecordsInArchive} records in R2 archive.
                </div>

                <div className="table-wrapper" style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Student Name</th>
                        <th>Roll No</th>
                        <th>Details / Place</th>
                        <th>Reason / Note</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResults.records.map((r, i) => (
                        <tr key={r._id || i}>
                          <td style={{ fontWeight: 600 }}>{r.name || '—'}</td>
                          <td>{r.rollNo || '—'}</td>
                          <td>{r.place || r.hostel || '—'}</td>
                          <td style={{ fontSize: 12 }}>{r.reason || r.complaint_text || '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {r.date || (r.timestamp ? new Date(r.timestamp).toLocaleDateString() : '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Audit Logs Modal ── */}
      {showAuditModal && (
        <div className="calendar-modal-backdrop" onClick={() => setShowAuditModal(false)}>
          <div className="calendar-modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: '94vw' }}>
            <div className="calendar-modal-header">
              <div>
                <div className="calendar-modal-eyebrow">Security audit</div>
                <div className="calendar-modal-title">Archive Operation Trail</div>
              </div>
              <button type="button" className="calendar-nav-btn" onClick={() => setShowAuditModal(false)}>
                <MdClose size={16} />
              </button>
            </div>

            {auditLoading ? (
              <div className="loading-page" style={{ padding: 36 }}>
                <div className="loading-spinner" />
              </div>
            ) : (
              <div className="table-wrapper" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Archive ID</th>
                      <th>Records</th>
                      <th>Result</th>
                      <th>User</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log._id}>
                        <td>
                          <code style={{ fontSize: 11, color: 'var(--primary-light)' }}>{log.event}</code>
                        </td>
                        <td>{log.archiveId || '—'}</td>
                        <td>{log.recordCount || 0}</td>
                        <td>
                          <span className={`badge ${log.result === 'FAILED' ? 'badge-rejected' : 'badge-approved'}`}>
                            {log.result}
                          </span>
                        </td>
                        <td>{log.userId?.name || 'System Scheduler'}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
