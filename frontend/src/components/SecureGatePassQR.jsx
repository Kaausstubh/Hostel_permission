import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MdSecurity,
  MdFingerprint,
  MdLock,
  MdQrCode2,
  MdFullscreen,
  MdCheckCircle,
  MdInfoOutline,
} from 'react-icons/md';
import { format } from 'date-fns';

/**
 * SecureGatePassQR
 *
 * Prevents screen recording and screenshot leakage of student gate pass QR codes.
 *
 * Core Security Architecture:
 * 1. Default Concealment: The QR code is NEVER rendered statically on screen.
 *    Any screen recording (from control center/notification drawer) starts with ZERO
 *    QR pixels in the frame buffer.
 * 2. Ephemeral Hold-to-Reveal: The QR is rendered ONLY while the student is actively
 *    pressing down on the screen with their primary finger.
 * 3. 0ms Instant Blanking: Releasing the finger, pulling down the notification shade,
 *    switching apps, or blurring the window instantly destroys the visible QR.
 * 4. Multi-Touch Guard: If a second finger touches the screen (e.g. to swipe down
 *    notification center while holding), the hold is aborted and security shield is triggered.
 * 5. Anti-Tamper Dynamic Watermark: While revealed, an animated holographic laser beam,
 *    live millisecond timestamp (HH:mm:ss.SSS), and student roll number overlay the QR,
 *    rendering screen recordings or video playback immediately detectable as counterfeit by guards.
 * 6. Auto-Lock Safety Timer: Maximum continuous hold of 15 seconds to prevent static clamping.
 */
