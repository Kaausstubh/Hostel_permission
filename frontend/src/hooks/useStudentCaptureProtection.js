import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * useStudentCaptureProtection
 *
 * Comprehensive capture-deterrence for the Student Portal.
 *
 * LAYERS:
 *  1. Visibility / background detection (tab switch, app minimise, swipe-up menu)
 *  2. Screenshot keyboard shortcut interception:
 *       Mac:  Cmd+Shift+3 (full), Cmd+Shift+4 (selection), Cmd+Shift+5 (recorder)
 *       Win:  PrintScreen, Win+PrintScreen, Win+Shift+S (Snipping), Alt+PrintScreen
 *       Linux: PrintScreen, Shift+PrintScreen, Alt+PrintScreen
 *  3. Multi-touch detection (3-finger iOS screenshot gesture)
 *  4. Screen recording API interception (getDisplayMedia)
 *  5. Scoped data-sensitive blocking (right-click, copy, drag, select)
 *  6. Print prevention (Ctrl+P / Cmd+P)
 *  7. Save page prevention (Ctrl+S / Cmd+S)
 *
 * CLEANUP:
 *  All listeners are removed on unmount. Navigating away from student
 *  routes leaves zero side effects on guard/warden/admin/public pages.
 *
 * @returns {{ isConcealed: boolean, dismiss: () => void }}
 */
