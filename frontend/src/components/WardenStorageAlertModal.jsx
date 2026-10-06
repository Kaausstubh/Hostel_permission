/**
 * WardenStorageAlertModal — 80% (400 MB / 500 MB) Storage Limit Pop-Up Alert
 * Automatically warns hostel staff/warden when database memory usage reaches or exceeds 80%.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  MdWarning,
  MdStorage,
  MdDeleteSweep,
  MdClose,
  MdHistory,
  MdSecurity,
  MdCheckCircle,
} from 'react-icons/md';

export default function WardenStorageAlertModal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [stats, setStats] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [forcePreview, setForcePreview] = useState(false);

  const isWarden = ['warden', 'admin'].includes(user?.role);

  const checkStorage = async () => {
    if (!isWarden) return;
    try {
      const res = await api.get('/inout/storage-stats');
      if (res.data?.success) {
        setStats(res.data);
        const total = res.data.total;
        const reached80 = Boolean(total?.isOver80Percent || (total?.percentUsed >= 80) || (total?.sizeBytes >= 400 * 1024 * 1024));
        
        // Show automatically if reached 80% and not previously dismissed in this session
        const dismissed = sessionStorage.getItem('dismissed_storage_80_alert');
        if (reached80 && !dismissed) {
          setModalOpen(true);
        }
      }
    } catch (err) {
      console.warn('Storage stats check skipped:', err?.message);
    }
  };

  useEffect(() => {
    checkStorage();
    // Poll every 60s while warden is active
    const timer = setInterval(checkStorage, 60000);
    return () => clearInterval(timer);
  }, [user?.role]);

  // Listen for manual trigger events from scan logs / settings
  useEffect(() => {
    const handleTrigger = () => setModalOpen(true);
    window.addEventListener('open-storage-limit-modal', handleTrigger);
    return () => window.removeEventListener('open-storage-limit-modal', handleTrigger);
  }, []);

  if (!isWarden) return null;

  const total = stats?.total || {};
  const isReached = Boolean(total?.isOver80Percent || (total?.percentUsed >= 80) || (total?.sizeBytes >= 400 * 1024 * 1024));

  const handleDismiss = () => {
    sessionStorage.setItem('dismissed_storage_80_alert', 'true');
    setModalOpen(false);
  };

  const handleGoToPurge = () => {
    setModalOpen(false);
    navigate('/logs');
  };

  return (
    <>
      {/* Mini Persistent Warning Pill in viewport if reached 80% */}
      {isReached && !modalOpen && (
        <div
          onClick={() => setModalOpen(true)}
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 9990,
            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: '999px',
            boxShadow: '0 10px 25px rgba(239, 68, 68, 0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 700,
            animation: 'pulse 2s infinite',
          }}
          title="Click to view 80% Storage Limit Warning"
        >
          <MdWarning size={18} />
          <span>Storage Warning: {total.percentUsed || 80}% Used (≥400 MB)</span>
        </div>
      )}

      {/* Pop Up Modal */}
      {modalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            animation: 'fadeIn 0.25s ease',
          }}
        >
          <div
            style={{
              background: 'var(--bg-card, #1e293b)',
              border: '2px solid #ef4444',
              borderRadius: '20px',
              width: '100%',
              maxWidth: '560px',
              boxShadow: '0 25px 60px rgba(239, 68, 68, 0.35)',
              padding: '28px',
              position: 'relative',
              color: 'var(--text-primary, #f8fafc)',
            }}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={handleDismiss}
              style={{
                position: 'absolute',
                top: '18px',
                right: '18px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted, #94a3b8)',
                cursor: 'pointer',
              }}
              title="Close notification"
            >
              <MdClose size={18} />
            </button>

            {/* Header Icon + Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '16px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1.5px solid rgba(239, 68, 68, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ef4444',
                  flexShrink: 0,
                }}
              >
                <MdWarning size={32} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#f87171' }}>
                    🚨 Storage Limit Reached 80% (400 MB)
                  </h2>
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted, #94a3b8)', marginTop: '3px' }}>
                  Institutional MongoDB quota warning for Hostel Staff
                </div>
              </div>
            </div>

            {/* Quota Progress Bar */}
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '16px',
                borderRadius: '14px',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                marginBottom: '18px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                <span style={{ fontWeight: 700, color: '#fca5a5' }}>
                  Memory Consumption: {total.sizeFormatted || '400.00 MB'} / 500 MB
                </span>
                <span style={{ fontWeight: 800, color: '#ef4444' }}>
                  {total.percentUsed ? `${total.percentUsed}%` : '80.0%'}
                </span>
              </div>

              {/* Progress Track */}
              <div
                style={{
                  width: '100%',
                  height: '12px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: '999px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Math.max(10, total.percentUsed || 80))}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
                    borderRadius: '999px',
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted, #94a3b8)', marginTop: '6px' }}>
                <span>0 MB</span>
                <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠️ Alert Threshold: 400 MB (80%)</span>
                <span>Max: 500 MB</span>
              </div>
            </div>

            {/* Details Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border, #334155)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>
                  🚪 Gate In/Out Logs
                </div>
                <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '2px' }}>
                  {stats?.inOut?.count ?? '—'} <span style={{ fontSize: '12px', fontWeight: 400 }}>records</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#818cf8', marginTop: '2px' }}>
                  {stats?.inOut?.sizeFormatted ?? '—'}
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border, #334155)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>
                  🏡 Home Visit Logs
                </div>
                <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '2px' }}>
                  {stats?.homeVisit?.count ?? '—'} <span style={{ fontSize: '12px', fontWeight: 400 }}>records</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#10b981', marginTop: '2px' }}>
                  {stats?.homeVisit?.sizeFormatted ?? '—'}
                </div>
              </div>
            </div>

            {/* Notice */}
            <div
              style={{
                fontSize: '12.5px',
                lineHeight: 1.5,
                color: 'var(--text-secondary, #cbd5e1)',
                marginBottom: '22px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '10px',
                padding: '12px',
              }}
            >
              <strong>Notice for Warden:</strong> Active log memory has exceeded the <strong>80% (400 MB)</strong> capacity limit. To prevent database performance degradation or gate scan disruptions, please purge historical logs older than 30 or 60 days. Every purge records your staff credentials in the permanent audit trail.
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleDismiss}
                style={{ fontSize: '13px' }}
              >
                Acknowledge & Dismiss
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleGoToPurge}
                style={{
                  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '13px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 15px rgba(239, 68, 68, 0.4)',
                }}
              >
                <MdDeleteSweep size={18} />
                <span>Go to Logs & Purge Now</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
