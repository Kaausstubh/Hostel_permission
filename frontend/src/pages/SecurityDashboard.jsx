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
import { 
  MdCheckCircle, 
  MdError, 
  MdQrCodeScanner, 
  MdRefresh, 
  MdAccessTime, 
  MdBolt, 
  MdFlashlightOn, 
  MdFlashlightOff, 
  MdCenterFocusStrong 
} from 'react-icons/md';
import { useAuth } from '../context/AuthContext';
import { getHostelLabel } from '../utils/hostel';
import { resolveBackendOrigin } from '../services/backendUrl';
import io from 'socket.io-client';

const SCANNER_ELEMENT_ID = 'qr-reader';
const READY_STATUS = 'Camera ready — hold QR in view';
const ACTIVE_STATUS = 'Scanning… detecting QR code';
const MOVE_QR_STATUS = 'Pass verified — show next student QR';
const SCAN_SUCCESS_COOLDOWN_MS = 2500;
const SCAN_ERROR_COOLDOWN_MS = 1000;
const SAME_QR_CLEAR_FRAME_COUNT = 2;

export default function SecurityDashboard() {
  const { user } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [pendingQRs, setPendingQRs] = useState([]);
  const [selectedQR, setSelectedQR] = useState(null);
  const [scannerStatus, setScannerStatus] = useState('Scanner idle');
  const [cameraError, setCameraError] = useState('');
  const [scanTone, setScanTone] = useState('idle');
  const [isHardwareAccelerated, setIsHardwareAccelerated] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchActive, setTorchActive] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomRange, setZoomRange] = useState({ min: 1, max: 1 });
  const [searchByColumn, setSearchByColumn] = useState({
    dailyOut: '',
    dailyIn: '',
    homeAwaiting: '',
    homeGone: '',
    homeReturn: '',
  });
  const scannerRef = useRef(null);
  const fileInputRef = useRef(null);
  const isProcessingScanRef = useRef(false);
  const recentScansRef = useRef(new Map());
  const frameErrorDebounceRef = useRef(null); // debounce frame-error status updates
  const feedbackResetTimeoutRef = useRef(null);
  const feedbackHoldUntilRef = useRef(0);
  const blockedTokenUntilClearRef = useRef('');
  const clearFrameStreakRef = useRef(0);
  const hardwareLoopActiveRef = useRef(false);
  const hardwareRafRef = useRef(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Camera management
  const [cameras, setCameras] = useState([]);          // [{id, label}]
  const [activeCameraId, setActiveCameraId] = useState(null); // currently selected camera id
  const [cameraFacing, setCameraFacing] = useState('back'); // 'front' | 'back'

  // Live gate clock (Asia/Kolkata)
  const [currentLiveTime, setCurrentLiveTime] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentLiveTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Audio Feedback (Web Audio API — pre-warmed for 0ms lag) ──────────────
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
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.001);
    } catch (e) {}
  };

  // Pre-warm audio on initial user touch or click
  useEffect(() => {
    const handleInitialUserGesture = () => {
      unlockAudio();
      window.removeEventListener('click', handleInitialUserGesture);
      window.removeEventListener('touchstart', handleInitialUserGesture);
    };
    window.addEventListener('click', handleInitialUserGesture, { once: true });
    window.addEventListener('touchstart', handleInitialUserGesture, { once: true });
    return () => {
      window.removeEventListener('click', handleInitialUserGesture);
      window.removeEventListener('touchstart', handleInitialUserGesture);
    };
  }, []);

  /** Play a crisp, high-speed professional scanner tone */
  const playTone = useCallback((type) => {
    try {
      const ctx = getAudioCtx();
      const master = ctx.createGain();
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.connect(ctx.destination);

      if (type === 'success') {
        // High-speed dual chime: crisp affirmative checkout tone (659.25Hz -> 880Hz)
        const notes = [659.25, 880.0];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.07);
          gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.07);
          gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + i * 0.07 + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.07 + 0.1);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.07);
          osc.stop(ctx.currentTime + i * 0.07 + 0.11);
        });
      } else {
        // Fast dual error tone
        const notes = [220.0, 164.81];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
          gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
          gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + i * 0.12 + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.14);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.12);
          osc.stop(ctx.currentTime + i * 0.12 + 0.15);
        });
      }
    } catch (e) {
      // Audio not supported — silent fallback
    }
  }, []);

  // Real-time visitor pass alerts at security gate (audio chime + toast)
  useEffect(() => {
    let socket;
    try {
      const backendOrigin = resolveBackendOrigin();
      socket = io(`${backendOrigin}/scanner`, {
        transports: ['websocket', 'polling'],
        auth: { token: localStorage.getItem('token') },
      });

      socket.on('visitor:new', (data) => {
        if (data?.action === 'request') {
          toast(`🔔 Visitor pass created for ${data?.visitor?.name || 'Visitor'} — awaiting student response`, {
            id: 'sec-vis-req',
            duration: 4500,
          });
        }
      });

      socket.on('visitor:student_response', (data) => {
        const sName = data?.studentName || data?.visitor?.studentName || 'Student';
        const vName = data?.visitor?.name || 'Visitor';
        if (data?.action === 'APPROVE') {
          playTone('success');
          toast((t) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 }}>
              <div style={{ fontWeight: 700, color: '#059669', fontSize: 13.5 }}>
                🟢 {sName} ACCEPTED {vName}'s Visitor Request!
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary, #475569)' }}>
                Student verified request from portal. Security can now grant gate entry.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  style={{
                    background: '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  onClick={async () => {
                    toast.dismiss(t.id);
                    try {
                      await api.post(`/visitors/${data.visitor?._id}/staff-action`, { action: 'APPROVE' });
                      toast.success(`🚪 Entry granted! ${vName} admitted inside campus.`);
                    } catch (err) {
                      toast.error('Failed to grant gate entry');
                    }
                  }}
                >
                  🚪 Grant Entry Now
                </button>
                <button
                  type="button"
                  style={{
                    background: 'transparent',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                  onClick={() => toast.dismiss(t.id)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ), { id: `sec-vis-${data?.visitor?._id}`, duration: 10000 });
        } else {
          playTone('error');
          toast.error(`🔴 ${sName} REJECTED ${vName}'s visitor pass. Do NOT allow entry.`, {
            id: `sec-vis-${data?.visitor?._id}`,
            duration: 6500,
          });
        }
      });
    } catch (e) {
      console.warn('[SecurityDashboard] Socket connection error:', e);
    }

    return () => {
      if (socket) socket.disconnect();
    };
  }, [playTone]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const scannerRoot = document.getElementById(SCANNER_ELEMENT_ID);
    if (!scannerRoot) return;

    const shadedRegion = scannerRoot.querySelector('#qr-shaded-region');
    if (!shadedRegion) return;

    const toneColor =
      scanTone === 'success'
        ? '#10b981'
        : scanTone === 'error'
          ? '#ef4444'
          : scanning
            ? '#6366f1'
            : '#f8fafc';
    const toneGlow =
      scanTone === 'success'
        ? '0 0 18px rgba(16,185,129,0.42)'
        : scanTone === 'error'
          ? '0 0 18px rgba(239,68,68,0.42)'
          : scanning
            ? '0 0 14px rgba(99,102,241,0.24)'
            : 'none';

    shadedRegion.style.transition = 'box-shadow 120ms ease';
    shadedRegion.style.boxShadow = toneGlow;
    shadedRegion.querySelectorAll('div').forEach((piece) => {
      piece.style.backgroundColor = toneColor;
      piece.style.boxShadow = toneGlow;
      piece.style.transition = 'background-color 120ms ease, box-shadow 120ms ease';
    });
  }, [scanTone, scanning]);

  // ── Poll pending QRs every 5 seconds ─────────────────────────────────────
  const fetchPendingQRs = async () => {
    try {
      const res = await api.get('/gatescan/pending-qrs', {
        params: { limit: 500 },
        timeout: 15000,
      });
      setPendingQRs(res.data.qrs || []);
    } catch (err) {
      if (err.response?.status !== 401) {
        console.warn('pending-qrs:', err.response?.data?.message || err.message);
      }
    }
  };

  useEffect(() => {
    fetchPendingQRs();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        fetchPendingQRs();
      }
    }, 5000);

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        fetchPendingQRs();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, []);

  // ── Scanner Controls ──────────────────────────────────────────────────────

  /**
   * Load all available cameras and pick the best default.
   * Primary = back/environment (for scanning QR codes); secondary = front/selfie.
   * Returns the id of the chosen camera.
   */
  const loadCameras = async () => {
    const list = await Html5Qrcode.getCameras();
    if (!list || list.length === 0) throw new Error('No camera found on this device');
    setCameras(list);

    const back = list.find((c) =>
      /back|rear|environment|main|primary/i.test(c.label || '')
    );
    const front = list.find((c) =>
      /front|selfie|user|face/i.test(c.label || '')
    );

    // Default: back camera for QR scanning. If not identified by label but 2+ cams exist,
    // index 0 is typically the back camera on mobile.
    let chosen;
    if (back) {
      chosen = back;
      setCameraFacing('back');
    } else if (list.length >= 2) {
      chosen = list[0];
      setCameraFacing('back');
    } else {
      chosen = front || list[0];
      setCameraFacing(front ? 'front' : 'back');
    }

    setActiveCameraId(chosen.id);
    return chosen.id;
  };

  const stopHardwareDetector = () => {
    hardwareLoopActiveRef.current = false;
    if (hardwareRafRef.current) {
      cancelAnimationFrame(hardwareRafRef.current);
      hardwareRafRef.current = null;
    }
    setIsHardwareAccelerated(false);
  };

  /**
   * Inspect and negotiate advanced hardware capabilities:
   * Continuous autofocus, continuous exposure, torch (flashlight), and optical/digital zoom.
   */
  const inspectCameraCapabilities = async (scanner) => {
    try {
      const track = scanner?.getRunningTrack?.();
      if (!track || typeof track.getCapabilities !== 'function') return;

      const caps = track.getCapabilities();
      const advanced = [];

      // Continuous autofocus
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      }
      // Continuous auto-exposure
      if (caps.exposureMode && caps.exposureMode.includes('continuous')) {
        advanced.push({ exposureMode: 'continuous' });
      }
      // Continuous auto white-balance
      if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) {
        advanced.push({ whiteBalanceMode: 'continuous' });
      }
      if (advanced.length > 0) {
        try { await track.applyConstraints({ advanced }); } catch (e) {}
      }

      // Check Torch (flashlight)
      if (caps.torch) {
        setTorchSupported(true);
        setTorchActive(false);
      } else {
        setTorchSupported(false);
        setTorchActive(false);
      }

      // Check Zoom
      if (caps.zoom) {
        const minZ = caps.zoom.min || 1;
        const maxZ = Math.min(caps.zoom.max || 3, 3);
        setZoomSupported(maxZ > minZ);
        setZoomRange({ min: minZ, max: maxZ });
        setZoomLevel(minZ);
      } else {
        setZoomSupported(false);
      }
    } catch (e) {
      console.warn('Camera capabilities setup warning:', e);
    }
  };

  /**
   * Launch high-speed direct hardware BarcodeDetector loop directly on raw HTMLVideoElement.
   * Runs at full hardware sensor refresh (60 FPS) with 0 canvas conversion overhead.
   */
  const startHardwareDetector = (videoEl, onScanSuccessCb) => {
    stopHardwareDetector();
    if (!('BarcodeDetector' in window)) return;

    try {
      const barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      hardwareLoopActiveRef.current = true;
      setIsHardwareAccelerated(true);

      const checkFrame = async () => {
        if (!hardwareLoopActiveRef.current) return;
        if (!videoEl || videoEl.paused || videoEl.ended || videoEl.readyState < 2) {
          scheduleNext();
          return;
        }

        if (!isProcessingScanRef.current) {
          try {
            const barcodes = await barcodeDetector.detect(videoEl);
            if (barcodes && barcodes.length > 0 && barcodes[0]?.rawValue) {
              await onScanSuccessCb(barcodes[0].rawValue);
            }
          } catch (e) {
            // Frame error, continue next frame
          }
        }

        scheduleNext();
      };

      const scheduleNext = () => {
        if (!hardwareLoopActiveRef.current) return;
        if ('requestVideoFrameCallback' in videoEl) {
          videoEl.requestVideoFrameCallback(checkFrame);
        } else {
          hardwareRafRef.current = requestAnimationFrame(checkFrame);
        }
      };

      scheduleNext();
    } catch (err) {
      console.warn('Native BarcodeDetector not available:', err);
    }
  };

  /** Toggle phone flashlight for dark gate conditions */
  const toggleTorch = async () => {
    try {
      const track = scannerRef.current?.getRunningTrack?.();
      if (!track) return;
      const nextTorch = !torchActive;
      await track.applyConstraints({
        advanced: [{ torch: nextTorch }],
      });
      setTorchActive(nextTorch);
      toast(nextTorch ? '🔦 Flashlight turned ON' : '🔦 Flashlight turned OFF', { duration: 1200 });
    } catch (e) {
      toast.error('Torch not available on this camera');
    }
  };

  /** Instant zoom switcher for scanning passes at a distance */
  const applyZoom = async (level) => {
    try {
      const track = scannerRef.current?.getRunningTrack?.();
      if (!track) return;
      await track.applyConstraints({
        advanced: [{ zoom: level }],
      });
      setZoomLevel(level);
    } catch (e) {
      console.warn('Zoom error:', e);
    }
  };

  const resetFrameClearGate = () => {
    blockedTokenUntilClearRef.current = '';
    clearFrameStreakRef.current = 0;
  };

  const blockTokenUntilItLeavesFrame = (normalized) => {
    blockedTokenUntilClearRef.current = normalized;
    clearFrameStreakRef.current = 0;
  };

  const releaseBlockedTokenIfFrameCleared = () => {
    if (!blockedTokenUntilClearRef.current) return false;

    clearFrameStreakRef.current += 1;
    if (clearFrameStreakRef.current < SAME_QR_CLEAR_FRAME_COUNT) return false;

    blockedTokenUntilClearRef.current = '';
    clearFrameStreakRef.current = 0;
    return true;
  };

  const scheduleFeedbackReset = (tone) => {
    const feedbackMs =
      tone === 'success' ? 900 : tone === 'error' ? 1000 : 300;

    feedbackHoldUntilRef.current = Date.now() + feedbackMs;

    if (feedbackResetTimeoutRef.current) {
      clearTimeout(feedbackResetTimeoutRef.current);
    }

    feedbackResetTimeoutRef.current = setTimeout(() => {
      feedbackResetTimeoutRef.current = null;
      if (!isProcessingScanRef.current) {
        setScanTone('idle');
        setScannerStatus(
          blockedTokenUntilClearRef.current ? MOVE_QR_STATUS : READY_STATUS
        );
        resumeLiveScanner();
      }
    }, feedbackMs);
  };

  /**
   * Start the QR scanner.
   * Default: back camera via facingMode "environment" (reliable on mobile).
   * Pass overrideCameraId when switching to a specific enumerated device.
   */
  const startScanner = async (overrideCameraId) => {
    unlockAudio(); // Force unlock audio context on user click

    // Always teardown stale instance first
    stopHardwareDetector();
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }

    resetFrameClearGate();
    setResult(null);
    setCameraError('');
    setScanTone('idle');
    setScannerStatus('Starting high-speed camera...');
    feedbackHoldUntilRef.current = 0;
    if (feedbackResetTimeoutRef.current) {
      clearTimeout(feedbackResetTimeoutRef.current);
      feedbackResetTimeoutRef.current = null;
    }

    try {
      let desiredCameraId = overrideCameraId || activeCameraId;
      if (!desiredCameraId) {
        desiredCameraId = cameras.length > 0 ? cameras[0].id : await loadCameras();
      }

      const useDeviceId = Boolean(desiredCameraId);
      const facingMode = cameraFacing === 'back' ? 'environment' : 'user';
      const cameraConfig = useDeviceId
        ? desiredCameraId
        : { facingMode };

      const scanner = new Html5Qrcode(
        SCANNER_ELEMENT_ID,
        {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: true,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false,
        }
      );

      const scanConfig = {
        fps: 30,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          // Generous wide aperture (94% of viewfinder) so passes scan instantly without tight alignment
          const width = Math.max(260, Math.floor(viewfinderWidth * 0.94));
          const height = Math.max(260, Math.floor(viewfinderHeight * 0.94));
          return { width, height };
        },
        disableFlip: cameraFacing !== 'front',
        videoConstraints: useDeviceId
          ? {
              deviceId: { exact: desiredCameraId },
              width: { ideal: 1280, min: 640 },
              height: { ideal: 720, min: 480 },
              frameRate: { ideal: 30, max: 60 },
            }
          : {
              facingMode: { ideal: facingMode },
              width: { ideal: 1280, min: 640 },
              height: { ideal: 720, min: 480 },
              frameRate: { ideal: 30, max: 60 },
            },
      };

      const onScanSuccess = async (decodedText) => {
        const normalized = normalizeToken(decodedText);
        if (!normalized) {
          unlockAudio();
          setScanTone('error');
          playTone('error');
          try { navigator.vibrate?.([100, 50, 100]); } catch {}
          setResult({
            success: false,
            message: 'Unrecognized QR — use a HEIMDALL daily or home visit gate pass',
          });
          setScannerStatus('QR detected but unreadable');
          scheduleFeedbackReset('error');
          return;
        }
        clearFrameStreakRef.current = 0;
        if (blockedTokenUntilClearRef.current === normalized) {
          setScannerStatus(MOVE_QR_STATUS);
          return;
        }
        if (isProcessingScanRef.current) return;
        if (shouldIgnoreRecentScan(normalized)) return;

        // Instant lock & hardware pause: stops further video frame analysis immediately
        isProcessingScanRef.current = true;
        pauseLiveScanner();
        setScannerStatus('QR detected — verifying...');
        await processToken(normalized);
      };

      const onScanFailure = () => {
        releaseBlockedTokenIfFrameCleared();
        if (Date.now() < feedbackHoldUntilRef.current) return;

        // Frame-level errors (no QR in frame) — debounce status updates to prevent re-render storm
        if (frameErrorDebounceRef.current) return;
        frameErrorDebounceRef.current = setTimeout(() => {
          frameErrorDebounceRef.current = null;
          if (!isProcessingScanRef.current) {
            setScannerStatus(
              blockedTokenUntilClearRef.current ? MOVE_QR_STATUS : ACTIVE_STATUS
            );
          }
        }, 500);
      };

      try {
        await scanner.start(cameraConfig, scanConfig, onScanSuccess, onScanFailure);
      } catch (firstError) {
        if (useDeviceId) {
          // Fallback to facingMode if specific deviceId failed
          await scanner.start(
            { facingMode },
            { ...scanConfig, videoConstraints: { facingMode: { ideal: facingMode } } },
            onScanSuccess,
            onScanFailure
          );
        } else {
          throw firstError;
        }
      }

      // 1. Inspect camera sensor capabilities: continuous focus, exposure, torch, zoom
      await inspectCameraCapabilities(scanner);

      // 2. Launch high-speed direct hardware BarcodeDetector loop on raw video element if supported
      const videoEl = document.querySelector(`#${SCANNER_ELEMENT_ID} video`);
      if (videoEl) {
        startHardwareDetector(videoEl, onScanSuccess);
      }

      scannerRef.current = scanner;
      setActiveCameraId(desiredCameraId);
      setScanning(true);
      setScannerStatus(READY_STATUS);
    } catch (error) {
      const msg = error?.message || 'Unable to start scanner';
      setCameraError(msg);
      setScannerStatus('Scanner failed to start');
      setScanTone('error');
      toast.error(msg);
      stopHardwareDetector();
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
    stopHardwareDetector();
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
    setTorchActive(false);
    resetFrameClearGate();
    feedbackHoldUntilRef.current = 0;
    if (feedbackResetTimeoutRef.current) {
      clearTimeout(feedbackResetTimeoutRef.current);
      feedbackResetTimeoutRef.current = null;
    }
    if (!preserveFeedback) {
      setScannerStatus('Scanner stopped');
      setScanTone('idle');
    }
  };

  useEffect(() => {
    return () => {
      stopHardwareDetector();
      if (scannerRef.current) {
        try { scannerRef.current.stop(); } catch {}
        try { scannerRef.current.clear(); } catch {}
      }
      // Clear any pending debounce timers
      if (frameErrorDebounceRef.current) {
        clearTimeout(frameErrorDebounceRef.current);
        frameErrorDebounceRef.current = null;
      }
      if (feedbackResetTimeoutRef.current) {
        clearTimeout(feedbackResetTimeoutRef.current);
        feedbackResetTimeoutRef.current = null;
      }
    };
  }, []);

  // ── Process Token ─────────────────────────────────────────────────────────
  const normalizeToken = (raw) => {
    let trimmed = String(raw || '')
      .replace(/[\uFEFF\u200B\u00A0]/g, '')
      .trim()
      .replace(/\s+/g, '');
    if (!trimmed) return '';

    try {
      if (/^https?:\/\//i.test(trimmed)) {
        const url = new URL(trimmed);
        const fromQuery =
          url.searchParams.get('token') ||
          url.searchParams.get('t') ||
          url.searchParams.get('qr');
        if (fromQuery) trimmed = fromQuery.trim();
      }
    } catch {
      // not a URL
    }

    const jwtMatch = trimmed.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (jwtMatch) return jwtMatch[0];

    const ioMatch = trimmed.match(/IO-[A-Za-z0-9_-]+/i);
    if (ioMatch) return `IO-${ioMatch[0].slice(3)}`;

    const hvMatch = trimmed.match(/HV-[A-Za-z0-9_-]+/i);
    if (hvMatch) return `HV-${hvMatch[0].slice(3)}`;

    return trimmed;
  };

  const shouldIgnoreRecentScan = (normalized) => {
    const entry = recentScansRef.current.get(normalized);
    if (!entry) return false;
    const cooldown = entry.ok ? SCAN_SUCCESS_COOLDOWN_MS : SCAN_ERROR_COOLDOWN_MS;
    return Date.now() - entry.at < cooldown;
  };

  const markRecentScan = (normalized, ok) => {
    recentScansRef.current.set(normalized, { at: Date.now(), ok });
    if (recentScansRef.current.size > 80) {
      const now = Date.now();
      for (const [key, value] of recentScansRef.current) {
        if (now - value.at > 60000) recentScansRef.current.delete(key);
      }
    }
  };

  const dismissResult = () => {
    setResult(null);
    setScanTone('idle');
    resumeLiveScanner();

    if (scanning) {
      setScannerStatus(
        blockedTokenUntilClearRef.current ? MOVE_QR_STATUS : READY_STATUS
      );
      return;
    }

    startScanner();
  };

  const pauseLiveScanner = async () => {
    try {
      if (scannerRef.current?.isScanning) await scannerRef.current.pause(true);
    } catch {
      // pause not supported on some browsers — lock ref still prevents duplicates
    }
  };

  const resumeLiveScanner = async () => {
    try {
      if (scannerRef.current?.isScanning) await scannerRef.current.resume();
    } catch {}
  };

  const processToken = async (token) => {
    const normalized = normalizeToken(token);
    if (!normalized) {
      isProcessingScanRef.current = false;
      resumeLiveScanner();
      return;
    }
    if (shouldIgnoreRecentScan(normalized)) {
      isProcessingScanRef.current = false;
      resumeLiveScanner();
      return;
    }

    isProcessingScanRef.current = true;
    pauseLiveScanner();
    setLoading(true);
    setResult(null);
    let feedbackTone = 'idle';

    try {
      const res = await api.post('/gatescan/scan', { token: normalized }, { timeout: 10000 });
      const data = res.data;
      setResult({
        success: true,
        code: data.code || 'VALID',
        student: data.student,
        status: data.log?.status,
        timestamp: data.log?.timestamp || new Date().toISOString(),
        message: data.message,
        scanDuration: data.scanDuration,
        scannedByName: data.scannedByName || data.guardInCharge,
      });
      markRecentScan(normalized, true);
      blockTokenUntilItLeavesFrame(normalized);
      playTone('success');
      try { navigator.vibrate?.([80]); } catch {}
      toast.success(data.message, { duration: 2500 });
      feedbackTone = 'success';
      setScanTone('success');
      setScannerStatus('✓ Pass verified — check student photo & allow passage');
      setManualToken('');
      setSelectedQR(null);
      fetchPendingQRs();
    } catch (err) {
      const errData = err.response?.data || {};
      const msg = errData.message || 'Scan failed';
      const code = errData.code || (err.response?.status === 409 ? 'ALREADY_USED' : 'INVALID');
      if (err.response?.status !== 409) {
        markRecentScan(normalized, false);
      }
      blockTokenUntilItLeavesFrame(normalized);
      setResult({
        success: false,
        code,
        message: msg,
        student: errData.student || null,
      });
      playTone('error');
      try { navigator.vibrate?.([120, 60, 120]); } catch {}
      feedbackTone = 'error';
      setScanTone('error');
      setScannerStatus(msg);
      if (code === 'EXPIRED') {
        toast.error(`⚠️ EXPIRED PASS: Stored screenshot older than 20s rejected.`, { duration: 5000, id: 'scan-expired-alert' });
      } else if (code === 'ALREADY_USED') {
        toast.error(`🛑 REPLAY DETECTED: This QR token was already used.`, { duration: 5000, id: 'scan-replay-alert' });
      } else if (err.response?.status === 409) {
        toast.error(`⏳ ${msg}`, { duration: 4500, id: 'scan-cooldown-alert' });
      } else {
        toast.error(msg, { duration: 3000 });
      }
    } finally {
      isProcessingScanRef.current = false;
      setLoading(false);
      scheduleFeedbackReset(feedbackTone);
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
      [item.studentName, item.rollNumber, item.hostel, getHostelLabel(item.hostel, '')]
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

        <div className="security-dashboard-layout">
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>📷 Gate QR Scanner (Daily + Home Visit)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 99,
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  color: '#10b981',
                  fontWeight: 600,
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
                  <span>{currentLiveTime.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} IST</span>
                </div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 99,
                  background: 'rgba(99, 102, 241, 0.12)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  color: 'var(--primary-light)',
                }}>
                  <span>🛡️ Guard:</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{user?.name || user?.rollNo || 'Security Guard'}</span>
                </div>
              </div>
            </div>

            <div style={{ position: 'relative' }}>
              <div
                id={SCANNER_ELEMENT_ID}
                style={{
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  background: 'rgba(2,6,23,0.32)',
                  border:
                    scanTone === 'success'
                      ? '4px solid #10b981'
                      : scanTone === 'error'
                        ? '4px solid #ef4444'
                        : scanning
                          ? '3px solid rgba(99,102,241,0.92)'
                          : '1px solid rgba(255,255,255,0.08)',
                  boxShadow:
                    scanTone === 'success'
                      ? '0 0 0 5px rgba(16,185,129,0.35), 0 0 32px rgba(16,185,129,0.45)'
                      : scanTone === 'error'
                        ? '0 0 0 5px rgba(239,68,68,0.35), 0 0 32px rgba(239,68,68,0.45)'
                        : scanning
                          ? '0 0 0 4px rgba(99,102,241,0.2)'
                          : 'none',
                  minHeight: 320,
                  transition: 'border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease',
                  transform: scanTone === 'success' ? 'scale(1.004)' : 'translateZ(0)',
                }}
              />

              {/* High-Tech Fast Scanner HUD Overlay */}
              {scanning && (
                <div className="scanner-hud-overlay">
                  {/* Top HUD bar with Hardware acceleration status, Torch & Zoom */}
                  <div className="scanner-hud-top">
                    <div className="scanner-hud-badge">
                      {isHardwareAccelerated ? (
                        <>
                          <MdBolt style={{ color: '#fbbf24', fontSize: 14 }} />
                          <span>Hardware Accelerated (60 FPS)</span>
                        </>
                      ) : (
                        <>
                          <MdCenterFocusStrong style={{ color: '#38bdf8', fontSize: 14 }} />
                          <span>Wide-Angle Instant Scan</span>
                        </>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {/* Torch Button if supported on device */}
                      {torchSupported && (
                        <button
                          type="button"
                          onClick={toggleTorch}
                          className={`btn btn-sm ${torchActive ? 'btn-warning' : 'btn-ghost'}`}
                          style={{
                            padding: '4px 10px',
                            fontSize: 12,
                            borderRadius: 99,
                            background: torchActive ? '#f59e0b' : 'rgba(15, 23, 42, 0.75)',
                            color: torchActive ? '#000' : '#fff',
                            border: '1px solid rgba(255,255,255,0.2)',
                            backdropFilter: 'blur(6px)',
                          }}
                          title={torchActive ? 'Turn Torch Off' : 'Turn Torch On'}
                        >
                          {torchActive ? <MdFlashlightOn size={15} /> : <MdFlashlightOff size={15} />}
                          <span>{torchActive ? 'Torch ON' : 'Torch'}</span>
                        </button>
                      )}

                      {/* Zoom Pills if supported */}
                      {zoomSupported && zoomRange.max > 1 && (
                        <div style={{
                          display: 'inline-flex',
                          borderRadius: 99,
                          background: 'rgba(15, 23, 42, 0.75)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          padding: 2,
                          backdropFilter: 'blur(6px)',
                        }}>
                          {[1, 1.5, 2].filter((lvl) => lvl <= zoomRange.max).map((lvl) => (
                            <button
                              key={lvl}
                              type="button"
                              onClick={() => applyZoom(lvl)}
                              style={{
                                border: 'none',
                                background: Math.abs(zoomLevel - lvl) < 0.2 ? 'var(--primary)' : 'transparent',
                                color: '#fff',
                                padding: '2px 8px',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {lvl}x
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Corner Targeting Brackets */}
                  <div className="scanner-corner scanner-corner-tl" />
                  <div className="scanner-corner scanner-corner-tr" />
                  <div className="scanner-corner scanner-corner-bl" />
                  <div className="scanner-corner scanner-corner-br" />

                  {/* Animated Laser Scanning Line */}
                  <div className="scanner-laser" />

                  {/* Instant Success Flash Ripple */}
                  {scanTone === 'success' && <div className="scanner-flash-success" />}
                </div>
              )}
            </div>

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

            {/* Camera label and speed status badges */}
            <div style={{
              marginTop: 8,
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
              {scanning && (
                <span style={{
                  fontSize: 11,
                  padding: '2px 10px',
                  borderRadius: 99,
                  background: isHardwareAccelerated ? 'rgba(245,158,11,0.15)' : 'rgba(56,189,248,0.15)',
                  color: isHardwareAccelerated ? '#f59e0b' : '#38bdf8',
                  border: isHardwareAccelerated ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(56,189,248,0.3)',
                  fontWeight: 600,
                }}>
                  {isHardwareAccelerated ? '⚡ 60 FPS GPU Pipeline' : '⚡ Wide Aperture Scan'}
                </span>
              )}
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
                  placeholder="Paste QR token here..."
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
            {result && !loading && (() => {
              const code = result.code || (result.success ? 'VALID' : 'INVALID');
              const isSuccess = result.success;
              const isExpired = code === 'EXPIRED' || (!isSuccess && result.message?.toLowerCase().includes('expired'));
              const isAlreadyUsed = code === 'ALREADY_USED' || (!isSuccess && result.message?.toLowerCase().includes('already'));
              const isRevoked = code === 'REVOKED' || (!isSuccess && result.message?.toLowerCase().includes('deactivated'));

              const themeColor = isSuccess
                ? '#10b981'
                : isExpired
                ? '#f59e0b'
                : isAlreadyUsed
                ? '#f43f5e'
                : '#ef4444';

              const cardBorder = isSuccess
                ? '1px solid rgba(16,185,129,0.4)'
                : isExpired
                ? '1px solid rgba(245,158,11,0.45)'
                : isAlreadyUsed
                ? '1px solid rgba(244,63,94,0.45)'
                : '1px solid rgba(239,68,68,0.45)';

              const cardBg = isSuccess
                ? 'linear-gradient(135deg, rgba(16,185,129,0.09) 0%, rgba(16,185,129,0.03) 100%)'
                : isExpired
                ? 'linear-gradient(135deg, rgba(245,158,11,0.11) 0%, rgba(245,158,11,0.03) 100%)'
                : isAlreadyUsed
                ? 'linear-gradient(135deg, rgba(244,63,94,0.11) 0%, rgba(244,63,94,0.03) 100%)'
                : 'linear-gradient(135deg, rgba(239,68,68,0.11) 0%, rgba(239,68,68,0.03) 100%)';

              const statusBadgeText = isSuccess
                ? 'VALID'
                : isExpired
                ? 'EXPIRED'
                : isAlreadyUsed
                ? 'ALREADY USED'
                : isRevoked
                ? 'REVOKED'
                : 'INVALID';

              const headerTitle = isSuccess
                ? 'Gate Access Authorized'
                : isExpired
                ? 'Pass Expired (> 20s Lifetime)'
                : isAlreadyUsed
                ? 'Replay Detected — Token Already Used'
                : isRevoked
                ? 'Account Revoked / Deactivated'
                : 'Access Denied — Invalid Token';

              return (
                <div
                  className="card"
                  style={{
                    animation: 'resultSlideUp 0.35s cubic-bezier(0.22,1,0.36,1) both',
                    border: cardBorder,
                    background: cardBg,
                    boxShadow: `0 0 32px ${themeColor}22, 0 4px 24px rgba(0,0,0,0.3)`,
                    padding: '28px 24px',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {/* Ambient glow orb */}
                  <div style={{
                    position: 'absolute', top: -40, right: -40,
                    width: 130, height: 130, borderRadius: '50%',
                    background: `radial-gradient(circle, ${themeColor}2a, transparent 70%)`,
                    pointerEvents: 'none',
                  }} />

                  {/* Header row with Status Badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, position: 'relative' }}>
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
                        background: `${themeColor}26`,
                        animation: 'iconRingPulse 2s ease-in-out infinite',
                      }} />
                      <div style={{
                        width: 54, height: 54,
                        borderRadius: '50%',
                        background: `${themeColor}38`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 26,
                        color: themeColor,
                        fontWeight: 900,
                      }}>
                        {isSuccess ? '✓' : isExpired ? '⏳' : isAlreadyUsed ? '🛑' : '✕'}
                      </div>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 11,
                          fontWeight: 900,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          padding: '3px 10px',
                          borderRadius: 999,
                          background: `${themeColor}22`,
                          color: themeColor,
                          border: `1px solid ${themeColor}55`,
                        }}>
                          ● {statusBadgeText}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Anti-Replay Verification
                        </span>
                      </div>
                      <div style={{
                        fontWeight: 800,
                        fontSize: 19,
                        letterSpacing: '-0.3px',
                        color: themeColor,
                        lineHeight: 1.25,
                      }}>
                        {headerTitle}
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

                  {/* ── SUCCESS: IDENTITY VERIFICATION & STUDENT DETAILS ── */}
                  {isSuccess && result.student && (() => {
                    const status = result.status || '';
                    const isHome = status.startsWith('HOME');
                    const isIN = status === 'IN' || status === 'HOME IN';
                    const isHomeOut = status === 'HOME OUT';
                    const bannerLabel = isHome
                      ? (isHomeOut ? 'HOME VISIT — DEPARTURE' : 'HOME VISIT — RETURN')
                      : (isIN ? 'ENTRY — CHECKED IN' : 'EXIT — CHECKED OUT');
                    const bannerEmoji = isHome ? (isHomeOut ? '🏠' : '🏡') : (isIN ? '🚪' : '🔓');
                    const initials = (result.student.name || '?')
                      .split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();

                    return (
                      <>
                        {/* ⚠️ HIGH-VISIBILITY MANDATORY PHOTO COMPARISON PROMPT */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 12,
                          padding: '12px 16px',
                          borderRadius: 'var(--radius-lg)',
                          background: 'rgba(245, 158, 11, 0.12)',
                          border: '1.5px solid rgba(245, 158, 11, 0.45)',
                          marginBottom: 16,
                          boxShadow: '0 4px 16px rgba(245, 158, 11, 0.1)',
                        }}>
                          <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>👤</span>
                          <div style={{ fontSize: 12.5, lineHeight: 1.45, color: '#fef3c7' }}>
                            <strong style={{ color: '#fbbf24', display: 'block', fontSize: 13, marginBottom: 2 }}>
                              MANDATORY PHYSICAL IDENTITY VERIFICATION
                            </strong>
                            Guard must visually compare the person physically standing at the gate with the registered student photo and ID credentials below before granting passage.
                          </div>
                        </div>

                        {/* Status Banner */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 12,
                          padding: '12px 20px',
                          borderRadius: 'var(--radius-lg)',
                          marginBottom: 18,
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
                          <span style={{ fontSize: 24 }}>{bannerEmoji}</span>
                          <div>
                            <div style={{
                              fontWeight: 800, fontSize: 16,
                              color: isIN ? '#10b981' : 'var(--primary-light)',
                              letterSpacing: '-0.2px',
                            }}>
                              {bannerLabel}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <MdAccessTime size={14} color="var(--primary-light)" />
                              <span>
                                Scanned at: <strong style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                                  {new Date(result.timestamp || Date.now()).toLocaleTimeString('en-IN', {
                                    timeZone: 'Asia/Kolkata',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                    hour12: false,
                                  })} IST
                                </strong>
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Prominent Registered Student Identity Card */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 16,
                          padding: '18px',
                          borderRadius: 'var(--radius-lg)',
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          marginBottom: 16,
                        }}>
                          {/* Large Registered Student Photo */}
                          {result.student.picture ? (
                            <img
                              src={result.student.picture}
                              alt={result.student.name}
                              style={{
                                width: 76,
                                height: 76,
                                borderRadius: 14,
                                objectFit: 'cover',
                                flexShrink: 0,
                                border: '3px solid #10b981',
                                boxShadow: '0 0 20px rgba(16,185,129,0.4)',
                              }}
                            />
                          ) : (
                            <div style={{
                              width: 76, height: 76, borderRadius: 14, flexShrink: 0,
                              background: 'linear-gradient(135deg, #10b981, #059669)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 900, fontSize: 24, color: '#fff',
                              boxShadow: '0 4px 16px rgba(16,185,129,0.35)',
                              border: '3px solid rgba(255,255,255,0.2)',
                            }}>
                              {initials}
                            </div>
                          )}

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>
                              {result.student.name}
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, color: 'var(--primary-light)', fontFamily: 'JetBrains Mono, monospace' }}>
                                ID: {result.student.rollNumber || 'N/A'}
                              </span>
                              <span>•</span>
                              <span>{getHostelLabel(result.student.hostel)}</span>
                            </div>

                            {/* Contact Verification */}
                            {(result.student.studentPhone || result.student.parentPhone) && (
                              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {result.student.studentPhone && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                                    <span>📞</span>
                                    <span style={{ fontWeight: 600 }}>{result.student.studentPhone}</span>
                                    <span style={{ color: 'var(--text-muted)' }}>(student)</span>
                                  </div>
                                )}
                                {result.student.parentPhone && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                                    <span>👨‍👩‍👦</span>
                                    <span style={{ fontWeight: 600 }}>{result.student.parentPhone}</span>
                                    <span style={{ color: 'var(--text-muted)' }}>(parent)</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {result.log && (result.log.place || result.log.reason) && (
                              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
                                {result.log.place && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span>📍</span> <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{result.log.place}</span>
                                  </div>
                                )}
                                {result.log.reason && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span>📝</span> <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>{result.log.reason}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div style={{
                            fontSize: 11, fontWeight: 800,
                            padding: '4px 12px', borderRadius: 99,
                            background: isIN ? 'rgba(16,185,129,0.18)' : 'rgba(99,102,241,0.18)',
                            color: isIN ? '#10b981' : 'var(--primary-light)',
                            border: isIN ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(99,102,241,0.35)',
                            letterSpacing: '0.5px',
                            alignSelf: 'flex-start',
                          }}>
                            {isHome ? (isHomeOut ? 'HOME OUT' : 'HOME IN') : (isIN ? 'IN' : 'OUT')}
                          </div>
                        </div>

                        {/* Guard in-charge signature */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 12,
                          padding: '8px 12px',
                          background: 'rgba(255,255,255,0.04)',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          marginBottom: 12,
                        }}>
                          <span style={{ color: 'var(--text-muted)' }}>Verified By (Guard In-Charge):</span>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            {result.scannedByName || result.guardInCharge || user?.name || user?.rollNo || 'Security Guard'}
                          </span>
                        </div>

                        {/* Scan Next & Performance Duration */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <button
                            className="btn btn-ghost"
                            onClick={dismissResult}
                            style={{ flex: 1, justifyContent: 'center', fontSize: 13 }}
                          >
                            <MdQrCodeScanner size={15} /> Scan Next Student
                          </button>
                          {result.scanDuration != null && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99,
                              background: result.scanDuration < 300
                                ? 'rgba(16,185,129,0.15)' : result.scanDuration < 600
                                ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                              color: result.scanDuration < 300
                                ? '#10b981' : result.scanDuration < 600
                                ? '#f59e0b' : '#ef4444',
                              border: result.scanDuration < 300
                                ? '1px solid rgba(16,185,129,0.3)' : result.scanDuration < 600
                                ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(239,68,68,0.3)',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                            }}>
                              {result.scanDuration}ms
                            </span>
                          )}
                        </div>
                      </>
                    );
                  })()}

                  {/* ── FAILURE STATES (EXPIRED / ALREADY USED / INVALID) ── */}
                  {!isSuccess && (
                    <>
                      {/* Detailed Reason Box */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        padding: '16px',
                        borderRadius: 'var(--radius-lg)',
                        background: `${themeColor}12`,
                        border: `1px solid ${themeColor}35`,
                        marginBottom: 16,
                      }}>
                        <span style={{ fontSize: 24, flexShrink: 0, marginTop: 1 }}>
                          {isExpired ? '⏳' : isAlreadyUsed ? '🛑' : '⚠️'}
                        </span>
                        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#f8fafc' }}>
                          <strong style={{ color: themeColor, display: 'block', fontSize: 13.5, marginBottom: 4 }}>
                            {isExpired
                              ? 'Expired Token Rejection (> 20s Window)'
                              : isAlreadyUsed
                              ? 'Single-Use Token Already Consumed'
                              : isRevoked
                              ? 'Account Deactivated'
                              : 'Security Verification Failed'}
                          </strong>
                          {result.message || 'QR code verification failed.'}
                        </div>
                      </div>

                      {/* Explicit Guard Action Guidance */}
                      <div style={{
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-md)',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        marginBottom: 16,
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        lineHeight: 1.45,
                      }}>
                        <strong style={{ color: 'var(--text-primary)' }}>Guard Instructions: </strong>
                        {isExpired
                          ? 'Instruct the student to unlock their personal phone, open their live Heimdall Student Dashboard, and present the live rotating pass directly. Stored screenshots older than 20 seconds are strictly rejected.'
                          : isAlreadyUsed
                          ? 'This QR pass has already been scanned at the gate. Check if someone previously scanned this pass or if an impersonation attempt is occurring.'
                          : isRevoked
                          ? 'Do not grant access. Direct the student to the hostel warden office to resolve account status.'
                          : 'Instruct the student to generate a valid gate pass from their Heimdall dashboard.'}
                      </div>

                      <button
                        className="btn btn-ghost"
                        onClick={dismissResult}
                        style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
                      >
                        <MdQrCodeScanner size={15} /> Try Scanning Again
                      </button>
                    </>
                  )}
                </div>
              );
            })()}

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
                  Start the camera, paste a JWT token, or tap a student in the pending list.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Pending QRs Live Panel (shown first on mobile via CSS order) ── */}
        <div className="card security-live-panel">
          <div className="security-live-panel-header">
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
                Home requests appear when submitted; scannable QR after hostel staff approves on Home Visits page
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
              const isHome = (q) =>
                q.qrType === 'home_visit' || q.requestType === 'home_visit';
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
              const homeAwaiting = matchesSearch(
                pendingQRs.filter(
                  (q) => isHome(q) && (['AWAITING WARDEN', 'AWAITING HOSTEL STAFF'].includes(q.scanType) || q.scanType === 'QR ERROR' || !q.token)
                ),
                searchByColumn.homeAwaiting
              );
              const homeGone = matchesSearch(
                pendingQRs.filter((q) => isHome(q) && q.token && q.scanType === 'HOME OUT'),
                searchByColumn.homeGone
              );
              const homeReturn = matchesSearch(
                pendingQRs.filter((q) => isHome(q) && q.token && q.scanType === 'HOME IN'),
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
                            className="security-pending-card"
                            id={`pending-qr-${title.replace(/\s+/g, '-').toLowerCase()}-${idx}`}
                            onClick={() => qr.token && handleSelectPendingQR(qr)}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--radius-md)',
                              border: isSelected
                                ? '1px solid rgba(99,102,241,0.6)'
                                : qr.scannable === false
                                  ? '1px solid rgba(245,158,11,0.35)'
                                  : '1px solid rgba(255,255,255,0.06)',
                              background: isSelected
                                ? 'rgba(99,102,241,0.10)'
                                : qr.scannable === false
                                  ? 'rgba(245,158,11,0.08)'
                                  : 'rgba(255,255,255,0.02)',
                              cursor: qr.token ? 'pointer' : 'default',
                              opacity: qr.scannable === false ? 0.92 : 1,
                              transition: 'all 0.15s',
                            }}
                          >
                            <div className="security-pending-card-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              {qr.studentPhoto ? (
                                <img
                                  src={qr.studentPhoto}
                                  alt=""
                                  style={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: '50%',
                                    objectFit: 'cover',
                                    flexShrink: 0,
                                    border: '1.5px solid var(--border-color)',
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: '50%',
                                    background: 'rgba(99, 102, 241, 0.15)',
                                    color: 'var(--primary-light)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 700,
                                    fontSize: 13,
                                    flexShrink: 0,
                                  }}
                                >
                                  {(qr.studentName || '?')[0]}
                                </div>
                              )}
                              <div className="security-pending-card-main" style={{ flex: 1, minWidth: 0 }}>
                                <div className="security-pending-card-name">
                                  {qr.studentName || 'Unknown'}
                                  {['AWAITING WARDEN', 'AWAITING HOSTEL STAFF'].includes(qr.scanType) && (
                                    <span className="security-pending-awaiting">
                                      awaiting hostel staff
                                    </span>
                                  )}
                                </div>
                                <div className="security-pending-card-meta">
                                  {getHostelLabel(qr.hostel)} • {qr.rollNumber || '—'}
                                  {isHome(qr) && qr.leaveDate && (
                                    <span> • {qr.leaveDate} → {qr.returnDate}</span>
                                  )}
                                  {qr.place && (
                                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span>📍</span> <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{qr.place}</span>
                                    </div>
                                  )}
                                  {qr.reason && (
                                    <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span>📝</span> <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>{qr.reason}</span>
                                    </div>
                                  )}
                                </div>
                                {qr.studentPhone && (
                                  isMobile ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, fontSize: '11px', color: 'var(--text-secondary)' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span>📞</span> <span>{qr.studentPhone} (Student)</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '11px' }}>
                                      Student: {qr.studentPhone}
                                    </div>
                                  )
                                )}
                                {qr.statusNote && (
                                  <div className="security-pending-card-note">
                                    {qr.statusNote}
                                  </div>
                                )}
                              </div>
                              <div className={`security-pending-card-time${isSelected ? ' is-selected' : ''}`}>
                                <MdAccessTime size={12} />
                                {qr.expiresAt ? timeLeft(qr.expiresAt) : relativeTime(qr.createdAt)}
                              </div>
                            </div>
                            {qr.scannable !== false && qr.token && (
                              <div className="security-pending-card-hint">
                                Tap to select for scanner
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );

              return (
                <div className="security-column-grid">
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
                    title="Home Visit (awaiting)"
                    subtitle="Submitted — not scannable until hostel staff approves"
                    items={homeAwaiting}
                    tone="danger"
                    searchKey="homeAwaiting"
                  />
                  <Column
                    title="Home Visit GOING"
                    subtitle="Approved — scan QR when leaving"
                    items={homeGone}
                    tone="danger"
                    searchKey="homeGone"
                  />
                  <Column
                    title="Home Visit RETURNING"
                    subtitle="Approved — scan same QR on return"
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
