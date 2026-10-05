import { useEffect, useState, useRef } from 'react';
import { MdSecurity, MdLock, MdFiberPin } from 'react-icons/md';
import toast from 'react-hot-toast';

/**
 * AntiScreenshotShield
 *
 * Robust multi-layer protection against screenshots and screen captures
 * on the Student Portal:
 * 1. Upper Menu & Browser Toolbar Interception (Edge Web Capture, Chrome 3-dots screenshot, extension capture, OS menu bars)
 * 2. Mobile Notification Drawer & Control Center Pull-Down Interception (Android Quick Settings Screen Recorder & Screenshot tiles)
 * 3. Screen Recording API Neutralizer (intercepts and blocks navigator.mediaDevices.getDisplayMedia, canvas/media captureStream)
 * 4. Window Blur & Focusout Shield (capture-phase listeners for instant blanking before screenshot buffers capture)
 * 5. Keyboard shortcut interception (PrintScreen, Cmd+Shift+3/4/5/6, Ctrl+Shift+S, Win+Shift+S, Win+Alt+R, Win+G, F12, DevTools)
 * 6. Clipboard wiping on screen-capture attempts
 * 7. Context-menu & drag-and-drop prevention
 * 8. CSS Print-blocker (@media print)
 * 9. Persistent security lock — never auto-dismisses while capture utilities are open
 */
