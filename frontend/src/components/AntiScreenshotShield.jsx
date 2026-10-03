import { useEffect, useState, useRef } from 'react';
import { MdSecurity, MdLock } from 'react-icons/md';
import toast from 'react-hot-toast';

/**
 * AntiScreenshotShield
 *
 * Robust multi-layer protection against screenshots and screen captures
 * on the Student Portal:
 * 1. Mobile 3-Finger Gesture Blocker (Android swipe down gesture) with managed reset timer
 * 2. Window Blur Shield (intercepts macOS Cmd+Shift+3/4/5 & Windows Win+Shift+S snipping tools)
 * 3. Keyboard shortcut prevention (PrintScreen, Cmd+Shift+3/4/5, Ctrl+P, Cmd+P, Ctrl+S, Cmd+S)
 * 4. Clipboard wipe on screen-capture attempts
 * 5. Context-menu & drag-and-drop prevention
 * 6. CSS Print-blocker (@media print)
 */
export default function AntiScreenshotShield({ children }) {
  const [isShieldActive, setIsShieldActive] = useState(false);
  const toastCooldownRef = useRef(0);
  const shieldTimerRef = useRef(null);
  const shieldActiveTimeRef = useRef(0);

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

    // Overwrite clipboard if a screenshot was attempted
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText('⚠️ Screenshots of Heimdall student gate passes are restricted for campus security.').catch(() => {});
    }
  };

  const activateShield = (duration = 3500, message = '') => {
    setIsShieldActive(true);
    shieldActiveTimeRef.current = Date.now();

    if (message) {
      notifyRestricted(message);
    }

    // Clear any previous countdown so rapid/frequent swipes always renew and keep shield up
    if (shieldTimerRef.current) {
      clearTimeout(shieldTimerRef.current);
    }

    shieldTimerRef.current = setTimeout(() => {
      setIsShieldActive(false);
    }, duration);
  };

  useEffect(() => {
    // ── 1. Window Blur / Focus Detection ──────────────────────────────────────
    const handleBlur = () => {
      if (window.__filePickerActive) return;
      activateShield(3500);
    };

    const handleFocus = () => {
      // When window regains focus, do not prematurely dismiss if a shield timer is running.
      // Let the shieldTimerRef expire naturally or require explicit user resume.
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        activateShield(3500);
      }
    };

    // ── 2. Keyboard Shortcuts Interception ────────────────────────────────────
    const handleKeyDown = (e) => {
      const isMac = navigator.platform?.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // 1. Instantly trigger when Cmd+Shift or Ctrl+Shift are pressed
      if (cmdOrCtrl && e.shiftKey) {
        activateShield(3000, '⚠️ Screen capture shortcuts are blocked on the student portal.');
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
        activateShield(3000, '⚠️ PrintScreen blocked! Gate passes cannot be screen-captured.');
        return false;
      }

      // 3. Digit keys with modifiers or symbols (# is Shift+3, $ is Shift+4, % is Shift+5)
      const isScreenshotKey =
        e.code === 'Digit3' ||
        e.code === 'Digit4' ||
        e.code === 'Digit5' ||
        e.code === 'KeyS' ||
        e.key === '#' ||
        e.key === '$' ||
        e.key === '%' ||
        e.key === '3' ||
        e.key === '4' ||
        e.key === '5';

      if (cmdOrCtrl && isScreenshotKey) {
        e.preventDefault();
        e.stopPropagation();
        activateShield(3000, '⚠️ Screenshot shortcut blocked!');
        return false;
      }

      // 4. Print page (Cmd+P / Ctrl+P)
      if (cmdOrCtrl && (e.key === 'p' || e.key === 'P' || e.code === 'KeyP')) {
        e.preventDefault();
        e.stopPropagation();
        notifyRestricted('⚠️ Printing student gate passes is disabled.');
        return false;
      }

      // 5. Save page (Cmd+S / Ctrl+S)
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

    // ── 3. Right-Click Context Menu & Drag Protection ────────────────────────
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

    // ── 4. Mobile Multi-Touch & 3-Finger Gesture Blocker (Android Screenshot Swipes) ──
    const activePointers = new Set();

    const handleTouch = (e) => {
      const touchCount = (e.touches && e.touches.length) || (e.targetTouches && e.targetTouches.length) || 0;
      // Triggers as soon as 2 or more fingers contact the screen (before 3rd finger completes OS gesture)
      if (touchCount >= 2) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        activePointers.clear();
        activateShield(3500, '⚠️ Multi-finger screenshot gesture blocked! Screen capture is prohibited.');
        return false;
      }
    };

    const handleTouchEnd = (e) => {
      const remaining = e.touches ? e.touches.length : 0;
      if (remaining <= 1) {
        activePointers.clear();
      }
    };

    const handlePointerDown = (e) => {
      activePointers.add(e.pointerId);
      if (activePointers.size >= 2) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        activePointers.clear();
        activateShield(3500, '⚠️ Multi-finger screenshot gesture blocked! Screen capture is prohibited.');
      }
    };

    const handlePointerUp = (e) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size <= 1) {
        activePointers.clear();
      }
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('dragstart', handleDragStart);
    window.addEventListener('copy', handleCopy);

    // Touch & Pointer listeners with capture: true & passive: false to cancel 3-finger screenshot swipes
    window.addEventListener('touchstart', handleTouch, { passive: false, capture: true });
    window.addEventListener('touchmove', handleTouch, { passive: false, capture: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: false, capture: true });

    document.addEventListener('touchstart', handleTouch, { passive: false, capture: true });
    document.addEventListener('touchmove', handleTouch, { passive: false, capture: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: false, capture: true });

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('pointerup', handlePointerUp, { capture: true });
    window.addEventListener('pointercancel', handlePointerUp, { capture: true });

    return () => {
      if (shieldTimerRef.current) clearTimeout(shieldTimerRef.current);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('dragstart', handleDragStart);
      window.removeEventListener('copy', handleCopy);

      window.removeEventListener('touchstart', handleTouch, true);
      window.removeEventListener('touchmove', handleTouch, true);
      window.removeEventListener('touchend', handleTouchEnd, true);
      window.removeEventListener('touchcancel', handleTouchEnd, true);

      document.removeEventListener('touchstart', handleTouch, true);
      document.removeEventListener('touchmove', handleTouch, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('touchcancel', handleTouchEnd, true);

      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
    };
  }, []);

  const handleShieldOverlayClick = () => {
    // Prevent accidental finger releases from immediately dismissing the shield!
    // Must wait at least 1.8 seconds after activation before dismissal is accepted
    const elapsed = Date.now() - shieldActiveTimeRef.current;
    if (elapsed < 1800) return;
    setIsShieldActive(false);
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
          filter: isShieldActive ? 'blur(50px)' : 'none',
          opacity: isShieldActive ? 0 : 1,
          visibility: isShieldActive ? 'hidden' : 'visible',
          pointerEvents: isShieldActive ? 'none' : 'auto',
          transition: 'none', // 0ms: instantaneous so camera frame buffer gets 0 pixels
          minHeight: '100%',
        }}
      >
        {children}
      </div>

      {/* Security Privacy Overlay shown when window is blurred or screenshot detected */}
      {isShieldActive && (
        <div
          onClick={handleShieldOverlayClick}
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
            Screenshots and window-switching are restricted on the student gate pass portal to prevent unauthorized pass sharing.
          </p>

          <button
            type="button"
            onClick={() => setIsShieldActive(false)}
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
