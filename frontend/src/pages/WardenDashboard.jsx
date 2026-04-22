/**
 * Warden Dashboard — Overview
 * Summary stats: total students, currently out, not returned, pending approvals
 */
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdPeople, MdExitToApp, MdWarning, MdHome,
  MdReport, MdRefresh
} from 'react-icons/md';

const StatCard = ({ icon, value, label, variant = '' }) => (
  <div className={`stat-card ${variant} fade-in`}>
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
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = async () => {
    try {
      setLoading(true);
      const res = await api.get('/dashboard/summary');
      setSummary(res.data.summary);
    } catch (err) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    const interval = setInterval(fetchSummary, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fade-in">
      <Navbar title="Warden Dashboard" />
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

        {loading && !summary ? (
          <div className="loading-page">
            <div className="loading-spinner" style={{ width: 40, height: 40 }} />
            <span style={{ color: 'var(--text-muted)' }}>Loading dashboard...</span>
          </div>
        ) : (
          <div className="stats-grid">
            <StatCard
              icon={<MdPeople size={22} color="#6366f1" />}
              value={summary?.totalStudents}
              label="Total Students"
            />
            <StatCard
              icon={<MdExitToApp size={22} color="#06b6d4" />}
              value={summary?.studentsOut}
              label="Currently Outside"
              variant="warning"
            />
            <StatCard
              icon={<MdWarning size={22} color="#ef4444" />}
              value={summary?.notReturned}
              label="Not Returned (Alerted)"
              variant="danger"
            />
            <StatCard
              icon={<MdHome size={22} color="#10b981" />}
              value={summary?.pendingHomeVisits}
              label="Pending Home Visits"
              variant="success"
            />
            <StatCard
              icon={<MdReport size={22} color="#f59e0b" />}
              value={summary?.pendingComplaints}
              label="Pending Complaints"
              variant="warning"
            />
          </div>
        )}

        {/* Quick Action Buttons */}
        <div className="card" style={{ marginTop: 8 }}>
          <div className="section-title" style={{ fontSize: 16, marginBottom: 16 }}>
            ⚡ Quick Actions
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href="/not-returned" className="btn btn-danger">
              <MdWarning /> View Not Returned
            </a>
            <a href="/home-visits" className="btn btn-primary">
              <MdHome /> Review Home Visits
            </a>
            <a href="/complaints" className="btn btn-ghost">
              <MdReport /> Manage Complaints
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}
