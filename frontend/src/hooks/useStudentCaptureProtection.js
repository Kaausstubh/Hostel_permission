import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * useStudentCaptureProtection
 *
 * Manages visibility-based privacy protection for the Student Portal.
 *
 * WHAT THIS DOES:
 *  - Listens to visibilitychange, blur, focus, pagehide, and freeze events
 *  - Sets `isConcealed = true` when the portal is hidden/backgrounded
 *  - Emits custom events so QR components can react (cancel reveals, etc.)
 *  - Blocks contextmenu/selectstart/copy/dragstart ONLY on elements with
 *    the `data-sensitive` attribute — forms and inputs still work normally
 *  - Sets a neutral document.title while active
 *
 * WHAT THIS DOES NOT DO:
 *  - This CANNOT prevent OS-level screenshots in a browser/PWA.
 *    Only a native Android wrapper with FLAG_SECURE can do that.
 *  - This does not monkey-patch browser prototypes or global APIs.
 *  - This is a DETERRENT, not a prevention mechanism.
 *
 * CLEANUP:
 *  - All listeners are removed on unmount. Navigating away from student
 *    routes leaves zero side effects on guard/warden/admin/public pages.
 *
 * @returns {{ isConcealed: boolean, dismiss: () => void }}
 */
export default function useStudentCaptureProtection() {
  const [isConcealed, setIsConcealed] = useState(false);
  const blurTimerRef = useRef(null);
  const originalTitleRef = useRef(document.title);

  // ── Dismiss: student taps "Resume Portal" ────────────────────────────────
  const dismiss = useCallback(() => {
    setIsConcealed(false);
  }, []);

  // ── Visibility / background detection ────────────────────────────────────
  useEffect(() => {
    // Set neutral page title so browser tab previews don't leak info
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

    // 1. Page Visibility API — tab switch, app minimise, screen off
    const onVisibilityChange = () => {
      if (document.hidden) conceal();
      else reveal();
    };

    // 2. Window blur — notification shade, app switcher, overlay
    //    Debounced to avoid false triggers from rapid focus shifts (e.g. clicking a date picker)
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

    // 3. pagehide — fired when page is being unloaded or bfcache'd
    const onPageHide = () => conceal();

    // 4. freeze — Page Lifecycle API (Chrome 68+)
    //    Fired when the page is frozen (e.g. discarded tab, mobile background)
    const onFreeze = () => conceal();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('freeze', onFreeze);

    return () => {
      clearTimeout(blurTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('freeze', onFreeze);

      // Restore original title on unmount (leaving student portal)
      document.title = originalTitleRef.current;
    };
  }, []);

  // ── Scoped sensitive-element protection ──────────────────────────────────
  // Only blocks interactions on elements (or ancestors) with data-sensitive.
  // Forms, text inputs, and non-sensitive content remain fully interactive.
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

    // Print prevention (Ctrl+P / Cmd+P) — only within student portal
    const onKeyDown = (e) => {
      const mod = navigator.platform?.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;
      if (mod && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('selectstart', onSelectStart);
    document.addEventListener('copy', onCopy);
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('selectstart', onSelectStart);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  return { isConcealed, dismiss };
}
