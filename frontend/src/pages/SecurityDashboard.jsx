/**
 * Security Dashboard — Daily approvals + Home-Visit QR scanner
 * - Daily IN/OUT requests carry a QR that security can scan
 * - Home-visit gate passes still use QR scanning
 * - Pending items refresh every 5 seconds
 */
import { useState, useEffect, useRef, useCallback } from 'react';
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

  // Camera management
  const [cameras, setCameras] = useState([]);          // [{id, label}]
  const [activeCameraId, setActiveCameraId] = useState(null); // currently selected camera id
  const [cameraFacing, setCameraFacing] = useState('front'); // 'front' | 'back'

  // ── Audio Feedback (Web Audio API — no external files needed) ──────────────
  const audioCtxRef = useRef(null);

  const getAudioCtx = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const unlockAudio = () => {
    try {
      const ctx = getAudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      // Play a silent oscillator for 1ms to forcefully unlock audio context
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.001);
    } catch (e) {}
  };

  /** Play a short professional beep tone */
  const playTone = useCallback((type) => {
    try {
      const ctx = getAudioCtx();
      const master = ctx.createGain();
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.connect(ctx.destination);

      if (type === 'success') {
        // Three ascending clean beeps: C5 → E5 → G5
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime);
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + i * 0.13 + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.13 + 0.18);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.13);
          osc.stop(ctx.currentTime + i * 0.13 + 0.2);
        });
      } else {
        // Two descending low tones: G3 → D3
        const notes = [196.0, 146.83];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.22);
          gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.22);
          gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + i * 0.22 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.28);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.22);
          osc.stop(ctx.currentTime + i * 0.22 + 0.3);
        });
      }
    } catch (e) {
      // Audio not supported — silent fallback
    }
  }, []);

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

  /**
   * Load all available cameras and pick the best default.
   * Primary = front-facing (user/selfie); secondary = back/environment.
   * Returns the id of the chosen camera.
   */
  const loadCameras = async () => {
    const list = await Html5Qrcode.getCameras();
    if (!list || list.length === 0) throw new Error('No camera found on this device');
    setCameras(list);

    // Prefer front-facing by label hint; fall back to first camera
    const front = list.find((c) =>
      /front|selfie|user|face/i.test(c.label || '')
    );
    const back = list.find((c) =>
      /back|rear|environment|main|primary/i.test(c.label || '')
    );

    // Default: front camera (selfie). If not identified by label but only 2 cams exist,
    // index-1 is typically the front camera on mobile.
    let chosen;
    if (front) {
      chosen = front;
      setCameraFacing('front');
    } else if (list.length >= 2) {
      // On most phones camera[1] = front
      chosen = list[1];
      setCameraFacing('front');
    } else {
      chosen = back || list[0];
      setCameraFacing('back');
    }

    setActiveCameraId(chosen.id);
    return chosen.id;
  };

  /**
   * Start the QR scanner with the given cameraId (defaults to activeCameraId).
   * Always cleans up any stale instance before creating a fresh one.
   */
  const startScanner = async (overrideCameraId) => {
    unlockAudio(); // Force unlock audio context on user click

    // Always teardown stale instance first
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }

    setResult(null);
    setCameraError('');
    setScanTone('idle');
    setScannerStatus('Starting camera...');

    try {
      // Resolve which camera to use
      let cameraId = overrideCameraId || activeCameraId;
      if (!cameraId) {
        cameraId = await loadCameras();  // first run: enumerate + pick default
      }

      const scanner = new Html5Qrcode(
        SCANNER_ELEMENT_ID,
        {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        }
      );

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
          // ⚠️  Do NOT add facingMode here — mixing deviceId + facingMode causes
          // OverconstrainedError on most browsers. Resolution constraints are safe.
          videoConstraints: {
            deviceId: { exact: cameraId },
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
          setScannerStatus('QR detected — processing...');
          await processToken(decodedText);

          // Revert status so security knows they can scan the next one
          setTimeout(() => {
            setScannerStatus('Camera ready — hold QR inside the box');
            setScanTone('idle');
          }, 3000);
        },
        () => {
          // Frame-level errors (no QR in frame) are normal — keep status steady
          setScannerStatus('Scanning... hold QR steady inside the box');
        }
      );

      scannerRef.current = scanner;
      setScanning(true);
      setScannerStatus('Camera ready — hold QR inside the box');
    } catch (error) {
      const msg = error?.message || 'Unable to start scanner';
      setCameraError(msg);
      setScannerStatus('Scanner failed to start');
      setScanTone('error');
      toast.error(msg);
      if (scannerRef.current) {
        try { await scannerRef.current.clear(); } catch {}
        scannerRef.current = null;
      }
      setScanning(false);
    }
  };

  /**
   * Switch between front and back cameras while keeping the scanner running.
   */
  const switchCamera = async () => {
    if (cameras.length < 2) {
      toast('Only one camera detected on this device', { icon: '📷' });
      return;
    }

    const newFacing = cameraFacing === 'front' ? 'back' : 'front';
    setCameraFacing(newFacing);

    // Find the camera in the list that matches the new facing
    let targetCam;
    if (newFacing === 'front') {
      targetCam =
        cameras.find((c) => /front|selfie|user|face/i.test(c.label || '')) ||
        (cameras.length >= 2 ? cameras[1] : cameras[0]);
    } else {
      targetCam =
        cameras.find((c) => /back|rear|environment|main|primary/i.test(c.label || '')) ||
        cameras[0];
    }

    const newId = targetCam?.id || cameras[0].id;
    setActiveCameraId(newId);

    if (scanning) {
      // Restart the scanner with the new camera
      await startScanner(newId);
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
      playTone('success');          // ✅ professional success beep
      toast.success(data.message);
      setScanTone('success');
      setScannerStatus('Scan successful');
      setManualToken('');
      await fetchPendingQRs();
      setSelectedQR(null);
    } catch (err) {
      const msg = err.response?.data?.message || 'Scan failed';
      setResult({ success: false, message: msg });
      playTone('error');            // ❌ professional failure buzz
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
    unlockAudio();
    if (!manualToken.trim()) return toast.error('Paste a QR token');
    await processToken(manualToken.trim());
    setManualToken('');
  };

  const handleScanFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    unlockAudio();
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
        <div
          className="security-panel-grid"
          style={{
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: isMobile ? 14 : 20,
          }}
        >

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
                  onClick={() => startScanner()}
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

              {/* Camera Switch Button */}
              <button
                id="switch-camera-btn"
                type="button"
                title={`Switch to ${cameraFacing === 'front' ? 'back' : 'front'} camera`}
                className="btn btn-ghost"
                onClick={switchCamera}
                style={{
                  minWidth: 44,
                  justifyContent: 'center',
                  fontSize: 20,
                  padding: '0 10px',
                  flexShrink: 0,
                }}
              >
                {cameraFacing === 'front' ? '🤳' : '📷'}
              </button>
            </div>

            {/* Camera label badge */}
            <div style={{
              marginTop: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}>
              <span style={{
                fontSize: 11,
                padding: '2px 10px',
                borderRadius: 99,
                background: cameraFacing === 'front' ? 'rgba(99,102,241,0.15)' : 'rgba(16,185,129,0.15)',
                color: cameraFacing === 'front' ? 'var(--primary-light)' : '#10b981',
                border: cameraFacing === 'front' ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(16,185,129,0.3)',
                fontWeight: 600,
              }}>
                {cameraFacing === 'front' ? '🤳 Front (Selfie)' : '📷 Back (Main)'}
              </span>
              {cameras.length > 1 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {cameras.length} cameras detected • tap 🤳/📷 to switch
                </span>
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

            {/* ── Loading ── */}
            {loading && (
              <div className="card" style={{
                textAlign: 'center',
                padding: '48px 24px',
                background: 'rgba(99,102,241,0.06)',
                border: '1px solid rgba(99,102,241,0.2)',
              }}>
                <div style={{
                  width: 64, height: 64,
                  borderRadius: '50%',
                  border: '3px solid rgba(99,102,241,0.15)',
                  borderTop: '3px solid var(--primary)',
                  animation: 'spin 0.8s linear infinite',
                  margin: '0 auto 20px',
                }} />
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 6 }}>
                  Verifying QR Code
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  Authenticating student and logging gate event...
                </div>
              </div>
            )}

            {/* ── Scan Result ── */}
            {result && !loading && (
              <div
                className="card"
                style={{
                  animation: 'resultSlideUp 0.35s cubic-bezier(0.22,1,0.36,1) both',
                  border: result.success
                    ? '1px solid rgba(16,185,129,0.35)'
                    : '1px solid rgba(239,68,68,0.35)',
                  background: result.success
                    ? 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.03) 100%)'
                    : 'linear-gradient(135deg, rgba(239,68,68,0.09) 0%, rgba(239,68,68,0.03) 100%)',
                  boxShadow: result.success
                    ? '0 0 32px rgba(16,185,129,0.12), 0 4px 24px rgba(0,0,0,0.3)'
                    : '0 0 32px rgba(239,68,68,0.12), 0 4px 24px rgba(0,0,0,0.3)',
                  padding: '28px 24px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {/* Ambient glow orb */}
                <div style={{
                  position: 'absolute', top: -40, right: -40,
                  width: 120, height: 120, borderRadius: '50%',
                  background: result.success
                    ? 'radial-gradient(circle, rgba(16,185,129,0.18), transparent 70%)'
                    : 'radial-gradient(circle, rgba(239,68,68,0.18), transparent 70%)',
                  pointerEvents: 'none',
                }} />

                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, position: 'relative' }}>
                  {/* Animated icon ring */}
                  <div style={{
                    position: 'relative',
                    flexShrink: 0,
                    width: 64, height: 64,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{
                      position: 'absolute', inset: 0,
                      borderRadius: '50%',
                      background: result.success
                        ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                      animation: 'iconRingPulse 2s ease-in-out infinite',
                    }} />
                    <div style={{
                      width: 54, height: 54,
                      borderRadius: '50%',
                      background: result.success
                        ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.22)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 28,
                    }}>
                      {result.success ? '✓' : '✕'}
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 800,
                      fontSize: 20,
                      letterSpacing: '-0.3px',
                      color: result.success ? '#10b981' : '#ef4444',
                      lineHeight: 1.2,
                    }}>
                      {result.success ? 'Gate Access Granted' : 'Access Denied'}
                    </div>
                    <div style={{
                      fontSize: 13,
                      color: 'var(--text-muted)',
                      marginTop: 4,
                      lineHeight: 1.4,
                    }}>
                      {result.message}
                    </div>
                  </div>
                </div>

                {/* ── SUCCESS ── */}
                {result.success && result.student && (() => {
                  const isIN = result.status === 'IN';
                  const initials = (result.student.name || '?')
                    .split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
                  return (
                    <>
                      {/* Status Banner */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        padding: '14px 20px',
                        borderRadius: 'var(--radius-lg)',
                        marginBottom: 20,
                        background: isIN
                          ? 'linear-gradient(90deg, rgba(16,185,129,0.22), rgba(16,185,129,0.08))'
                          : 'linear-gradient(90deg, rgba(99,102,241,0.22), rgba(99,102,241,0.08))',
                        border: isIN
                          ? '1px solid rgba(16,185,129,0.3)'
                          : '1px solid rgba(99,102,241,0.3)',
                        boxShadow: isIN
                          ? '0 0 20px rgba(16,185,129,0.10)'
                          : '0 0 20px rgba(99,102,241,0.10)',
                      }}>
                        <span style={{ fontSize: 26 }}>{isIN ? '🚪' : '🔓'}</span>
                        <div>
                          <div style={{
                            fontWeight: 800, fontSize: 17,
                            color: isIN ? '#10b981' : 'var(--primary-light)',
                            letterSpacing: '-0.2px',
                          }}>
                            {isIN ? 'ENTRY — CHECKED IN' : 'EXIT — CHECKED OUT'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {new Date(result.timestamp).toLocaleString('en-IN', {
                              dateStyle: 'medium', timeStyle: 'short',
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Student Card */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '16px',
                        borderRadius: 'var(--radius-lg)',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        marginBottom: 16,
                      }}>
                        {/* Avatar */}
                        <div style={{
                          width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
                          background: isIN
                            ? 'linear-gradient(135deg, #10b981, #059669)'
                            : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 800, fontSize: 17, color: '#fff',
                          boxShadow: isIN
                            ? '0 4px 12px rgba(16,185,129,0.35)'
                            : '0 4px 12px rgba(99,102,241,0.35)',
                        }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                            {result.student.name}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            {result.student.rollNumber || '—'} &nbsp;•&nbsp; {result.student.hostel || '—'}
                          </div>
                        </div>
                        <div style={{
                          fontSize: 11, fontWeight: 700,
                          padding: '3px 10px', borderRadius: 99,
                          background: isIN ? 'rgba(16,185,129,0.18)' : 'rgba(99,102,241,0.18)',
                          color: isIN ? '#10b981' : 'var(--primary-light)',
                          border: isIN ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(99,102,241,0.35)',
                          letterSpacing: '0.5px',
                        }}>
                          {isIN ? 'IN' : 'OUT'}
                        </div>
                      </div>

                      {/* Scan Again */}
                      <button
                        className="btn btn-ghost"
                        onClick={() => { setResult(null); startScanner(); }}
                        style={{ width: '100%', justifyContent: 'center', marginTop: 4, fontSize: 13 }}
                      >
                        <MdQrCodeScanner size={15} /> Scan Next Student
                      </button>
                    </>
                  );
                })()}

                {/* ── FAILURE ── */}
                {!result.success && (
                  <>
                    <div style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-lg)',
                      background: 'rgba(239,68,68,0.08)',
                      border: '1px solid rgba(239,68,68,0.2)',
                      marginBottom: 16,
                    }}>
                      <MdError size={20} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
                      <div style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.5 }}>
                        <strong style={{ color: '#ef4444' }}>Reason: </strong>
                        {result.message || 'The QR code could not be validated. It may be expired, already used, or invalid.'}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                      padding: '4px 0 8px',
                    }}>
                      Ask the student to regenerate their QR from the student portal.
                    </div>
                    <button
                      className="btn btn-ghost"
                      onClick={() => { setResult(null); startScanner(); }}
                      style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
                    >
                      <MdQrCodeScanner size={15} /> Try Again
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── Idle / Ready ── */}
            {!result && !loading && (
              <div className="card" style={{
                textAlign: 'center',
                padding: '48px 24px',
                background: 'rgba(255,255,255,0.015)',
                border: '1px dashed rgba(255,255,255,0.1)',
              }}>
                <div style={{
                  width: 72, height: 72,
                  borderRadius: '50%',
                  background: 'rgba(99,102,241,0.1)',
                  border: '2px dashed rgba(99,102,241,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 32, margin: '0 auto 16px',
                  animation: 'idlePulse 3s ease-in-out infinite',
                }}>
                  📱
                </div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                  Awaiting Scan
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.5 }}>
                  Start the camera, paste a JWT token,<br />or tap a pending request card below.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Pending QRs Live Panel ── */}
        <div className="card security-live-panel" style={{ marginTop: 24 }}>
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
                <div className="security-column">
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
                    <div className="security-column-body" style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                      — none —
                    </div>
                  ) : (
                    <div className="security-column-body security-scroll-list" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
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
                  className="security-column-grid"
                  style={{
                    gridTemplateColumns: isMobile
                      ? '1fr'
                      : 'repeat(4, minmax(0, 1fr))',
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
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes resultSlideUp {
          from { opacity: 0; transform: translateY(18px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes iconRingPulse {
          0%, 100% { transform: scale(1);   opacity: 0.7; }
          50%       { transform: scale(1.18); opacity: 0.25; }
        }
        @keyframes idlePulse {
          0%, 100% { transform: scale(1);    opacity: 0.8; }
          50%       { transform: scale(1.06); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