export default function AntiScreenshotShield({ children }) {
  const [isShieldActive, setIsShieldActive] = useState(false);
  const [liveTimestamp, setLiveTimestamp] = useState(() => new Date().toLocaleTimeString('en-US', { hour12: false }));
  const toastCooldownRef = useRef(0);
  const shieldActiveTimeRef = useRef(0);
  const touchStartYRef = useRef(0);
  const activePointersRef = useRef(new Set());

  // Keep live timestamp ticking for anti-recording verification
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveTimestamp(new Date().toLocaleTimeString('en-US', { hour12: false }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

    // Overwrite clipboard immediately if a screenshot was attempted
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText('⚠️ Screenshots of Heimdall student gate passes are restricted for campus security.').catch(() => {});
    }
  };

  const activateShield = (duration = 0, message = '') => {
    // If file picker is open (e.g. student uploading complaint photo), ignore
    if (window.__filePickerActive) return;

    setIsShieldActive(true);
    shieldActiveTimeRef.current = Date.now();

    // Broadcast shield activation to all sensitive components (like gate pass QR)
    window.dispatchEvent(new CustomEvent('shield-activated'));
    window.dispatchEvent(new CustomEvent('heimdall-shield-activated'));

    if (message) {
      notifyRestricted(message);
    }
    // Note: All security locks remain PERSISTENT until the student explicitly clicks Resume Portal
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

  // ── 2. Upper Menu, Focus, Blur, Gestures & Shortcut Listeners ─────────────
  useEffect(() => {
    // ── Window Blur & Focusout Detection (Capture phase for 0ms blanking) ────
    const handleBlur = () => {
      if (window.__filePickerActive) return;
      activateShield(0, '⚠️ Window lost focus — screen capture protection active.');
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        activateShield(0, '⚠️ Background app switch detected.');
      }
    };

    // ── Upper Menu & Top Toolbar Proximity Interception (Desktop) ───────────
    const handleMouseMove = (e) => {
      if (window.__filePickerActive) return;
      // If cursor approaches within 12px of the very top edge (heading towards browser toolbar/Edge Web capture/Chrome menu/tabs)
      if (e.clientY <= 12) {
        activateShield(0, '⚠️ Upper menu proximity detected — screen security active.');
      }
    };

    const handleMouseLeave = (e) => {
      if (window.__filePickerActive) return;
      // Cursor left the document window through top or outside viewport
      if (e.clientY <= 0 || !e.relatedTarget || e.clientY <= 15) {
        activateShield(0, '⚠️ Cursor left viewport — screen security active.');
      }
    };

    const handleMouseOut = (e) => {
      if (window.__filePickerActive) return;
      // relatedTarget === null means cursor completely exited the browser window into the browser chrome / OS
      if (!e.relatedTarget && (e.clientY <= 15 || e.clientX <= 0 || e.clientX >= window.innerWidth)) {
        activateShield(0, '⚠️ Focus moved to browser menu — portal content shielded.');
      }
    };

    // ── Mobile Gestures & Notification Drawer Pull-Down Interception ────────
    const handleTouchStart = (e) => {
      if (window.__filePickerActive) return;
      const touches = e.touches || e.targetTouches;
      if (!touches || !touches[0]) return;

      const firstTouch = touches[0];
      touchStartYRef.current = firstTouch.clientY;

      // Top edge touch: Intercepts notification drawer & control center pull-downs for screen recording / screenshots
      if (firstTouch.clientY <= 75) {
        activePointersRef.current.clear();
        activateShield(0, '⚠️ Upper menu gesture detected — screen security active.');
        return;
      }

      // Multi-touch gesture (2 or more fingers)
      if (touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        activePointersRef.current.clear();
        activateShield(0, '⚠️ Multi-finger gesture blocked! Screen capture is prohibited.');
        return false;
      }
    };

    const handleTouchMove = (e) => {
      if (window.__filePickerActive) return;
      const touches = e.touches || e.targetTouches;
      if (!touches || !touches[0]) return;

      const firstTouch = touches[0];

      // Finger moving in top zone
      if (firstTouch.clientY <= 75) {
        activePointersRef.current.clear();
        activateShield(0, '⚠️ Upper menu gesture detected — screen security active.');
        return;
      }

      // Downward pull from upper area (swiping down notification drawer / quick settings)
      if (touchStartYRef.current <= 120 && (firstTouch.clientY - touchStartYRef.current > 20)) {
        activePointersRef.current.clear();
        activateShield(0, '⚠️ Notification drawer pull-down detected — screen security active.');
        return;
      }

      // Multi-touch check
      if (touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        activePointersRef.current.clear();
        activateShield(0, '⚠️ Multi-finger gesture blocked! Screen capture is prohibited.');
        return false;
      }
    };

    const handleTouchEnd = (e) => {
      const remaining = e.touches ? e.touches.length : 0;
      if (remaining <= 1) {
        activePointersRef.current.clear();
      }
    };

    const handlePointerDown = (e) => {
      if (window.__filePickerActive) return;
      if (e.clientY <= 75) {
        activePointersRef.current.clear();
        activateShield(0, '⚠️ System gesture detected — screen security active.');
        return;
      }
      activePointersRef.current.add(e.pointerId);
      if (activePointersRef.current.size >= 2) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        activePointersRef.current.clear();
        activateShield(0, '⚠️ Multi-touch gesture blocked! Screen capture is prohibited.');
      }
    };

    const handlePointerUp = (e) => {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size <= 1) {
        activePointersRef.current.clear();
      }
    };

    // ── Keyboard Shortcuts Interception ────────────────────────────────────
    const handleKeyDown = (e) => {
      const isMac = navigator.platform?.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // 1. Instantly trigger when Cmd+Shift or Ctrl+Shift are pressed
      if (cmdOrCtrl && e.shiftKey) {
        activateShield(0, '⚠️ Screen capture shortcuts are blocked on the student portal.');
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // 2. PrintScreen key (standard, Alt+PrintScreen, Win+PrintScreen)
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

      // 3. Digit keys with modifiers (macOS Cmd+Shift+3/4/5/6)
      const isScreenshotKey =
        e.code === 'Digit3' ||
        e.code === 'Digit4' ||
        e.code === 'Digit5' ||
        e.code === 'Digit6' ||
        e.code === 'KeyS' ||
        e.key === '#' ||
        e.key === '$' ||
        e.key === '%' ||
        e.key === '^' ||
        e.key === '3' ||
        e.key === '4' ||
        e.key === '5' ||
        e.key === '6';

      if (cmdOrCtrl && isScreenshotKey) {
        e.preventDefault();
        e.stopPropagation();
        activateShield(0, '⚠️ Screenshot shortcut blocked!');
        return false;
      }

      // 4. Windows Game Bar Screen Recording (Win+Alt+R / Alt+R / Alt+Shift+R / Win+G)
      if ((e.altKey && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')) ||
          (e.metaKey && (e.code === 'KeyG' || e.key === 'g' || e.key === 'G'))) {
        e.preventDefault();
        e.stopPropagation();
        activateShield(0, '⚠️ Screen recording shortcut blocked!');
        return false;
      }

      // 5. DevTools interception (F12, Cmd+Option+I/J/C, Ctrl+Shift+I/J/C)
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

    // ── Context Menu, Drag & Copy Protection ───────────────────────────────
    const handleContextMenu = (e) => {
      e.preventDefault();
      notifyRestricted('⚠️ Right-click context menu is restricted on student gate passes.');
    };

    const handleDragStart = (e) => {
      e.preventDefault();
    };

    const handleCopy = (e) => {
      const selection = window.getSelection()?.toString() || '';
      if (selection.length > 50) {
        e.preventDefault();
        notifyRestricted('⚠️ Copying large blocks of portal data is restricted.');
      }
    };

    // Register all listeners with capture: true where applicable
    window.addEventListener('blur', handleBlur, true);
    window.addEventListener('focusout', handleBlur, true);
    document.addEventListener('focusout', handleBlur, true);
    document.addEventListener('visibilitychange', handleVisibilityChange, true);
    window.addEventListener('pagehide', handleBlur, true);
    window.addEventListener('beforeunload', handleBlur, true);

    // Mouse & Pointer events for upper menu proximity
    document.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true });
    document.documentElement.addEventListener('mouseleave', handleMouseLeave, { passive: true, capture: true });
    window.addEventListener('mouseout', handleMouseOut, { passive: true, capture: true });

    // Keyboard & interaction
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('dragstart', handleDragStart);
    window.addEventListener('copy', handleCopy);

    // Touch & Pointer listeners
    window.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: false, capture: true });

    document.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: false, capture: true });

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('pointerup', handlePointerUp, { capture: true });
    window.addEventListener('pointercancel', handlePointerUp, { capture: true });

    return () => {
      window.removeEventListener('blur', handleBlur, true);
      window.removeEventListener('focusout', handleBlur, true);
      document.removeEventListener('focusout', handleBlur, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange, true);
      window.removeEventListener('pagehide', handleBlur, true);
      window.removeEventListener('beforeunload', handleBlur, true);

      document.removeEventListener('mousemove', handleMouseMove, true);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeave, true);
      window.removeEventListener('mouseout', handleMouseOut, true);

      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('dragstart', handleDragStart);
      window.removeEventListener('copy', handleCopy);

      window.removeEventListener('touchstart', handleTouchStart, true);
      window.removeEventListener('touchmove', handleTouchMove, true);
      window.removeEventListener('touchend', handleTouchEnd, true);
      window.removeEventListener('touchcancel', handleTouchEnd, true);

      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchmove', handleTouchMove, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('touchcancel', handleTouchEnd, true);

      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
    };
  }, []);

  const handleResumePortal = (e) => {
    e?.stopPropagation();
    const elapsed = Date.now() - shieldActiveTimeRef.current;
    if (elapsed < 800) return;

    // Check if the window is currently focused
    if (typeof document !== 'undefined' && !document.hasFocus()) {
      notifyRestricted('⚠️ Click inside the window to focus before resuming.');
      return;
    }

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
          transition: 'none', // 0ms: instantaneous blanking so camera buffer captures 0 pixels
          minHeight: '100%',
          position: 'relative',
        }}
      >
        {/* Subtle Live Dynamic Watermark to defeat external video recording playback */}
        <div
          className="anti-record-live-watermark"
          style={{
            position: 'fixed',
            top: 6,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            pointerEvents: 'none',
            userSelect: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            borderRadius: 999,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            color: 'rgba(255, 255, 255, 0.65)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 5px #10b981' }} />
          <span>CAMPUS SECURITY • LIVE {liveTimestamp}</span>
        </div>

        {children}
      </div>

      {/* Security Privacy Overlay shown when upper menu, screenshot tool, blur, or screen-recording is detected */}
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
            Screen recording, screenshots, upper-menu capture tools, and window-switching are restricted on the student gate pass portal to prevent unauthorized pass sharing.
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
