/**
 * Security Dashboard — QR Scanner + Live Pending QRs Panel
 * - Camera/manual QR scanner using html5-qrcode
 * - Live "Pending QRs" panel that polls /api/inout/pending-qrs every 5s
 * - Clicking a pending QR auto-fills the manual token for quick processing
 */
import { useState, useEffect, useRef } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { MdCheckCircle, MdError, MdQrCodeScanner, MdRefresh, MdAccessTime } from 'react-icons/md';

const SCANNER_ELEMENT_ID = 'qr-reader';

export default function SecurityDashboard() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [pendingQRs, setPendingQRs] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [selectedQR, setSelectedQR] = useState(null);
  const scannerRef = useRef(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Poll pending QRs every 5 seconds ─────────────────────────────────────
  const fetchPendingQRs = async () => {
    try {
      const res = await api.get('/gatescan/pending-qrs');
      setPendingQRs(res.data.qrs || []);
    } catch (err) {
      // silent — may not be logged in yet
    }
  };

  useEffect(() => {
    fetchPendingQRs();
    const interval = setInterval(fetchPendingQRs, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── Scanner Controls ──────────────────────────────────────────────────────
  const startScanner = () => {
    if (scannerRef.current) return;
    setResult(null);

    const scanner = new Html5QrcodeScanner(
      SCANNER_ELEMENT_ID,
      { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1.0 },
      false
    );

    scanner.render(
      async (decodedText) => {
        scanner.clear();
        scannerRef.current = null;
        setScanning(false);
        await processToken(decodedText);
      },
      () => {}
    );

    scannerRef.current = scanner;
    setScanning(true);
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.clear().catch(() => {});
      scannerRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => stopScanner();
  }, []);

  // ── Process Token ─────────────────────────────────────────────────────────
  const processToken = async (token) => {
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post('/gatescan/scan', { token });
      const data = res.data;
      setResult({
        success: true,
        student: data.student,
        status: data.log.status,
        timestamp: data.log.timestamp,
        message: data.message,
      });
      toast.success(data.message);
      // Consume the scan: clear manual input + selection so it can't be re-submitted accidentally
      setManualToken('');
      // Refresh pending list immediately
      await fetchPendingQRs();
      setSelectedQR(null);
    } catch (err) {
      const msg = err.response?.data?.message || 'Scan failed';
      setResult({ success: false, message: msg });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualToken.trim()) return toast.error('Paste a QR token');
    await processToken(manualToken.trim());
    setManualToken('');
  };

  // ── Select a pending QR from the panel ───────────────────────────────────
  const handleSelectPendingQR = (qr) => {
    setSelectedQR(qr.token === selectedQR?.token ? null : qr);
    setManualToken(qr.token === selectedQR?.token ? '' : qr.token);
  };

  // ── Relative time helper ──────────────────────────────────────────────────
  const relativeTime = (isoStr) => {
    const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  return (
    <div className="fade-in">
      <Navbar title="QR Scanner" />
      <div className="page-area">

        <div className="section-header">
          <div>
            <div className="section-title"><MdQrCodeScanner /> Gate QR Scanner</div>
            <div className="section-subtitle">Scan student QR codes to mark entry or exit</div>
          </div>
        </div>

        {/* ── Top row: Scanner + Result ── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: isMobile ? 14 : 20,
          alignItems: 'start',
        }}>

          {/* Scanner Panel */}
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 15 }}>📷 Camera Scanner</div>

            <div
              id={SCANNER_ELEMENT_ID}
              style={{
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                border: scanning ? '2px solid var(--primary)' : 'none',
                minHeight: scanning ? 'auto' : 0,
              }}
            />

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              {!scanning ? (
                <button
                  id="start-scan-btn"
                  className="btn btn-primary"
                  onClick={startScanner}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  <MdQrCodeScanner /> Start Camera Scan
                </button>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={stopScanner}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  ⏹ Stop Scanner
                </button>
              )}
            </div>

            {/* Manual Token Entry */}
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: 'var(--border)' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
                Or paste / click a pending QR token below:
              </div>
              <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: 8 }}>
                <input
                  id="manual-token-input"
                  type="text"
                  className="form-input"
                  placeholder="Paste JWT token here..."
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={loading}
                >
                  {loading ? <span className="loading-spinner" style={{ width: 14, height: 14 }} /> : 'Scan'}
                </button>
              </form>
            </div>
          </div>

          {/* Result Panel */}
          <div>
            {loading && (
              <div className="card" style={{ textAlign: 'center', padding: 40 }}>
                <div className="loading-spinner" style={{ width: 40, height: 40, margin: '0 auto 16px' }} />
                <div style={{ color: 'var(--text-muted)' }}>Processing scan...</div>
              </div>
            )}

            {result && !loading && (
              <div
                className="card fade-in"
                style={{
                  border: result.success
                    ? '1px solid rgba(16,185,129,0.4)'
                    : '1px solid rgba(239,68,68,0.4)',
                  background: result.success
                    ? 'rgba(16,185,129,0.08)'
                    : 'rgba(239,68,68,0.08)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  {result.success
                    ? <MdCheckCircle size={36} color="#10b981" />
                    : <MdError size={36} color="#ef4444" />}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 18, color: result.success ? '#10b981' : '#ef4444' }}>
                      {result.success ? '✅ Scan Successful' : '❌ Scan Failed'}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{result.message}</div>
                  </div>
                </div>

                {result.success && result.student && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{
                      display: 'flex', justifyContent: 'center',
                      background: result.status === 'IN'
                        ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.2)',
                      padding: 16, borderRadius: 'var(--radius-lg)',
                      fontSize: 26, fontWeight: 800,
                      color: result.status === 'IN' ? '#10b981' : 'var(--primary-light)',
                    }}>
                      {result.status === 'IN' ? '🚪 Entry — IN' : '🔓 Exit — OUT'}
                    </div>
                    {[
                      { label: 'Student Name', value: result.student.name },
                      { label: 'Roll Number', value: result.student.rollNumber || 'N/A' },
                      { label: 'Hostel', value: result.student.hostel || 'N/A' },
                      { label: 'Timestamp', value: new Date(result.timestamp).toLocaleString('en-IN') },
                    ].map(({ label, value }) => (
                      <div key={label} style={{
                        display: 'flex', justifyContent: 'space-between',
                        padding: '8px 0', borderBottom: 'var(--border)', fontSize: 14,
                      }}>
                        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                        <span style={{ fontWeight: 600 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!result && !loading && (
              <div className="card" style={{ textAlign: 'center', padding: 60 }}>
                <div style={{ fontSize: 60 }}>📱</div>
                <div style={{ color: 'var(--text-secondary)', marginTop: 12, fontWeight: 600 }}>
                  Ready to Scan
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
                  Start the camera, paste a token, or click a pending QR below
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Pending QRs Live Panel ── */}
        <div className="card" style={{ marginTop: 24 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 16,
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-flex', width: 10, height: 10, borderRadius: '50%',
                  background: pendingQRs.length > 0 ? '#10b981' : '#6b7280',
                  boxShadow: pendingQRs.length > 0 ? '0 0 6px #10b981' : 'none',
                  animation: pendingQRs.length > 0 ? 'pulse 2s infinite' : 'none',
                }} />
                Live Pending QR Scans
                {pendingQRs.length > 0 && (
                  <span style={{
                    background: 'rgba(16,185,129,0.15)', color: '#10b981',
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                    border: '1px solid rgba(16,185,129,0.3)',
                  }}>
                    {pendingQRs.length} pending
                  </span>
                )}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
                Students who generated QR codes but haven't been scanned yet — updates every 5s
              </div>
            </div>
            <button
              onClick={fetchPendingQRs}
              className="btn btn-ghost btn-sm"
              title="Refresh"
            >
              <MdRefresh size={16} />
            </button>
          </div>

          {pendingQRs.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '32px 0',
              color: 'var(--text-muted)', fontSize: 13,
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🟢</div>
              No pending QRs — all students processed
            </div>
          ) : (
            (() => {
              const isHome = (q) => q.qrType === 'home_visit';
              const isDaily = (q) => !isHome(q);

              // Group by next required scan action:
              // - OUT: student is requesting to go out (first scan pending)
              // - IN: student is outside and returning (second scan pending)
              const dailyOut = pendingQRs.filter((q) => isDaily(q) && q.scanType === 'OUT');
              const dailyIn  = pendingQRs.filter((q) => isDaily(q) && q.scanType === 'IN');
              const homeGone = pendingQRs.filter((q) => isHome(q) && q.scanType === 'HOME OUT');
              const homeReturn = pendingQRs.filter((q) => isHome(q) && q.scanType === 'HOME IN');

              const Column = ({ title, subtitle, items, tone }) => (
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 12,
                  minHeight: 140,
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--text-primary)' }}>
                      {title}
                    </div>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 99,
                      color: tone === 'danger' ? '#ef4444' : '#10b981',
                      background: tone === 'danger' ? 'rgba(239,68,68,0.14)' : 'rgba(16,185,129,0.14)',
                      border: tone === 'danger' ? '1px solid rgba(239,68,68,0.28)' : '1px solid rgba(16,185,129,0.28)',
                      flexShrink: 0,
                    }}>
                      {items.length}
                    </div>
                  </div>
                  <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {subtitle}
                  </div>

                  {items.length === 0 ? (
                    <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                      — none —
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                      {items.map((qr, idx) => {
                        const isSelected = selectedQR?.token === qr.token;
                        return (
                          <div
                            key={qr.token}
                            id={`pending-qr-${title.replace(/\s+/g, '-').toLowerCase()}-${idx}`}
                            onClick={() => handleSelectPendingQR(qr)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '10px 12px',
                              borderRadius: 'var(--radius-md)',
                              border: isSelected
                                ? '1px solid rgba(99,102,241,0.6)'
                                : '1px solid rgba(255,255,255,0.06)',
                              background: isSelected
                                ? 'rgba(99,102,241,0.10)'
                                : 'rgba(255,255,255,0.02)',
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>
                                {qr.studentName || 'Unknown'}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                                {qr.hostel || '—'} • {qr.rollNumber || '—'}
                              </div>
                            </div>

                            {qr.qrDataUrl && (
                              <img
                                src={qr.qrDataUrl}
                                alt="QR"
                                style={{
                                  width: 42,
                                  height: 42,
                                  borderRadius: 6,
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  flexShrink: 0,
                                }}
                              />
                            )}

                            <div style={{
                              fontSize: 11,
                              color: isSelected ? 'var(--primary-light)' : 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              flexShrink: 0,
                            }}>
                              <MdAccessTime size={12} />
                              {relativeTime(qr.createdAt)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );

              return (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile
                      ? '1fr'
                      : 'repeat(4, minmax(0, 1fr))',
                    gap: 12,
                  }}
                >
                  <Column
                    title="Daily OUT Pass"
                    subtitle="Going outside campus (next scan: OUT)"
                    items={dailyOut}
                    tone="danger"
                  />
                  <Column
                    title="Daily IN Pass"
                    subtitle="Returning to hostel (next scan: IN)"
                    items={dailyIn}
                    tone="ok"
                  />
                  <Column
                    title="Home Visit GOING"
                    subtitle="Leaving for home"
                    items={homeGone}
                    tone="danger"
                  />
                  <Column
                    title="Home Visit RETURNING"
                    subtitle="Coming back from home"
                    items={homeReturn}
                    tone="ok"
                  />
                </div>
              );
            })()
          )}
        </div>

      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
