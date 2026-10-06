import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * useStudentCaptureProtection
 *
 * Comprehensive capture-deterrence for the Student Portal.
 *
 * CRITICAL DESIGN:
 *  For 3-finger screenshot detection (iOS), we bypass React state and
 *  directly mutate the DOM synchronously + force a repaint. This is the
 *  fastest possible response — React state updates are async and too slow
 *  to beat the OS screenshot compositor.
 *
 * @param {React.RefObject} contentRef - Ref to the content wrapper div
 * @returns {{ isConcealed: boolean, dismiss: () => void }}
 */
export default function useStudentCaptureProtection(contentRef) {
  const [isConcealed, setIsConcealed] = useState(false);
  const blurTimerRef = useRef(null);
  const concealTimerRef = useRef(null);
  const originalTitleRef = useRef(document.title);

  // ── Direct DOM concealment (bypasses React for maximum speed) ────────────
  const directConceal = useCallback(() => {
    const el = contentRef?.current;
    if (el) {
      // Synchronous DOM mutation — no React re-render needed
      el.style.filter = 'blur(50px) brightness(0.1)';
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
      // Force synchronous repaint — browser MUST paint this before continuing
      // eslint-disable-next-line no-unused-expressions
      el.offsetHeight;
    }
    setIsConcealed(true);
    window.dispatchEvent(new CustomEvent('heimdall-portal-backgrounded'));
  }, [contentRef]);

  const directReveal = useCallback(() => {
    const el = contentRef?.current;
    if (el) {
      el.style.filter = 'none';
      el.style.opacity = '1';
      el.style.visibility = 'visible';
    }
    setIsConcealed(false);
    window.dispatchEvent(new CustomEvent('heimdall-portal-resumed'));
  }, [contentRef]);

  // ── Dismiss: student taps "Resume Portal" ────────────────────────────────
  const dismiss = useCallback(() => {
    directReveal();
  }, [directReveal]);

  // ── Flash conceal (for keyboard shortcuts) ───────────────────────────────
  const flashConceal = useCallback(() => {
    directConceal();
    clearTimeout(concealTimerRef.current);
    concealTimerRef.current = setTimeout(() => {
      directReveal();
    }, 1500);
  }, [directConceal, directReveal]);

  // ── 1. Visibility / background detection ─────────────────────────────────
  useEffect(() => {
    originalTitleRef.current = document.title;
    document.title = 'HEIMDALL';

    const onVisibilityChange = () => {
      if (document.hidden) directConceal();
      else directReveal();
    };

    const onBlur = () => {
      if (window.__filePickerActive) return;
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => {
        if (!document.hasFocus()) directConceal();
      }, 150);
    };

    const onFocus = () => {
      clearTimeout(blurTimerRef.current);
      if (!document.hidden) directReveal();
    };

    const onPageHide = () => directConceal();
    const onFreeze = () => directConceal();

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
  }, [directConceal, directReveal]);

  // ── 2. Screenshot keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

    const onKeyDown = (e) => {
      let blocked = false;

      if (isMac) {
        // Cmd+Shift+3/4/5/6 (Mac screenshot/recorder)
        if (e.metaKey && e.shiftKey && ['3', '4', '5', '6'].includes(e.key)) {
          blocked = true;
        }
        // Cmd+P (print)
        if (e.metaKey && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault(); e.stopPropagation(); blocked = true;
        }
        // Cmd+S (save)
        if (e.metaKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault(); e.stopPropagation();
        }
      } else {
        // PrintScreen / Win+PrintScreen / Alt+PrintScreen
        if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
          e.preventDefault(); e.stopPropagation(); blocked = true;
        }
        // Win+Shift+S (Snipping Tool)
        if (e.metaKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault(); e.stopPropagation(); blocked = true;
        }
        // Ctrl+P (print)
        if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault(); e.stopPropagation(); blocked = true;
        }
        // Ctrl+S (save)
        if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault(); e.stopPropagation();
        }
      }

      if (blocked) flashConceal();
    };

    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [flashConceal]);

  // ── 3. Multi-touch detection (3-finger iOS/Android screenshot) ───────────
  //    CRITICAL: Uses direct DOM manipulation, NOT React state.
  //    On iOS, the screenshot is captured at the compositor level almost
  //    instantly. We must blur the DOM synchronously and force a repaint
  //    before the compositor grabs the frame.
  useEffect(() => {
    const onTouchStart = (e) => {
      if (e.touches && e.touches.length >= 3) {
        // IMMEDIATE synchronous DOM hide — fastest possible
        directConceal();
        // Auto-restore after 2 seconds
        clearTimeout(concealTimerRef.current);
        concealTimerRef.current = setTimeout(() => {
          directReveal();
        }, 2000);
      }
    };

    const onTouchMove = (e) => {
      if (e.touches && e.touches.length >= 3) {
        directConceal();
        clearTimeout(concealTimerRef.current);
        concealTimerRef.current = setTimeout(() => {
          directReveal();
        }, 2000);
      }
    };

    // IMPORTANT: { passive: true } for scroll performance,
    // but we still get the event early enough for our DOM mutation
    window.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('touchmove', onTouchMove, true);
    };
  }, [directConceal, directReveal]);

  // ── 4. Screen Recording API interception ─────────────────────────────────
  useEffect(() => {
    let origGetDisplayMedia = null;

    if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
      origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

      navigator.mediaDevices.getDisplayMedia = async function (...args) {
        directConceal();
        try {
          const stream = await origGetDisplayMedia(...args);
          stream.getVideoTracks().forEach((track) => {
            track.addEventListener('ended', () => directReveal());
          });
          return stream;
        } catch (err) {
          directReveal();
          throw err;
        }
      };
    }

    return () => {
      if (origGetDisplayMedia && navigator.mediaDevices) {
        navigator.mediaDevices.getDisplayMedia = origGetDisplayMedia;
      }
    };
  }, [directConceal, directReveal]);

  // ── 5. Scoped sensitive-element protection ───────────────────────────────
  useEffect(() => {
    const isSensitive = (el) => el?.closest?.('[data-sensitive]') !== null;

    const onContextMenu = (e) => { if (isSensitive(e.target)) e.preventDefault(); };
    const onSelectStart = (e) => { if (isSensitive(e.target)) e.preventDefault(); };
    const onCopy = (e) => {
      if (isSensitive(e.target)) {
        e.preventDefault();
        e.clipboardData?.setData('text/plain', '');
      }
    };
    const onDragStart = (e) => { if (isSensitive(e.target)) e.preventDefault(); };

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
