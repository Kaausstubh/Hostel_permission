/**
 * Warden Dashboard — Overview
 * Summary stats: total students, currently out, not returned, pending approvals
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdPeople, MdExitToApp, MdWarning, MdHome,
  MdReport, MdRefresh, MdHistory
} from 'react-icons/md';

const StatCard = ({ icon, value, label, variant = '', onClick }) => (
  <div className={`stat-card ${variant} fade-in`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
    <div className="stat-icon" style={{
      background: variant === 'danger' ? 'rgba(239,68,68,0.15)'
        : variant === 'warning' ? 'rgba(245,158,11,0.15)'
        : variant === 'success' ? 'rgba(16,185,129,0.15)'
        : 'rgba(99,102,241,0.15)',
    }}>
      {icon}
    </div>
    <div className="stat-value">{value ?? '—'}</div>
    <div className="stat-label">{label}</div>
  </div>
);

export default function WardenDashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(() => {
    try {
      const cached = sessionStorage.getItem('warden_summary_cache');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(!summary);
  const [slowServerWarning, setSlowServerWarning] = useState(false);
  const [storageStats, setStorageStats] = useState(() => {
    try {
      const cached = sessionStorage.getItem('storage_stats_cache');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  const fetchSummary = async () => {
    try {
      if (!summary) setLoading(true);
      const [res, storageRes] = await Promise.allSettled([
        api.get('/dashboard/summary'),
        api.get('/inout/storage-stats'),
      ]);
      if (res.status === 'fulfilled' && res.value?.data?.summary) {
        setSummary(res.value.data.summary);
        try {
          sessionStorage.setItem('warden_summary_cache', JSON.stringify(res.value.data.summary));
        } catch {}
      }
      if (storageRes.status === 'fulfilled' && storageRes.value?.data?.success) {
        setStorageStats(storageRes.value.data);
        try {
          sessionStorage.setItem('storage_stats_cache', JSON.stringify(storageRes.value.data));
          sessionStorage.setItem('storage_stats_cache_time', String(Date.now()));
        } catch {}
      }
    } catch (err) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setSlowServerWarning(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    const interval = setInterval(fetchSummary, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Show friendly hint if backend cold start takes > 3.5s
  useEffect(() => {
    if (loading && !summary) {
      const t = setTimeout(() => setSlowServerWarning(true), 3500);
      return () => clearTimeout(t);
    }
  }, [loading, summary]);

  return (
    <div className="fade-in">
      <Navbar title="Hostel Staff Dashboard" />
      <div className="page-area">

        <div className="section-header">
          <div>
            <div className="section-title">📊 Overview</div>
            <div className="section-subtitle">
              {summary?.date ? `Live data for ${summary.date}` : 'Loading...'}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchSummary} disabled={loading}>
            <MdRefresh size={16} style={{ animation: loading ? 'spin 0.6s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>

        {/* 🚨 80% (400 MB) Storage Limit Capacity Alert Banner */}
        {storageStats?.total && (storageStats.total.isOver80Percent || storageStats.total.percentUsed >= 80) && (
          <div
            className="card fade-in"
            style={{
              marginBottom: 16,
              background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(245, 158, 11, 0.1))',
              border: '1.5px solid #ef4444',
              borderRadius: 14,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              boxShadow: '0 4px 20px rgba(239, 68, 68, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ef4444',
                flexShrink: 0,
              }}>
                <MdWarning size={24} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14.5, color: '#f87171' }}>
                  🚨 Storage Capacity Alert: {storageStats.total.percentUsed}% (≥400 MB) Reached
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary, #cbd5e1)', marginTop: 2 }}>
                  Active institutional logs memory usage is at {storageStats.total.sizeFormatted} of 500 MB limit. Purge older logs to prevent overflow.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => window.dispatchEvent(new CustomEvent('open-storage-limit-modal'))}
                style={{
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                View Full Alert
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigate('/logs')}
                style={{ fontSize: 12 }}
              >
                Purge Logs
              </button>
            </div>
          </div>
        )}

        {loading && !summary ? (
          <div className="loading-page">
            <div className="loading-spinner" style={{ width: 40, height: 40 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>
              {slowServerWarning ? 'Connecting to backend (waking up server instance)…' : 'Loading dashboard...'}
            </span>
          </div>
        ) : (
          <>
          <div className="stats-grid">
            <StatCard
              icon={<MdPeople size={22} color="#6366f1" />}
              value={summary?.totalStudents}
              label="Total Students"
              onClick={() => navigate('/students')}
            />
            <StatCard
              icon={<MdExitToApp size={22} color="#06b6d4" />}
              value={summary?.studentsOut}
              label="Currently Outside"
              variant="warning"
              onClick={() => navigate('/students-out')}
            />
            <StatCard
              icon={<MdWarning size={22} color="#ef4444" />}
              value={summary?.notReturned}
              label="Not Returned (Alerted)"
              variant="danger"
              onClick={() => navigate('/not-returned')}
            />
            <StatCard
              icon={<MdHome size={22} color="#10b981" />}
              value={summary?.pendingHomeVisits}
              label="Pending Home Visits"
              variant="success"
              onClick={() => navigate('/home-visits')}
            />
            <StatCard
              icon={<MdReport size={22} color="#f59e0b" />}
              value={summary?.pendingComplaints}
              label="Pending Complaints"
              variant="warning"
              onClick={() => navigate('/complaints')}
            />
          </div>
          </>
        )}

        {/* Quick Action Buttons */}
        <div className="card warden-quick-actions" style={{ marginTop: 8 }}>
          <div className="section-title" style={{ fontSize: 16, marginBottom: 16 }}>
            ⚡ Quick Actions
          </div>
          <div className="quick-actions-row">
            <button type="button" className="btn btn-danger" onClick={() => navigate('/not-returned')}>
              <MdWarning /> View Not Returned
            </button>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/home-visits')}>
              <MdHome /> Review Home Visits
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/complaints')}>
              <MdReport /> Manage Complaints
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/logs')}>
              <MdHistory /> Gate Scan Logs
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