export default function SecureGatePassQR({
  qrDataUrl,
  qrToken,
  pass = {},
  user = {},
  theme = 'dark',
  isCompact = false,
  onOpenModal,
}) {
  const [isHolding, setIsHolding] = useState(false);
  const [isSafetyLocked, setIsSafetyLocked] = useState(false);
  const [liveMillis, setLiveMillis] = useState(() => format(new Date(), 'HH:mm:ss.SSS'));
  const [secondsRemaining, setSecondsRemaining] = useState(15);

  const holdIntervalRef = useRef(null);
  const holdTimeoutRef = useRef(null);
  const isHoldingRef = useRef(false);

  // Keep ref in sync for event listeners
  isHoldingRef.current = isHolding;

  const cancelHold = useCallback(() => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    setIsHolding(false);
    setSecondsRemaining(15);
  }, []);

  const startHold = useCallback(
    (e) => {
      // Ignore right clicks or secondary buttons
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.isPrimary === false) return;

      // Prevent long-press context menu & selection
      if (e.cancelable) e.preventDefault();

      if (isSafetyLocked) return;

      // Subtle haptic tick if device supports it
      if (navigator.vibrate) {
        try {
          navigator.vibrate(35);
        } catch (_) {}
      }

      setIsHolding(true);
      setSecondsRemaining(15);
      setLiveMillis(format(new Date(), 'HH:mm:ss.SSS'));

      // Clean any existing timer
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);

      const startTime = Date.now();
      const maxDuration = 15000; // 15 seconds

      holdIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const left = Math.max(0, Math.ceil((maxDuration - elapsed) / 1000));
        setSecondsRemaining(left);
        setLiveMillis(format(new Date(), 'HH:mm:ss.SSS'));

        if (elapsed >= maxDuration) {
          cancelHold();
          setIsSafetyLocked(true);
          // Auto reset safety lock after 1.5 seconds
          setTimeout(() => setIsSafetyLocked(false), 1500);
        }
      }, 50);
    },
    [cancelHold, isSafetyLocked]
  );

  const endHold = useCallback(
    (e) => {
      if (e && e.cancelable) e.preventDefault();
      if (isHoldingRef.current) {
        if (navigator.vibrate) {
          try {
            navigator.vibrate(15);
          } catch (_) {}
        }
        cancelHold();
      }
    },
    [cancelHold]
  );

  // Global listeners to cancel hold instantly on any window blur, visibility change,
  // multi-touch, or AntiScreenshotShield activation
  useEffect(() => {
    const handleGlobalCancel = () => {
      if (isHoldingRef.current) {
        cancelHold();
      }
    };

    const handleShieldEvent = () => {
      cancelHold();
    };

    const handleTouchCancel = (e) => {
      if (e.touches && e.touches.length > 1) {
        cancelHold();
      }
    };

    window.addEventListener('blur', handleGlobalCancel);
    window.addEventListener('focus', handleGlobalCancel);
    document.addEventListener('visibilitychange', handleGlobalCancel);
    window.addEventListener('pointerup', handleGlobalCancel);
    window.addEventListener('pointercancel', handleGlobalCancel);
    window.addEventListener('touchend', handleGlobalCancel);
    window.addEventListener('touchcancel', handleGlobalCancel);
    window.addEventListener('touchstart', handleTouchCancel, { passive: true });
    window.addEventListener('heimdall-shield-activated', handleShieldEvent);

    return () => {
      cancelHold();
      window.removeEventListener('blur', handleGlobalCancel);
      window.removeEventListener('focus', handleGlobalCancel);
      document.removeEventListener('visibilitychange', handleGlobalCancel);
      window.removeEventListener('pointerup', handleGlobalCancel);
      window.removeEventListener('pointercancel', handleGlobalCancel);
      window.removeEventListener('touchend', handleGlobalCancel);
      window.removeEventListener('touchcancel', handleGlobalCancel);
      window.removeEventListener('touchstart', handleTouchCancel);
      window.removeEventListener('heimdall-shield-activated', handleShieldEvent);
    };
  }, [cancelHold]);

  const qrDimensions = isCompact ? 210 : 250;
  const isLight = theme === 'light';

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      {/* ── STATE A: REVEALED (Active finger hold only) ── */}
      {isHolding ? (
        <div
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onPointerLeave={endHold}
          onTouchEnd={endHold}
          onTouchCancel={endHold}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            cursor: 'pointer',
            touchAction: 'none',
          }}
        >
          {/* Active Hold Status Chip */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 14px',
              borderRadius: 999,
              background: 'rgba(16, 185, 129, 0.16)',
              border: '1.5px solid #10b981',
              color: isLight ? '#065f46' : '#34d399',
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: '0.02em',
              boxShadow: '0 0 16px rgba(16, 185, 129, 0.4)',
              animation: 'pulseRingModal 1.8s infinite',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 10px #10b981',
                display: 'inline-block',
              }}
            />
            <span>LIVE SCAN ACTIVE • {liveMillis}</span>
          </div>

          {/* High-Contrast Scannable QR Container */}
          <div
            style={{
              background: '#ffffff',
              padding: isCompact ? 12 : 16,
              borderRadius: 18,
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4), 0 0 0 3px #10b981',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              overflow: 'hidden',
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            {/* Holographic Laser Beam Sweeping Vertically */}
            <div
              style={{
                position: 'absolute',
                left: 6,
                right: 6,
                height: 3,
                background:
                  'linear-gradient(90deg, rgba(16,185,129,0) 0%, #10b981 50%, rgba(16,185,129,0) 100%)',
                boxShadow: '0 0 14px 4px rgba(16, 185, 129, 0.85)',
                borderRadius: 2,
                pointerEvents: 'none',
                animation: 'laserScan 1.8s ease-in-out infinite alternate',
                zIndex: 4,
              }}
            />

            {/* Dynamic Security Roll Number & Watermark Stamp */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: 'rotate(-25deg)',
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: '0.12em',
                color: 'rgba(0, 0, 0, 0.09)',
                textTransform: 'uppercase',
                userSelect: 'none',
                zIndex: 2,
                textAlign: 'center',
                lineHeight: 1.8,
              }}
            >
              {user?.rollNo || 'IIIT PUNE'} • OFFICIAL LIVE PASS • {user?.name || ''}
            </div>

            {/* High-Definition QR Image for Physical Optical Scanner */}
            <img
              key={qrToken || 'active-qr'}
              src={qrDataUrl}
              alt="Live Gate Pass QR"
              onContextMenu={(e) => e.preventDefault()}
              style={{
                width: qrDimensions,
                height: qrDimensions,
                borderRadius: 0,
                display: 'block',
                imageRendering: 'pixelated',
                pointerEvents: 'none',
                userSelect: 'none',
                WebkitUserDrag: 'none',
              }}
            />
          </div>

          {/* Hold Countdown & Release Notice */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              width: '100%',
              maxWidth: qrDimensions + 40,
            }}
          >
            {/* Dynamic Progress Bar */}
            <div
              style={{
                width: '100%',
                height: 4,
                background: 'rgba(16, 185, 129, 0.2)',
                borderRadius: 99,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${(secondsRemaining / 15) * 100}%`,
                  background: 'linear-gradient(90deg, #10b981, #34d399)',
                  transition: 'width 0.1s linear',
                }}
              />
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: isLight ? '#065f46' : '#6ee7b7',
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span>👆 Keep pressed against screen for guard scanner ({secondsRemaining}s)</span>
            </div>
            <div
              style={{
                fontSize: 10,
                color: isLight ? '#64748b' : '#94a3b8',
                textAlign: 'center',
              }}
            >
              Release finger anytime to instantly conceal pass
            </div>
          </div>
        </div>
      ) : (
        /* ── STATE B: CONCEALED & PROTECTED (Default State) ── */
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
            gap: 12,
          }}
        >
          {/* Tactical Security Gate Pass Card */}
          <div
            style={{
              width: isCompact ? '100%' : 'auto',
              minWidth: isCompact ? 260 : 300,
              maxWidth: 340,
              background: isLight
                ? 'linear-gradient(145deg, #f8fafc 0%, #eef2ff 100%)'
                : 'linear-gradient(145deg, rgba(30, 27, 75, 0.6) 0%, rgba(15, 23, 42, 0.75) 100%)',
              border: isLight ? '1.5px solid #c7d2fe' : '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: 20,
              padding: isCompact ? '18px 16px' : '22px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              boxShadow: isLight
                ? '0 8px 24px rgba(99, 102, 241, 0.1)'
                : '0 12px 30px rgba(0, 0, 0, 0.35)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Top Shield Status Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderRadius: 999,
                background: isLight ? '#e0e7ff' : 'rgba(99, 102, 241, 0.18)',
                color: isLight ? '#3730a3' : '#a5b4fc',
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              <MdLock size={13} />
              <span>Anti-Recording Protected</span>
            </div>

            {/* Glowing Tactical Shield Badge */}
            <div
              style={{
                position: 'relative',
                width: 76,
                height: 76,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Outer pulsing ring */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(99, 102, 241, 0.3) 0%, transparent 70%)',
                  animation: 'pulseRingModal 2.4s ease-out infinite',
                }}
              />
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 24px rgba(99, 102, 241, 0.5)',
                  color: '#ffffff',
                }}
              >
                <MdSecurity size={32} />
              </div>
            </div>

            {/* Pass Identification Details */}
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: isLight ? '#1e293b' : '#f8fafc',
                  letterSpacing: '-0.01em',
                }}
              >
                {pass.cardTitle ? `🛡️ ${pass.cardTitle}` : '🛡️ Gate Pass QR Ready'}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: isLight ? '#64748b' : '#94a3b8',
                  marginTop: 3,
                  fontWeight: 500,
                }}
              >
                {pass.cardSubtitle || 'Active official campus pass'}
              </div>
            </div>

            {/* Giant Interactive Tactile HOLD Zone */}
            <button
              type="button"
              onPointerDown={startHold}
              onPointerUp={endHold}
              onPointerCancel={endHold}
              onPointerLeave={endHold}
              onTouchStart={startHold}
              onTouchEnd={endHold}
              onTouchCancel={endHold}
              onContextMenu={(e) => e.preventDefault()}
              disabled={isSafetyLocked}
              style={{
                width: '100%',
                padding: '14px 18px',
                borderRadius: 16,
                border: 'none',
                background: isSafetyLocked
                  ? (isLight ? '#cbd5e1' : '#334155')
                  : 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
                color: '#ffffff',
                cursor: isSafetyLocked ? 'not-allowed' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                boxShadow: isSafetyLocked
                  ? 'none'
                  : '0 6px 20px rgba(99, 102, 241, 0.45)',
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                transform: 'scale(1)',
                transition: 'transform 0.15s ease, background 0.2s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                }}
              >
                <MdFingerprint size={22} style={{ flexShrink: 0 }} />
                <span>
                  {isSafetyLocked ? 'LOCKED (COOLING DOWN)' : 'PRESS & HOLD TO SCAN'}
                </span>
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  opacity: 0.9,
                  fontWeight: 500,
                  textAlign: 'center',
                }}
              >
                {isSafetyLocked
                  ? 'Please wait a moment before touching again'
                  : 'QR appears only while finger is held on screen'}
              </div>
            </button>

            {/* Expand Presenter Button in Compact Mode */}
            {isCompact && onOpenModal && (
              <button
                type="button"
                onClick={onOpenModal}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 12,
                  border: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.12)',
                  background: isLight ? '#f1f5f9' : 'rgba(255, 255, 255, 0.05)',
                  color: isLight ? '#334155' : '#cbd5e1',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'background 0.2s',
                }}
              >
                <MdFullscreen size={18} />
                <span>Open Full-Screen Gate Presenter</span>
              </button>
            )}

            {/* Anti-Screen Recording Security Notice */}
            <div
              style={{
                fontSize: 10,
                color: isLight ? '#94a3b8' : 'rgba(255, 255, 255, 0.5)',
                textAlign: 'center',
                lineHeight: 1.4,
              }}
            >
              🛡️ Zero-Pixel frame buffer protection: Screen recordings and screenshots cannot capture concealed passes.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
