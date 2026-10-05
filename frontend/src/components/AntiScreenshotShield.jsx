import { useEffect, useState, useRef } from 'react';
import { MdSecurity, MdLock } from 'react-icons/md';
import toast from 'react-hot-toast';

/**
 * AntiScreenshotShield
 *
 * Dedicated protection against phone screenshots and screen recording:
 * 1. Menu Slide Down / Slide Up Blocker (detects sliding down top notification drawer or sliding up control center for screenshot / screen recording)
 * 2. Android 3-Finger Gesture Blocker (Android 3-finger swipe screenshot)
 * 3. Mobile & OS App-Switch / Hardware Button Interception (document.visibilitychange)
 * 4. True Window Blur detection (checks document.hasFocus() — NEVER triggers on button clicks)
 * 5. Screen Recording API Neutralizer (blocks navigator.mediaDevices.getDisplayMedia, canvas/media captureStream)
 * 6. Hardware & keyboard screenshot shortcuts (PrintScreen, Cmd+Shift+3/4/5/6, Win+Shift+S, Win+Alt+R, Win+G, Ctrl+Shift+S)
 * 7. Clipboard wiping on screenshot keypress
 * 8. CSS Print Blocker (@media print)
 */
export default function AntiScreenshotShield({ children }) {
  const [isShieldActive, setIsShieldActive] = useState(false);
  const toastCooldownRef = useRef(0);
  const shieldActiveTimeRef = useRef(0);
  const blurCheckTimerRef = useRef(null);
  const touchStartYRef = useRef(0);
  const isMenuSlideRef = useRef(false);

  const notifyRestricted = (message = '⚠️ Screenshots and screen captures are prohibited on the student portal for gate security.') => {
    const now = Date.now();
    if (now - toastCooldownRef.current > 2000) {
      toastCooldownRef.current = now;
      toast.error(message, {
        id: 'anti-screenshot-alert',
        duration: 3500,
        style: {
          background: '#1e1b4b',
          color: '#ffffff',
          border: '1px solid #6366f1',
          fontWeight: 700,
          fontSize: '13px',
        },
      });
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText('⚠️ Screenshots of Heimdall student gate passes are restricted for campus security.').catch(() => {});
    }
  };

  const activateShield = (duration = 0, message = '') => {
    if (window.__filePickerActive) return;

    setIsShieldActive(true);
    shieldActiveTimeRef.current = Date.now();

    window.dispatchEvent(new CustomEvent('shield-activated'));
    window.dispatchEvent(new CustomEvent('heimdall-shield-activated'));

    if (message) {
      notifyRestricted(message);
    }
  };

  // ── 1. Screen Recording APIs Interception ─────────────────────────────────
  useEffect(() => {
    // Intercept getDisplayMedia (browser screen / tab recording API)
    let origGetDisplayMedia = null;
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
      origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async function (...args) {
        activateShield(0, '⚠️ Screen recording is strictly prohibited on the student portal.');
        throw new DOMException('Screen recording is prohibited for gate security.', 'NotAllowedError');
      };
    }

    // Intercept captureStream on Canvas and Media elements
    let origCanvasCapture = null;
    if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype.captureStream) {
      origCanvasCapture = HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream = function () {
        activateShield(0, '⚠️ Canvas recording is prohibited on the student portal.');
        throw new DOMException('Canvas capture is disabled for security.', 'NotAllowedError');
      };
    }

    let origMediaCapture = null;
    if (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype.captureStream) {
      origMediaCapture = HTMLMediaElement.prototype.captureStream;
      HTMLMediaElement.prototype.captureStream = function () {
        activateShield(0, '⚠️ Media stream capture is prohibited on the student portal.');
        throw new DOMException('Media capture is disabled for security.', 'NotAllowedError');
      };
    }

    // Intercept requestPictureInPicture
    let origPiP = null;
    if (typeof HTMLVideoElement !== 'undefined' && HTMLVideoElement.prototype.requestPictureInPicture) {
      origPiP = HTMLVideoElement.prototype.requestPictureInPicture;
      HTMLVideoElement.prototype.requestPictureInPicture = function () {
        activateShield(0, '⚠️ Picture-in-picture screen capture blocked.');
        throw new DOMException('Picture-in-picture is disabled.', 'NotAllowedError');
      };
    }

    return () => {
      if (origGetDisplayMedia && navigator.mediaDevices) {
        navigator.mediaDevices.getDisplayMedia = origGetDisplayMedia;
      }
      if (origCanvasCapture && typeof HTMLCanvasElement !== 'undefined') {
        HTMLCanvasElement.prototype.captureStream = origCanvasCapture;
      }
      if (origMediaCapture && typeof HTMLMediaElement !== 'undefined') {
        HTMLMediaElement.prototype.captureStream = origMediaCapture;
      }
      if (origPiP && typeof HTMLVideoElement !== 'undefined') {
        HTMLVideoElement.prototype.requestPictureInPicture = origPiP;
      }
    };
  }, []);

  // ── 2. Screenshot, Screen Record, Menu Slide & Visibility Listeners ───────
  useEffect(() => {
    // Window Blur: ONLY triggers if the entire window lost focus (e.g. app switcher, notification shade).
    // Clicking buttons inside the portal NEVER triggers this because document.hasFocus() stays true.
    const handleBlur = () => {
      if (window.__filePickerActive) return;
      if (blurCheckTimerRef.current) clearTimeout(blurCheckTimerRef.current);

      blurCheckTimerRef.current = setTimeout(() => {
        if (typeof document !== 'undefined' && !document.hasFocus()) {
          activateShield(0, '⚠️ System overlay active — content hidden for security.');
        }
      }, 40);
    };

    const handleFocus = () => {
      if (blurCheckTimerRef.current) {
        clearTimeout(blurCheckTimerRef.current);
        blurCheckTimerRef.current = null;
      }
    };

    // Triggered when switching apps, pulling down notification tray, or taking OS screenshot
    const handleVisibilityChange = () => {
      if (document.hidden) {
        activateShield(0, '⚠️ Background switch detected — content hidden for security.');
      }
    };

    const handlePageHide = () => {
      activateShield(0, '⚠️ System switch detected — content hidden for security.');
    };

    // ── Mobile Slide Down/Up Menu & 3-Finger Screenshot Gesture ──────────────
    const handleTouchStart = (e) => {
      const touches = e.touches;
      if (!touches || !touches[0]) return;

      // 3-Finger swipe screenshot gesture (Android phones)
      if (touches.length >= 3) {
        if (e.cancelable) e.preventDefault();
        activateShield(0, '⚠️ 3-finger screenshot gesture blocked! Screen capture is prohibited.');
        return;
      }

      const touch = touches[0];
      touchStartYRef.current = touch.clientY;
      isMenuSlideRef.current = false;

      const screenHeight = window.innerHeight || document.documentElement.clientHeight || 800;

      // Detect start at top edge (sliding down notification/quick settings shade with screenshot/recording buttons)
      // or bottom edge (sliding up app switcher / gesture navigation bar / control center)
      if (touch.clientY <= 65) {
        isMenuSlideRef.current = 'down';
      } else if (touch.clientY >= screenHeight - 80) {
        isMenuSlideRef.current = 'up';
      }
    };

    const handleTouchMove = (e) => {
      const touches = e.touches;
      if (!touches || !touches[0]) return;

      // 3-Finger swipe screenshot gesture
      if (touches.length >= 3) {
        if (e.cancelable) e.preventDefault();
        activateShield(0, '⚠️ 3-finger screenshot gesture blocked!');
        return;
      }

      const touch = touches[0];
      const deltaY = touch.clientY - touchStartYRef.current;

      // Sliding down from top (opening notification shade with Screenshot / Screen record button)
      if (isMenuSlideRef.current === 'down' && deltaY > 12) {
        activateShield(0, '⚠️ Menu pull-down detected — content hidden for security.');
        isMenuSlideRef.current = false;
      }

      // Sliding up from bottom (opening recent apps overview / control center)
      if (isMenuSlideRef.current === 'up' && deltaY < -12) {
        activateShield(0, '⚠️ System gesture detected — content hidden for security.');
        isMenuSlideRef.current = false;
      }
    };

    const handleTouchEnd = () => {
      isMenuSlideRef.current = false;
    };

    // ── Keyboard Shortcuts (macOS, Windows, Chrome/Edge) ─────────────────────
    const handleKeyDown = (e) => {
      const isMac = navigator.platform?.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // 1. PrintScreen key
      if (
        e.key === 'PrintScreen' ||
        e.code === 'PrintScreen' ||
        e.keyCode === 44
      ) {
        e.preventDefault();
        e.stopPropagation();
        activateShield(0, '⚠️ PrintScreen blocked! Gate passes cannot be screen-captured.');
        return false;
      }

      // 2. macOS screenshot / screen recording (Cmd+Shift+3/4/5/6)
      const isMacScreenshotDigit =
        e.code === 'Digit3' ||
        e.code === 'Digit4' ||
        e.code === 'Digit5' ||
        e.code === 'Digit6' ||
        e.key === '#' ||
        e.key === '$' ||
        e.key === '%' ||
        e.key === '^' ||
        e.key === '3' ||
        e.key === '4' ||
        e.key === '5' ||
        e.key === '6';

      if (cmdOrCtrl && e.shiftKey && isMacScreenshotDigit) {
        e.preventDefault();
        e.stopPropagation();
        activateShield(0, '⚠️ Screen capture shortcut blocked!');
        return false;
      }

      // 3. Edge Web Capture (Ctrl+Shift+S) or Snipping Tool (Win+Shift+S)
      if ((cmdOrCtrl || e.metaKey) && e.shiftKey && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        activateShield(0, '⚠️ Snipping Tool / Web Capture blocked!');
        return false;
      }

      // 4. Windows Game Bar Screen Recording (Win+Alt+R / Alt+R / Win+G)
      if ((e.altKey && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')) ||
          (e.metaKey && (e.code === 'KeyG' || e.key === 'g' || e.key === 'G'))) {
        e.preventDefault();
        e.stopPropagation();
        activateShield(0, '⚠️ Screen recording shortcut blocked!');
        return false;
      }

      // 5. DevTools interception (F12, Cmd+Option+I/J/C)
      if (
        e.key === 'F12' ||
        e.code === 'F12' ||
        ((e.metaKey || e.ctrlKey) && e.altKey && (e.code === 'KeyI' || e.code === 'KeyJ' || e.code === 'KeyC'))
      ) {
        e.preventDefault();
        e.stopPropagation();
        activateShield(0, '⚠️ Developer inspection tools are restricted for gate security.');
        return false;
      }

      // 6. Print page (Cmd+P / Ctrl+P)
      if (cmdOrCtrl && (e.key === 'p' || e.key === 'P' || e.code === 'KeyP')) {
        e.preventDefault();
        e.stopPropagation();
        notifyRestricted('⚠️ Printing student gate passes is disabled.');
        return false;
      }

      // 7. Save page (Cmd+S / Ctrl+S)
      if (cmdOrCtrl && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
        e.preventDefault();
        e.stopPropagation();
        notifyRestricted('⚠️ Saving the gate pass portal offline is disabled.');
        return false;
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText('⚠️ Screenshots are disabled on Heimdall student portal.').catch(() => {});
        }
      }
    };

    // ── Context Menu & Drag Protection ─────────────────────────────────────
    const handleContextMenu = (e) => {
      e.preventDefault();
      notifyRestricted('⚠️ Right-click context menu is restricted on student gate passes.');
    };

    const handleDragStart = (e) => {
      e.preventDefault();
    };

    // Attach listeners
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('dragstart', handleDragStart);

    // Touch listeners: Intercepts sliding down menu part, sliding up bottom panel, or 3-finger gesture
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      if (blurCheckTimerRef.current) clearTimeout(blurCheckTimerRef.current);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('dragstart', handleDragStart);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  const handleResumePortal = (e) => {
    e?.stopPropagation();
    const elapsed = Date.now() - shieldActiveTimeRef.current;
    if (elapsed < 350) return;

    setIsShieldActive(false);
    window.dispatchEvent(new CustomEvent('shield-deactivated'));
    window.dispatchEvent(new CustomEvent('heimdall-shield-deactivated'));
  };

  return (
    <>
      {/* ── CSS Print Blocker & Selection Shield ── */}
      <style>{`
        @media print {
          html, body, #root, * {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            overflow: hidden !important;
          }
        }
        .anti-screenshot-protected {
          -webkit-user-select: none !important;
          user-select: none !important;
          -webkit-touch-callout: none !important;
        }
        .anti-screenshot-protected img {
          -webkit-user-drag: none !important;
          user-select: none !important;
          pointer-events: auto;
        }
      `}</style>

      {/* Main portal contents with instant blanking when shield is active */}
      <div
        className="anti-screenshot-protected"
        style={{
          filter: isShieldActive ? 'blur(60px)' : 'none',
          opacity: isShieldActive ? 0 : 1,
          visibility: isShieldActive ? 'hidden' : 'visible',
          pointerEvents: isShieldActive ? 'none' : 'auto',
          transition: 'none',
          minHeight: '100%',
          position: 'relative',
        }}
      >
        {children}
      </div>

      {/* Security Privacy Overlay shown when screenshot/screen-recording is detected */}
      {isShieldActive && (
        <div
          onClick={handleResumePortal}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483647,
            background: 'rgba(6, 6, 26, 0.98)',
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 24,
            cursor: 'default',
            userSelect: 'none',
            animation: 'none',
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(99, 102, 241, 0.2) 100%)',
              border: '2px solid rgba(239, 68, 68, 0.5)',
              boxShadow: '0 0 40px rgba(239, 68, 68, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
              color: '#ef4444',
            }}
          >
            <MdSecurity size={42} />
          </div>

          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              margin: '0 0 10px',
              color: '#ffffff',
              letterSpacing: '-0.02em',
            }}
          >
            🔒 Content Hidden for Security
          </h2>

          <p
            style={{
              fontSize: 13.5,
              color: '#cbd5e1',
              maxWidth: 380,
              margin: '0 0 24px',
              lineHeight: 1.55,
            }}
          >
            Screen recording and screenshots are restricted on the student gate pass portal to prevent unauthorized pass sharing.
          </p>

          <button
            type="button"
            onClick={handleResumePortal}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 700,
              color: '#ffffff',
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              padding: '10px 22px',
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
            }}
          >
            <MdLock size={16} />
            <span>Resume Portal</span>
          </button>
        </div>
      )}
    </>
  );
}
