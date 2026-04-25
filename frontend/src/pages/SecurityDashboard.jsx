/**
 * Security Dashboard — Daily approvals + Home-Visit QR scanner
 * - Daily IN/OUT requests carry a QR that security can scan
 * - Home-visit gate passes still use QR scanning
 * - Pending items refresh every 5 seconds
 */
import { useState, useEffect, useRef } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { MdCheckCircle, MdError, MdQrCodeScanner, MdRefresh, MdAccessTime } from 'react-icons/md';

const SCANNER_ELEMENT_ID = 'qr-reader';

export default function SecurityDashboard() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [pendingQRs, setPendingQRs] = useState([]);
  const [selectedQR, setSelectedQR] = useState(null);
  const [scannerStatus, setScannerStatus] = useState('Scanner idle');
  const [cameraError, setCameraError] = useState('');
  const [scanTone, setScanTone] = useState('idle');
  const [searchByColumn, setSearchByColumn] = useState({
    dailyOut: '',
    dailyIn: '',
    homeGone: '',
    homeReturn: '',
  });
  const scannerRef = useRef(null);
  const fileInputRef = useRef(null);
  const isProcessingScanRef = useRef(false);
  const lastDecodedRef = useRef({ token: '', at: 0 });
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
  const pickBestCamera = async () => {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras.length) throw new Error('No camera found');

    const preferred = cameras.find((camera) =>
      /back|rear|environment|external|iphone|android/i.test(camera.label || '')
    );

    return preferred?.id || cameras[0].id;
  };

  const startScanner = async () => {
    if (scannerRef.current) return;
    setResult(null);
    setCameraError('');
    setScanTone('idle');
    setScannerStatus('Starting camera...');

    try {
      const scanner = new Html5Qrcode(
        SCANNER_ELEMENT_ID,
        {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        }
      );

      const cameraId = await pickBestCamera();
      await scanner.start(
        cameraId,
        {
          fps: 20,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const size = Math.max(240, Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.82));
            return { width: size, height: size };
          },
          aspectRatio: 1.0,
          disableFlip: false,
          videoConstraints: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        async (decodedText) => {
          const now = Date.now();
          if (isProcessingScanRef.current) return;
          if (lastDecodedRef.current.token === decodedText && now - lastDecodedRef.current.at < 3000) return;
          isProcessingScanRef.current = true;
          lastDecodedRef.current = { token: decodedText, at: now };
          setScanTone('success');
          setScannerStatus('QR detected');
          await stopScanner(true);
          await processToken(decodedText);
        },
        (errorMessage) => {
          if (!errorMessage?.includes('No MultiFormat Readers')) {
            setScannerStatus('Scanning for QR...');
          }
        }
      );

      scannerRef.current = scanner;
      setScanning(true);
      setScannerStatus('Camera ready. Hold the QR steady inside the box.');
    } catch (error) {
      setCameraError(error.message || 'Unable to start scanner');
      setScannerStatus('Scanner failed to start');
      setScanTone('error');
      toast.error(error.message || 'Unable to start scanner');
      if (scannerRef.current) {
        try {
          await scannerRef.current.clear();
        } catch {}
        scannerRef.current = null;
      }
      setScanning(false);
    }
  };

  const stopScanner = async (preserveFeedback = false) => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {}
      try {
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
    if (!preserveFeedback) {
      setScannerStatus('Scanner stopped');
      setScanTone('idle');
    }
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          scannerRef.current.stop();
        } catch {}
        try {
          scannerRef.current.clear();
        } catch {}
      }
    };
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
      setScanTone('success');
      setScannerStatus('Scan successful');
      // Consume the scan: clear manual input + selection so it can't be re-submitted accidentally
      setManualToken('');
      // Refresh pending list immediately
      await fetchPendingQRs();
      setSelectedQR(null);
    } catch (err) {
      const msg = err.response?.data?.message || 'Scan failed';
      setResult({ success: false, message: msg });
      setScanTone('error');
      setScannerStatus(msg);
      toast.error(msg);
    } finally {
      isProcessingScanRef.current = false;
      setLoading(false);
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualToken.trim()) return toast.error('Paste a QR token');
    await processToken(manualToken.trim());
    setManualToken('');
  };

  const handleScanFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setResult(null);
    setCameraError('');
    setScanTone('idle');
    setScannerStatus('Reading QR from image...');

    try {
      const scanner = new Html5Qrcode(
        SCANNER_ELEMENT_ID,
        {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        }
      );
      const decodedText = await scanner.scanFile(file, false);
      scanner.clear();
      setScanTone('success');
      setScannerStatus('QR decoded from image');
      await processToken(decodedText);
    } catch (error) {
      const message = error.message || 'Could not read QR from image';
      setCameraError(message);
      setScannerStatus('Image scan failed');
      setScanTone('error');
      toast.error(message);
      setLoading(false);
    } finally {
      e.target.value = '';
    }
  };

  // ── Select a pending QR from the panel ───────────────────────────────────
  const handleSelectPendingQR = (qr) => {
    if (!qr.token) return;
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

  const timeLeft = (isoStr) => {
    const diff = Math.max(0, Math.ceil((new Date(isoStr).getTime() - Date.now()) / 1000));
    if (diff < 60) return `${diff}s left`;
    return `${Math.ceil(diff / 60)}m left`;
  };

  const matchesSearch = (items, searchValue) => {
    const needle = searchValue.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.studentName, item.rollNumber, item.hostel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  };

  return (
    <div className="fade-in">
      <Navbar title="Gate Requests" />
      <div className="page-area">

        <div className="section-header">
          <div>
            <div className="section-title"><MdQrCodeScanner /> Gate QR Scanner</div>
            <div className="section-subtitle">Scan daily in/out request QR codes and home-visit QR passes</div>
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
            <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 15 }}>📷 Home-Visit QR Scanner</div>

            <div
              id={SCANNER_ELEMENT_ID}
              style={{
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                border:
                  scanTone === 'success'
                    ? '2px solid #10b981'
                    : scanTone === 'error'
                      ? '2px solid #ef4444'
                      : scanning
                        ? '2px solid var(--primary)'
                        : '1px solid rgba(255,255,255,0.08)',
                boxShadow: scanTone === 'success' ? '0 0 0 2px rgba(16,185,129,0.16)' : 'none',
                minHeight: 320,
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
                  onClick={() => stopScanner()}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  ⏹ Stop Scanner
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => fileInputRef.current?.click()}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Upload QR Image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleScanFile}
                style={{ display: 'none' }}
              />
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: cameraError ? '#fca5a5' : 'var(--text-muted)' }}>
              {cameraError || scannerStatus}
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
                <div style={{ color: 'var(--text-muted)' }}>Processing request...</div>
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
                      {result.success ? '✅ Request Processed' : '❌ Request Failed'}
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
                  Scan the student's QR, paste a token, or click a pending card to fill the token
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
                Live Pending Gate Requests
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
                Daily in/out requests expire automatically after 10 minutes; home-visit QR passes stay scannable
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
              No pending requests — all students processed
            </div>
          ) : (
            (() => {
              const isHome = (q) => q.qrType === 'home_visit';
              const isDaily = (q) => q.requestType === 'inout_request';

              // Group by next required scan action:
              // - OUT: student is requesting to go out (first scan pending)
              // - IN: student is outside and returning (second scan pending)
              const dailyOut = matchesSearch(
                pendingQRs.filter((q) => isDaily(q) && q.scanType === 'OUT'),
                searchByColumn.dailyOut
              );
              const dailyIn = matchesSearch(
                pendingQRs.filter((q) => isDaily(q) && q.scanType === 'IN'),
                searchByColumn.dailyIn
              );
              const homeGone = matchesSearch(
                pendingQRs.filter((q) => isHome(q) && q.scanType === 'HOME OUT'),
                searchByColumn.homeGone
              );
              const homeReturn = matchesSearch(
                pendingQRs.filter((q) => isHome(q) && q.scanType === 'HOME IN'),
                searchByColumn.homeReturn
              );

              const Column = ({ title, subtitle, items, tone, searchKey }) => (
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
                  <input
                    type="text"
                    value={searchByColumn[searchKey]}
                    onChange={(e) => setSearchByColumn((prev) => ({ ...prev, [searchKey]: e.target.value }))}
                    placeholder="Search name / roll no..."
                    className="form-input"
                    style={{
                      marginTop: 10,
                      width: '100%',
                      fontSize: 12,
                      padding: '8px 10px',
                      borderRadius: 10,
                    }}
                  />

                  {items.length === 0 ? (
                    <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                      — none —
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                      {items.map((qr, idx) => {
                        const cardKey = qr.token || qr.requestId;
                        const isSelected = Boolean(qr.token) && selectedQR?.token === qr.token;
                        return (
                          <div
                            key={cardKey}
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
                              cursor: qr.token ? 'pointer' : 'default',
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
                              {qr.expiresAt ? timeLeft(qr.expiresAt) : relativeTime(qr.createdAt)}
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
                    subtitle="Approve requests for students going out"
                    items={dailyOut}
                    tone="danger"
                    searchKey="dailyOut"
                  />
                  <Column
                    title="Daily IN Pass"
                    subtitle="Approve requests for students returning in"
                    items={dailyIn}
                    tone="ok"
                    searchKey="dailyIn"
                  />
                  <Column
                    title="Home Visit GOING"
                    subtitle="Leaving for home"
                    items={homeGone}
                    tone="danger"
                    searchKey="homeGone"
                  />
                  <Column
                    title="Home Visit RETURNING"
                    subtitle="Coming back from home"
                    items={homeReturn}
                    tone="ok"
                    searchKey="homeReturn"
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
