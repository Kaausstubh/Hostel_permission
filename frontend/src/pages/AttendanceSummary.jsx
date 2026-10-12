/**
 * Attendance Summary Screen (Read-Only)
 * Built for Security Guards and Hostel Staff to quickly check:
 * - Campus/Hostel headcounts (Present, Absent, On Leave, Unresolved)
 * - Live status of rounds across floors
 * - Anomaly & violation alerts (Outside geofence, device sharing, mock location)
 */

import { useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdMeetingRoom,
  MdRefresh,
  MdCheckCircle,
  MdCancel,
  MdHome,
  MdWarning,
  MdSecurity,
  MdGpsFixed,
  MdDevices,
} from 'react-icons/md';
import Navbar from '../components/Navbar';

export default function AttendanceSummary() {
  const todayStr = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [hostel, setHostel] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [summaryData, setSummaryData] = useState(null);

  const fetchSummary = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.get('/attendance/summary', {
        params: {
          date: selectedDate,
          hostel: hostel !== 'ALL' ? hostel : undefined,
        },
      });
      if (res.data?.success) {
        setSummaryData(res.data);
      }
    } catch (err) {
      if (!silent) toast.error('Failed to load attendance summary');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    const interval = setInterval(() => fetchSummary(true), 5000);
    return () => clearInterval(interval);
  }, [selectedDate, hostel]);

  return (
    <div className="fade-in">
      <Navbar title="Hostel Attendance Summary" />
      <div className="page-area">
        <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <MdSecurity size={26} color="var(--primary)" /> Hostel Attendance Summary
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>
            Real-time hostel occupancy, floor round completion, and security anomaly feed
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
          />
          <select
            value={hostel}
            onChange={(e) => setHostel(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
          >
            <option value="ALL">All Hostels</option>
            <option value="BH1">Brahmaputra (BH1)</option>
            <option value="BH2">Krishna (BH2)</option>
            <option value="GH1">Indrayani (GH1)</option>
            <option value="GH2">Sindhu (GH2)</option>
          </select>
          <button
            onClick={() => fetchSummary()}
            disabled={loading}
            className="secondary-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 13 }}
          >
            <MdRefresh size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 24 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '16px', borderRadius: 12 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 700 }}>TOTAL STUDENTS</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: 'var(--text-primary)' }}>
            {summaryData?.totalStudents ?? '-'}
          </div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(16,185,129,0.3)', padding: '16px', borderRadius: 12 }}>
          <div style={{ fontSize: 11.5, color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MdCheckCircle size={14} /> PRESENT
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#10b981' }}>
            {summaryData?.present ?? 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {summaryData?.manualMarked ? `(${summaryData.manualMarked} manual overrides)` : 'Verified in hostel'}
          </div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(239,68,68,0.3)', padding: '16px', borderRadius: 12 }}>
          <div style={{ fontSize: 11.5, color: '#ef4444', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MdCancel size={14} /> ABSENT
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#ef4444' }}>
            {summaryData?.absent ?? 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Unaccounted for</div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(59,130,246,0.3)', padding: '16px', borderRadius: 12 }}>
          <div style={{ fontSize: 11.5, color: '#3b82f6', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MdHome size={14} /> ON LEAVE
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#3b82f6' }}>
            {summaryData?.onLeave ?? 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Approved home visits</div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(245,158,11,0.3)', padding: '16px', borderRadius: 12 }}>
          <div style={{ fontSize: 11.5, color: '#f59e0b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MdWarning size={14} /> UNRESOLVED
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#f59e0b' }}>
            {summaryData?.unresolved ?? 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Round not completed yet</div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(244,63,94,0.3)', padding: '16px', borderRadius: 12 }}>
          <div style={{ fontSize: 11.5, color: '#f43f5e', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MdWarning size={14} /> ANOMALIES
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#f43f5e' }}>
            {summaryData?.flaggedCount ?? 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Flagged verifications</div>
        </div>
      </div>

      {/* Main Grid: Rounds Progress & Security Anomaly Feed */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
        {/* Rounds Conducted Today */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MdMeetingRoom size={20} color="var(--primary)" /> Floor Rounds for {selectedDate}
          </h2>

          {summaryData?.rounds?.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              No attendance rounds recorded for this date.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {summaryData?.rounds?.map((rd) => (
                <div
                  key={rd.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>
                      {rd.hostel} — Floor {rd.floor}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {rd.session}
                    </div>
                  </div>
                  <div>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 12,
                        fontSize: 11.5,
                        fontWeight: 700,
                        background: rd.status === 'completed' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                        color: rd.status === 'completed' ? '#10b981' : '#f59e0b',
                      }}
                    >
                      {rd.status === 'completed' ? 'COMPLETED' : 'ACTIVE / IN PROGRESS'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Security Anomaly Feed */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px', color: '#f43f5e', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MdWarning size={20} /> Anomaly & Security Flag Feed
          </h2>

          {summaryData?.anomalies?.length === 0 ? (
            <div style={{ color: '#10b981', fontSize: 13, padding: '20px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <MdCheckCircle size={28} />
              <span>Zero security anomalies detected. All verifications valid.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 380, overflowY: 'auto' }}>
              {summaryData?.anomalies?.map((an) => (
                <div
                  key={an.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    background: 'rgba(244,63,94,0.06)',
                    border: '1px solid rgba(244,63,94,0.25)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13.5 }}>
                        {an.student?.name || 'Student'} ({an.student?.rollNo || 'Roll -'})
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {an.hostel} — Room {an.roomNo}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {an.flags?.map((fl) => (
                        <span
                          key={fl}
                          style={{
                            padding: '3px 7px',
                            borderRadius: 6,
                            fontSize: 10.5,
                            fontWeight: 700,
                            background: '#f43f5e',
                            color: '#ffffff',
                          }}
                        >
                          {fl}
                        </span>
                      ))}
                    </div>
                  </div>
                  {an.gps_accuracy && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MdGpsFixed size={12} /> GPS Accuracy: {Math.round(an.gps_accuracy)}m
                    </div>
                  )}
                  {an.remark && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                      Staff Remark: "{an.remark}"
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}
