import { useEffect, useState, useRef } from 'react';
import { MdSecurity, MdShield, MdLock } from 'react-icons/md';
import toast from 'react-hot-toast';

/**
 * AntiScreenshotShield
 *
 * Comprehensive multi-layer protection against screenshots and screen captures
 * on the Student Portal:
 * 1. Window Blur Shield (intercepts macOS Cmd+Shift+3/4/5 & Windows Win+Shift+S snipping tools)
 * 2. Keyboard shortcut prevention (PrintScreen, Cmd+Shift+3/4/5, Ctrl+P, Cmd+P, Ctrl+S, Cmd+S)
 * 3. Clipboard wipe on screen-capture attempts
 * 4. Context-menu & drag-and-drop prevention
 * 5. CSS Print-blocker (@media print)
 */
export default function AntiScreenshotShield({ children }) {
  const [isShieldActive, setIsShieldActive] = useState(false);
  const toastCooldownRef = useRef(0);

  const notifyRestricted = (message = '⚠️ Screenshots and screen captures are prohibited on the student portal for gate security.') => {
    const now = Date.now();
    if (now - toastCooldownRef.current > 2500) {
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

  useEffect(() => {
    // ── 1. Window Blur / Focus Detection ──────────────────────────────────────
    // When a user uses macOS Cmd+Shift+4 / Cmd+Shift+5 or Windows Snipping Tool (Win+Shift+S),
    // the browser window immediately triggers a 'blur' event.
    const handleBlur = () => {
      // Allow legitimate file dialogs / camera interactions without false alarms
      if (window.__filePickerActive) return;
      setIsShieldActive(true);
    };

    const handleFocus = () => {
      // Extended buffer to guarantee screen capture tool (Snipping Tool / Grab) has fully finished
      setTimeout(() => {
        setIsShieldActive(false);
      }, 700);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsShieldActive(true);
      } else {
        setTimeout(() => {
          setIsShieldActive(false);
        }, 700);
      }
    };

    // ── 2. Keyboard Shortcuts Interception ────────────────────────────────────
    const handleKeyDown = (e) => {
      const isMac = navigator.platform?.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // 1. Instantly trigger when Cmd+Shift or Ctrl+Shift are pressed
      if (cmdOrCtrl && e.shiftKey) {
        setIsShieldActive(true);
        notifyRestricted('⚠️ Screen capture shortcuts are blocked on the student portal.');
        setTimeout(() => setIsShieldActive(false), 2500);
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
        setIsShieldActive(true);
        notifyRestricted('⚠️ PrintScreen blocked! Gate passes cannot be screen-captured.');
        setTimeout(() => setIsShieldActive(false), 2500);
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
        setIsShieldActive(true);
        notifyRestricted('⚠️ Screenshot shortcut blocked!');
        setTimeout(() => setIsShieldActive(false), 2500);
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
      // Prevent saving images/QRs via right click
      e.preventDefault();
      notifyRestricted('⚠️ Right-click context menu is restricted on student gate passes.');
    };

    const handleDragStart = (e) => {
      // Prevent dragging QR codes or ID photos off the screen
      e.preventDefault();
    };

    const handleCopy = (e) => {
      // Restrict unauthorized copying of pass codes
      const selection = window.getSelection()?.toString() || '';
      if (selection.length > 50) {
        e.preventDefault();
        notifyRestricted('⚠️ Copying large blocks of portal data is restricted.');
      }
    };

    // ── 4. Mobile 3-Finger Gesture Blocker (Android 3-Finger Swipe Screenshot) ──
    const activePointers = new Set();

    const triggerGestureBlock = (e) => {
      if (e && e.cancelable) {
        e.preventDefault();
      }
      if (e) e.stopPropagation();
      setIsShieldActive(true);
      notifyRestricted('⚠️ 3-finger screenshot gesture blocked! Screen capture is prohibited.');
      setTimeout(() => setIsShieldActive(false), 2500);
      return false;
    };

    const handleTouch = (e) => {
      const touchCount = e.touches?.length || e.targetTouches?.length || 0;
      if (touchCount >= 3) {
        return triggerGestureBlock(e);
      }
    };

    const handlePointerDown = (e) => {
      activePointers.add(e.pointerId);
      if (activePointers.size >= 3) {
        triggerGestureBlock(e);
      }
    };

    const handlePointerUp = (e) => {
      activePointers.delete(e.pointerId);
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
    document.addEventListener('touchstart', handleTouch, { passive: false, capture: true });
    document.addEventListener('touchmove', handleTouch, { passive: false, capture: true });
    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('pointerup', handlePointerUp, { capture: true });
    window.addEventListener('pointercancel', handlePointerUp, { capture: true });

    return () => {
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
      document.removeEventListener('touchstart', handleTouch, true);
      document.removeEventListener('touchmove', handleTouch, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
    };
  }, []);

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

      {/* Main portal contents with dynamic blur when shield is active */}
      <div
        className="anti-screenshot-protected"
        style={{
          filter: isShieldActive ? 'blur(35px)' : 'none',
          transition: 'filter 0.15s ease',
          minHeight: '100%',
        }}
      >
        {children}
      </div>

      {/* Security Privacy Overlay shown when window is blurred or screenshot detected */}
      {isShieldActive && (
        <div
          onClick={() => setIsShieldActive(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            background: 'rgba(6, 6, 26, 0.96)',
            backdropFilter: 'blur(25px)',
            WebkitBackdropFilter: 'blur(25px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 24,
            cursor: 'pointer',
            userSelect: 'none',
            animation: 'fadeInShield 0.15s ease-out forwards',
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
              margin: '0 0 20px',
              lineHeight: 1.55,
            }}
          >
            Screenshots and window-switching are restricted on the student gate pass portal to prevent unauthorized pass sharing.
          </p>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12.5,
              fontWeight: 700,
              color: '#a5b4fc',
              background: 'rgba(99, 102, 241, 0.15)',
              padding: '8px 18px',
              borderRadius: 999,
              border: '1px solid rgba(99, 102, 241, 0.35)',
            }}
          >
            <MdLock size={15} />
            <span>Click anywhere to resume</span>
          </div>
        </div>
      )}
    </>
  );
}
