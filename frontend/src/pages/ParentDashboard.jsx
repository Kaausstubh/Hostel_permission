/**
 * Parent Dashboard Page
 * Mobile-first dashboard for parents/guardians.
 * Displays linked wards (supporting multiple siblings), pending leave requests requiring action,
 * and historical request outcomes.
 *
 * Supports Light Mode (Default) and Dark Mode with dynamic switching and persistence.
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdLogout,
  MdFamilyRestroom,
  MdAccessTime,
  MdCheckCircle,
  MdCancel,
  MdRefresh,
  MdChevronRight,
  MdHistory,
  MdLightMode,
  MdDarkMode,
  MdWbSunny,
  MdNightlight,
} from 'react-icons/md';

export default function ParentDashboard() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { setTheme: setGlobalTheme } = useTheme() || {};

  // Theme state: Defaults to 'light' mode as requested
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('parent_theme') || 'light';
  });

  const [parent, setParent] = useState(null);
  const [wards, setWards] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Sync active theme with document data-theme attribute on mount and change
  useEffect(() => {
    const active = localStorage.getItem('parent_theme') || 'light';
    setTheme(active);
    document.documentElement.setAttribute('data-theme', active);
    if (setGlobalTheme) setGlobalTheme(active);
  }, [setGlobalTheme]);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('parent_theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    if (setGlobalTheme) setGlobalTheme(nextTheme);
  };

  const isDark = theme === 'dark';

  // Comprehensive theme token design system
  const t = {
    // Page
    pageBg: isDark ? '#0b0f19' : '#f8fafc',
    pageText: isDark ? '#f3f4f6' : '#0f172a',

    // Top Header
    headerBg: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.92)',
    headerBorder: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
    headerTitle: isDark ? '#f9fafb' : '#0f172a',
    headerSub: isDark ? '#9ca3af' : '#64748b',

    // Toggle Button
    themeBtnBg: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.05)',
    themeBtnBorder: isDark ? 'rgba(255, 255, 255, 0.14)' : '#cbd5e1',
    themeBtnText: isDark ? '#f3f4f6' : '#1e293b',

    // Actions Buttons
    btnBorder: isDark ? 'rgba(255, 255, 255, 0.1)' : '#cbd5e1',
    btnText: isDark ? '#e5e7eb' : '#475569',

    // Welcome Greeting Banner
    welcomeBg: isDark
      ? 'linear-gradient(135deg, rgba(30, 58, 138, 0.35) 0%, rgba(17, 24, 39, 0.7) 100%)'
      : 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 45%, #eff6ff 100%)',
    welcomeBorder: isDark ? 'rgba(59, 130, 246, 0.3)' : '#c7d2fe',
    welcomeTitle: isDark ? '#ffffff' : '#1e1b4b',
    welcomeSub: isDark ? '#93c5fd' : '#4338ca',
    welcomeEmail: isDark ? '#ffffff' : '#1e1b4b',
    welcomeShadow: isDark ? 'none' : '0 4px 20px -2px rgba(99, 102, 241, 0.08)',

    // Section Titles
    sectionTitle: isDark ? '#f3f4f6' : '#0f172a',
    sectionIconWards: isDark ? '#60a5fa' : '#3b82f6',
    sectionIconPending: isDark ? '#f59e0b' : '#d97706',
    sectionIconHistory: isDark ? '#9ca3af' : '#64748b',

    // Linked Wards Cards
    wardCardBg: isDark ? 'rgba(255, 255, 255, 0.04)' : '#ffffff',
    wardCardBorder: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
    wardCardShadow: isDark ? 'none' : '0 2px 10px rgba(15, 23, 42, 0.04)',
    wardAvatarBg: isDark ? '#1e293b' : '#e0e7ff',
    wardAvatarBorder: isDark ? 'rgba(59, 130, 246, 0.35)' : '#818cf8',
    wardAvatarText: isDark ? '#60a5fa' : '#4338ca',
    wardName: isDark ? '#f3f4f6' : '#0f172a',
    wardLabel: isDark ? '#9ca3af' : '#64748b',
    wardValue: isDark ? '#e5e7eb' : '#1e293b',
    wardRoleChipBg: isDark ? 'rgba(56, 189, 248, 0.1)' : '#f0f9ff',
    wardRoleChipBorder: isDark ? 'rgba(56, 189, 248, 0.25)' : '#bae6fd',
    wardRoleChipText: isDark ? '#38bdf8' : '#0284c7',

    // Pending Requests
    pendingEmptyBg: isDark ? 'rgba(255, 255, 255, 0.02)' : '#ffffff',
    pendingEmptyBorder: isDark ? 'rgba(255, 255, 255, 0.1)' : '#cbd5e1',
    pendingEmptyText: isDark ? '#9ca3af' : '#047857',
    pendingCardBg: isDark ? 'rgba(245, 158, 11, 0.06)' : '#fffdfa',
    pendingCardBorder: isDark ? 'rgba(245, 158, 11, 0.35)' : '#fcd34d',
    pendingCardShadow: isDark ? 'none' : '0 4px 16px rgba(245, 158, 11, 0.08)',
    pendingName: isDark ? '#fef3c7' : '#78350f',
    pendingDest: isDark ? '#d1d5db' : '#92400e',
    pendingGridBg: isDark ? 'rgba(0, 0, 0, 0.28)' : '#ffffff',
    pendingGridBorder: isDark ? 'rgba(255, 255, 255, 0.05)' : '#fef3c7',
    pendingLabel: isDark ? '#9ca3af' : '#64748b',
    pendingValue: isDark ? '#f3f4f6' : '#0f172a',

    // History Section
    historyEmptyBg: isDark ? 'rgba(255, 255, 255, 0.02)' : '#ffffff',
    historyEmptyBorder: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
    historyEmptyText: isDark ? '#9ca3af' : '#64748b',
    historyItemBg: isDark ? 'rgba(255, 255, 255, 0.03)' : '#ffffff',
    historyItemBorder: isDark ? 'rgba(255, 255, 255, 0.07)' : '#e2e8f0',
    historyItemShadow: isDark ? 'none' : '0 2px 6px rgba(15, 23, 42, 0.03)',
    historyTitle: isDark ? '#f3f4f6' : '#0f172a',
    historySub: isDark ? '#9ca3af' : '#64748b',
    historyRemarks: isDark ? '#93c5fd' : '#2563eb',
    historyArrow: isDark ? '#9ca3af' : '#64748b',
  };

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
      return (
        <span
          className="badge"
          style={{
            fontSize: 12,
            fontWeight: 700,
            background: isDark ? 'rgba(245, 158, 11, 0.16)' : '#fef3c7',
            color: isDark ? '#fbbf24' : '#92400e',
            border: `1px solid ${isDark ? 'rgba(245, 158, 11, 0.35)' : '#fde68a'}`,
            padding: '4px 10px',
            borderRadius: 9999,
          }}
        >
          Awaiting Your Decision
        </span>
      );
    }
    if (status === 'parent_approved') {
      return (
        <span
          className="badge"
          style={{
            fontSize: 12,
            fontWeight: 700,
            background: isDark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5',
            color: isDark ? '#34d399' : '#065f46',
            border: `1px solid ${isDark ? 'rgba(16, 185, 129, 0.35)' : '#a7f3d0'}`,
            padding: '4px 10px',
            borderRadius: 9999,
          }}
        >
          {source === 'STAFF_PHONE_OVERRIDE' ? '📞 Staff Phone Override' : '✅ Parent Approved'}
        </span>
      );
    }
    if (status === 'parent_rejected') {
      return (
        <span
          className="badge"
          style={{
            fontSize: 12,
            fontWeight: 700,
            background: isDark ? 'rgba(239, 68, 68, 0.16)' : '#fef2f2',
            color: isDark ? '#f87171' : '#991b1b',
            border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.35)' : '#fecaca'}`,
            padding: '4px 10px',
            borderRadius: 9999,
          }}
        >
          ❌ Rejected
        </span>
      );
    }
    if (status === 'parent_no_response') {
      return (
        <span
          className="badge"
          style={{
            fontSize: 12,
            fontWeight: 700,
            background: isDark ? 'rgba(156, 163, 175, 0.16)' : '#f1f5f9',
            color: isDark ? '#9ca3af' : '#475569',
            border: `1px solid ${isDark ? 'rgba(156, 163, 175, 0.35)' : '#cbd5e1'}`,
            padding: '4px 10px',
            borderRadius: 9999,
          }}
        >
          ⌛ No Response (Expired)
        </span>
      );
    }
    return (
      <span
        className="badge"
        style={{
          fontSize: 12,
          fontWeight: 700,
          background: isDark ? 'rgba(99, 102, 241, 0.16)' : '#e0e7ff',
          color: isDark ? '#818cf8' : '#3730a3',
          padding: '4px 10px',
          borderRadius: 9999,
        }}
      >
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <div
        className="loading-page"
        style={{
          minHeight: '100vh',
          background: t.pageBg,
          color: t.pageText,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="loading-spinner" style={{ width: 44, height: 44, marginBottom: 12 }} />
        <span style={{ color: t.headerSub, fontSize: 14 }}>Loading Parent Dashboard...</span>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: t.pageBg,
        color: t.pageText,
        paddingBottom: 40,
        transition: 'background-color 0.25s ease, color 0.25s ease',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          background: t.headerBg,
          backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${t.headerBorder}`,
          padding: '12px 20px',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'all 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>🏛️</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: t.headerTitle, letterSpacing: 0.5 }}>
              HEIMDALL
            </div>
            <div style={{ fontSize: 11.5, color: t.headerSub }}>
              Parent & Guardian Command
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Theme Toggle Button: Light Mode (Default) vs Dark Mode */}
          <button
            onClick={toggleTheme}
            className="btn btn-ghost btn-sm"
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 20,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: t.themeBtnBg,
              border: `1px solid ${t.themeBtnBorder}`,
              color: t.themeBtnText,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            title={isDark ? 'Switch to Light Mode (Default)' : 'Switch to Dark Mode'}
            aria-label="Toggle Light/Dark Theme"
          >
            {isDark ? (
              <>
                <MdWbSunny size={16} color="#fbbf24" style={{ filter: 'drop-shadow(0 0 4px rgba(251,191,36,0.6))' }} />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <MdNightlight size={16} color="#6366f1" />
                <span>Dark Mode</span>
              </>
            )}
          </button>

          <button
            onClick={() => fetchDashboardData(true)}
            disabled={refreshing}
            className="btn btn-ghost btn-sm"
            style={{
              padding: '6px 10px',
              fontSize: 12,
              borderRadius: 8,
              border: `1px solid ${t.btnBorder}`,
              color: t.btnText,
            }}
            title="Refresh dashboard"
          >
            <MdRefresh size={16} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>

          <button
            onClick={handleLogout}
            className="btn btn-ghost btn-sm"
            style={{
              padding: '6px 10px',
              fontSize: 12,
              color: '#ef4444',
              borderRadius: 8,
              border: isDark ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(239, 68, 68, 0.3)',
              background: isDark ? 'rgba(239, 68, 68, 0.08)' : 'rgba(239, 68, 68, 0.05)',
            }}
            title="Sign out"
          >
            <MdLogout size={16} /> <span style={{ display: 'inline' }}>Sign Out</span>
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 840, margin: '0 auto', padding: '24px 16px' }}>
        {/* Welcome Greeting Banner */}
        <div
          style={{
            background: t.welcomeBg,
            border: `1px solid ${t.welcomeBorder}`,
            borderRadius: 16,
            padding: '20px 22px',
            marginBottom: 24,
            boxShadow: t.welcomeShadow,
            transition: 'all 0.25s ease',
          }}
        >
          <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: t.welcomeTitle }}>
            Hello, {parent?.name || 'Guardian'}
          </h2>
          <p style={{ margin: 0, fontSize: 13.5, color: t.welcomeSub }}>
            Registered email: <strong style={{ color: t.welcomeEmail }}>{parent?.email}</strong>
          </p>
        </div>

        {/* 1. Linked Wards Section */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <MdFamilyRestroom size={20} color={t.sectionIconWards} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.sectionTitle }}>
              Linked Students ({wards.length})
            </h3>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 14,
            }}
          >
            {wards.map((w, idx) => {
              const student = w.student || {};
              return (
                <div
                  key={student._id || idx}
                  style={{
                    background: t.wardCardBg,
                    border: `1px solid ${t.wardCardBorder}`,
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    boxShadow: t.wardCardShadow,
                    transition: 'all 0.25s ease',
                  }}
                >
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: '50%',
                      background: t.wardAvatarBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                      color: t.wardAvatarText,
                      fontWeight: 700,
                      overflow: 'hidden',
                      flexShrink: 0,
                      border: `2px solid ${t.wardAvatarBorder}`,
                    }}
                  >
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
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        color: t.wardName,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {student.name}
                    </div>
                    <div style={{ fontSize: 12, color: t.wardLabel, marginTop: 2 }}>
                      MIS: <span style={{ color: t.wardValue, fontWeight: 600 }}>{student.rollNo || 'N/A'}</span>
                    </div>
                    <div style={{ fontSize: 12, color: t.wardLabel, marginTop: 2 }}>
                      Hostel {student.hostel || 'Assigned'} • Room {student.roomNo || 'N/A'}
                    </div>
                    <div
                      style={{
                        display: 'inline-block',
                        fontSize: 11.5,
                        color: t.wardRoleChipText,
                        background: t.wardRoleChipBg,
                        border: `1px solid ${t.wardRoleChipBorder}`,
                        borderRadius: 6,
                        padding: '2px 8px',
                        marginTop: 6,
                        fontWeight: 600,
                      }}
                    >
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
              <MdAccessTime size={20} color={t.sectionIconPending} />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.sectionTitle }}>
                Pending Home-Visit Approvals
              </h3>
            </div>
            {pendingRequests.length > 0 && (
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: isDark ? 'rgba(245, 158, 11, 0.2)' : '#fef3c7',
                  color: isDark ? '#fbbf24' : '#92400e',
                  border: `1px solid ${isDark ? 'rgba(245, 158, 11, 0.4)' : '#fcd34d'}`,
                  padding: '3px 10px',
                  borderRadius: 9999,
                }}
              >
                {pendingRequests.length} ACTION NEEDED
              </span>
            )}
          </div>

          {pendingRequests.length === 0 ? (
            <div
              style={{
                background: t.pendingEmptyBg,
                border: `1px dashed ${t.pendingEmptyBorder}`,
                borderRadius: 14,
                padding: '24px 20px',
                textAlign: 'center',
                color: t.pendingEmptyText,
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              ✅ All caught up! No pending leave requests requiring your decision right now.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingRequests.map((req) => (
                <div
                  key={req._id}
                  style={{
                    background: t.pendingCardBg,
                    border: `1.5px solid ${t.pendingCardBorder}`,
                    borderRadius: 14,
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    boxShadow: t.pendingCardShadow,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: t.pendingName }}>
                        {req.student_id?.name || req.name} ({req.student_id?.rollNo || req.rollNo})
                      </div>
                      <div style={{ fontSize: 13, color: t.pendingDest, marginTop: 3 }}>
                        📍 Destination: <strong>{req.place || 'Home'}</strong>
                      </div>
                    </div>
                    {getStatusBadge(req.parent_approval_status, req.parent_decision_source)}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: 10,
                      background: t.pendingGridBg,
                      border: `1px solid ${t.pendingGridBorder}`,
                      padding: '12px 14px',
                      borderRadius: 10,
                      fontSize: 12.5,
                    }}
                  >
                    <div>
                      <span style={{ color: t.pendingLabel }}>Departure:</span>
                      <br />
                      <strong style={{ color: t.pendingValue }}>{req.leave_date}</strong>
                    </div>
                    <div>
                      <span style={{ color: t.pendingLabel }}>Return Date:</span>
                      <br />
                      <strong style={{ color: t.pendingValue }}>{req.return_date}</strong>
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      <span style={{ color: t.pendingLabel }}>Reason:</span>
                      <br />
                      <span style={{ color: t.pendingValue }}>{req.reason}</span>
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
            <MdHistory size={20} color={t.sectionIconHistory} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.sectionTitle }}>
              Leave History ({pastRequests.length})
            </h3>
          </div>

          {pastRequests.length === 0 ? (
            <div
              style={{
                background: t.historyEmptyBg,
                border: `1px dashed ${t.historyEmptyBorder}`,
                borderRadius: 14,
                padding: '20px',
                textAlign: 'center',
                color: t.historyEmptyText,
                fontSize: 13,
              }}
            >
              No past leave records found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pastRequests.map((req) => (
                <div
                  key={req._id}
                  style={{
                    background: t.historyItemBg,
                    border: `1px solid ${t.historyItemBorder}`,
                    borderRadius: 12,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                    boxShadow: t.historyItemShadow,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: t.historyTitle }}>
                      {req.student_id?.name || req.name} •{' '}
                      <span style={{ color: t.historySub }}>{req.place || 'Home'}</span>
                    </div>
                    <div style={{ fontSize: 12, color: t.historySub, marginTop: 2 }}>
                      {req.leave_date} → {req.return_date} ({req.reason?.slice(0, 50)})
                    </div>
                    {req.approvalRecord?.remarks && (
                      <div style={{ fontSize: 11.5, color: t.historyRemarks, marginTop: 4 }}>
                        Remarks: "{req.approvalRecord.remarks}"
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {getStatusBadge(req.parent_approval_status, req.parent_decision_source)}
                    <Link
                      to={`/parent/requests/${req._id}`}
                      style={{ color: t.historyArrow, textDecoration: 'none', display: 'flex', alignItems: 'center' }}
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