export default function useStudentCaptureProtection() {
  const [isConcealed, setIsConcealed] = useState(false);
  const blurTimerRef = useRef(null);
  const concealTimerRef = useRef(null);
  const originalTitleRef = useRef(document.title);

  // ── Dismiss: student taps "Resume Portal" ────────────────────────────────
  const dismiss = useCallback(() => {
    setIsConcealed(false);
  }, []);

  // ── Helper: conceal with a brief flash (for keyboard shortcuts where
  //    the OS may capture a frame before JS runs) ───────────────────────────
  const flashConceal = useCallback(() => {
    setIsConcealed(true);
    window.dispatchEvent(new CustomEvent('heimdall-portal-backgrounded'));
    // Auto-reveal after 1.5 seconds — enough time for the screenshot
    // to capture the privacy shield instead of actual content
    clearTimeout(concealTimerRef.current);
    concealTimerRef.current = setTimeout(() => {
      setIsConcealed(false);
      window.dispatchEvent(new CustomEvent('heimdall-portal-resumed'));
    }, 1500);
  }, []);

  // ── 1. Visibility / background detection ─────────────────────────────────
  //    Handles: swipe-up menu, app switcher, tab switch, screen off, minimize
  useEffect(() => {
    originalTitleRef.current = document.title;
    document.title = 'HEIMDALL';

    const conceal = () => {
      setIsConcealed(true);
      window.dispatchEvent(new CustomEvent('heimdall-portal-backgrounded'));
    };

    const reveal = () => {
      setIsConcealed(false);
      window.dispatchEvent(new CustomEvent('heimdall-portal-resumed'));
    };

    // Page Visibility API — tab switch, app minimise, screen off
    const onVisibilityChange = () => {
      if (document.hidden) conceal();
      else reveal();
    };

    // Window blur — notification shade, app switcher, overlay, swipe-up menu
    const onBlur = () => {
      if (window.__filePickerActive) return;
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => {
        if (!document.hasFocus()) conceal();
      }, 150);
    };

    const onFocus = () => {
      clearTimeout(blurTimerRef.current);
      if (!document.hidden) reveal();
    };

    // pagehide — page unload or bfcache
    const onPageHide = () => conceal();

    // freeze — Page Lifecycle API (Chrome 68+)
    const onFreeze = () => conceal();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('freeze', onFreeze);

    return () => {
      clearTimeout(blurTimerRef.current);
      clearTimeout(concealTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('freeze', onFreeze);
      document.title = originalTitleRef.current;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Screenshot keyboard shortcut interception ─────────────────────────
  //    Intercepts known screenshot/screen-record shortcuts and immediately
  //    conceals content so the captured frame shows the privacy shield.
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

    const onKeyDown = (e) => {
      let isScreenshotCombo = false;

      if (isMac) {
        // ── Mac Screenshot Shortcuts ──
        // Cmd+Shift+3 = Full screenshot
        // Cmd+Shift+4 = Selection screenshot
        // Cmd+Shift+5 = Screenshot/recording toolbar
        // Cmd+Shift+6 = Touch Bar screenshot
        if (e.metaKey && e.shiftKey && ['3', '4', '5', '6'].includes(e.key)) {
          isScreenshotCombo = true;
        }
        // Cmd+P = Print (can save as PDF = screenshot equivalent)
        if (e.metaKey && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();
          e.stopPropagation();
          isScreenshotCombo = true;
        }
        // Cmd+S = Save page
        if (e.metaKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else {
        // ── Windows / Linux Screenshot Shortcuts ──
        // PrintScreen = Full screenshot
        // Win+PrintScreen = Screenshot saved to file
        // Alt+PrintScreen = Active window screenshot
        // Shift+PrintScreen (Linux) = Selection screenshot
        if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
          e.preventDefault();
          e.stopPropagation();
          isScreenshotCombo = true;
        }
        // Win+Shift+S = Snipping Tool (Windows 10/11)
        if (e.metaKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          e.stopPropagation();
          isScreenshotCombo = true;
        }
        // Ctrl+P = Print
        if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();
          e.stopPropagation();
          isScreenshotCombo = true;
        }
        // Ctrl+S = Save page
        if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          e.stopPropagation();
        }
      }

      if (isScreenshotCombo) {
        flashConceal();
      }
    };

    // Use capture phase (true) to intercept before anything else
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [flashConceal]);

  // ── 3. Multi-touch detection (3-finger iOS screenshot gesture) ───────────
  //    iOS takes a screenshot when 3 fingers tap/swipe. We detect 3+ touch
  //    points and immediately conceal so the captured image is the shield.
  useEffect(() => {
    const onTouchStart = (e) => {
      if (e.touches && e.touches.length >= 3) {
        flashConceal();
      }
    };

    // Also handle touchmove — sometimes the 3rd finger arrives slightly after
    const onTouchMove = (e) => {
      if (e.touches && e.touches.length >= 3) {
        flashConceal();
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [flashConceal]);

  // ── 4. Screen Recording API interception ─────────────────────────────────
  //    If any script tries to call getDisplayMedia (screen share/record),
  //    immediately conceal the portal content.
  useEffect(() => {
    let origGetDisplayMedia = null;

    if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
      origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

      navigator.mediaDevices.getDisplayMedia = async function (...args) {
        // Immediately conceal portal
        setIsConcealed(true);
        window.dispatchEvent(new CustomEvent('heimdall-screen-recording-detected'));

        try {
          const stream = await origGetDisplayMedia(...args);
          // Auto-restore when recording stops
          stream.getVideoTracks().forEach((track) => {
            track.addEventListener('ended', () => {
              setIsConcealed(false);
            });
          });
          return stream;
        } catch (err) {
          setIsConcealed(false);
          throw err;
        }
      };
    }

    return () => {
      // Restore original on unmount — no lingering side effects
      if (origGetDisplayMedia && navigator.mediaDevices) {
        navigator.mediaDevices.getDisplayMedia = origGetDisplayMedia;
      }
    };
  }, []);

  // ── 5. Scoped sensitive-element protection ───────────────────────────────
  //    Only blocks on elements with data-sensitive attribute.
  //    Forms, text inputs, and non-sensitive content remain fully interactive.
  useEffect(() => {
    const isSensitive = (el) => {
      if (!el || !el.closest) return false;
      return el.closest('[data-sensitive]') !== null;
    };

    const onContextMenu = (e) => {
      if (isSensitive(e.target)) e.preventDefault();
    };
    const onSelectStart = (e) => {
      if (isSensitive(e.target)) e.preventDefault();
    };
    const onCopy = (e) => {
      if (isSensitive(e.target)) {
        e.preventDefault();
        e.clipboardData?.setData('text/plain', '');
      }
    };
    const onDragStart = (e) => {
      if (isSensitive(e.target)) e.preventDefault();
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('selectstart', onSelectStart);
    document.addEventListener('copy', onCopy);
    document.addEventListener('dragstart', onDragStart);

    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('selectstart', onSelectStart);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('dragstart', onDragStart);
    };
  }, []);

  return { isConcealed, dismiss };
}
