import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';

export default function ParentHomeVisitRespond() {
  const { visitId } = useParams();
  const [status, setStatus] = useState('idle'); // idle | submitting | done | error
  const [message, setMessage] = useState('');

  const validId = useMemo(() => /^[a-f\d]{24}$/i.test(visitId || ''), [visitId]);

  const act = async (action) => {
    if (!validId) return;
    setStatus('submitting');
    setMessage('');
    try {
      const res = await api.post('/homevisit/parent-approve', { visit_id: visitId, action });
      setStatus('done');
      setMessage(res.data?.message || `Request ${action}d`);
    } catch (err) {
      setStatus('error');
      setMessage(err.response?.data?.message || 'Failed to submit response');
    }
  };

  useEffect(() => {
    if (!validId) setMessage('Invalid request link.');
  }, [validId]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'linear-gradient(135deg, #0b0f19 0%, #111827 60%, #0b0f19 100%)',
      color: '#e5e7eb',
      fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 520,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16,
        padding: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
      }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>
          Home Visit Approval
        </div>
        <div style={{ marginTop: 6, color: 'rgba(229,231,235,0.75)', fontSize: 13 }}>
          Request ID: <code style={{ color: '#93c5fd' }}>{visitId}</code>
        </div>

        <div style={{
          marginTop: 14,
          padding: 12,
          borderRadius: 12,
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'rgba(229,231,235,0.85)',
          fontSize: 13,
          lineHeight: 1.55,
        }}>
          Tap Approve or Reject. If you already responded, the system will show that message.
        </div>

        {message && (
          <div style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: status === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
            border: `1px solid ${status === 'error' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
            fontSize: 13,
          }}>
            {message}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            onClick={() => act('approve')}
            disabled={!validId || status === 'submitting' || status === 'done'}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid rgba(16,185,129,0.35)',
              background: 'rgba(16,185,129,0.16)',
              color: '#d1fae5',
              fontWeight: 700,
              cursor: 'pointer',
              opacity: (!validId || status === 'submitting' || status === 'done') ? 0.6 : 1,
            }}
          >
            Approve
          </button>
          <button
            onClick={() => act('reject')}
            disabled={!validId || status === 'submitting' || status === 'done'}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid rgba(239,68,68,0.35)',
              background: 'rgba(239,68,68,0.14)',
              color: '#fee2e2',
              fontWeight: 700,
              cursor: 'pointer',
              opacity: (!validId || status === 'submitting' || status === 'done') ? 0.6 : 1,
            }}
          >
            Reject
          </button>
        </div>

        <div style={{ marginTop: 14, color: 'rgba(229,231,235,0.55)', fontSize: 12 }}>
          Note: This page submits your response to the hostel system. It doesn’t require login.
        </div>
      </div>
    </div>
  );
}

