import { useEffect, useState, useRef, useCallback } from 'react';
import { MdSecurity, MdLock } from 'react-icons/md';
import { useAuth } from '../context/AuthContext';
import { setAndroidSecureWindow } from '../utils/nativeSecurityBridge';
import StudentWatermark from './StudentWatermark';

/**
 * AntiScreenshotShield — Student Portal Capture & Privacy Protection
 *
 * SCOPE & ACCESS CONTROL:
 *  - STRICTLY active ONLY for authenticated students inside the Student Portal.
 *  - Inactive for Guard, Warden, Admin, Login, and Public portals.
 *  - Automatically tears down and releases native & browser locks on unmount / navigation.
 *
 * DEFENSE-IN-DEPTH ARCHITECTURE:
 *  1. Android Native Layer:
 *     Invokes WindowManager.LayoutParams.FLAG_SECURE via native WebView bridge.
 *     OS-level blocking of screenshots, screen-recording, recent-app previews, and hardware combos.
 *  2. Background Privacy Shield:
 *     Detects document.visibilitychange / pagehide / window blur.
 *     Instantly replaces sensitive student data & QR passes with neutral screen:
 *       "HEIMDALL — Protected"
 *     Seamlessly restores portal when student returns to active tab.
 *  3. Screen Recording API Interception:
 *     Monitors navigator.mediaDevices.getDisplayMedia and canvas captureStream.
 *     Hides content during capture; restores when capture session terminates.
 *  4. Client-side Exfiltration Barriers:
 *     Restricts unnecessary context menus, drag-and-drop, and text copying on sensitive elements.
 *  5. Print Media Blanking:
 *     Scoped CSS @media print blurs and blanks student portal printouts.
 *  6. Visual Forensic Watermark:
 *     Applies an unobtrusive, tamper-resistant repeating identity watermark (Roll No, Name, Date).
 */
export default function AntiScreenshotShield({ children }) {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';

  const [isBackgrounded, setIsBackgrounded] = useState(false);
  const [isScreenRecording, setIsScreenRecording] = useState(false);

  const blurTimerRef = useRef(null);

  // ── 1. Android Native FLAG_SECURE Lifecycle ────────────────────────────────
  useEffect(() => {
    if (!isStudent) return;

    // Enable OS-level WindowManager.LayoutParams.FLAG_SECURE in Android host
    setAndroidSecureWindow(true);

    return () => {
      // Cleanly disable FLAG_SECURE when leaving the Student Portal
      setAndroidSecureWindow(false);
    };
  }, [isStudent]);

  // ── 2. Screen Recording APIs Interception ─────────────────────────────────
  useEffect(() => {
    if (!isStudent) return;

    let origGetDisplayMedia = null;
    let origCanvasCapture = null;
    let origMediaCapture = null;
    let origPiP = null;

    if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
      origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async function (...args) {
        setIsScreenRecording(true);
        window.dispatchEvent(new CustomEvent('heimdall-screen-recording-detected'));

        try {
          const stream = await origGetDisplayMedia(...args);
          // When student stops sharing screen, auto-restore portal
          stream.getVideoTracks().forEach((track) => {
            track.addEventListener('ended', () => {
              setIsScreenRecording(false);
            });
          });
          return stream;
        } catch (err) {
          setIsScreenRecording(false);
          throw err;
        }
      };
    }

    if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype.captureStream) {
      origCanvasCapture = HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream = function (...args) {
        setIsScreenRecording(true);
        return origCanvasCapture.apply(this, args);
      };
    }

    if (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype.captureStream) {
      origMediaCapture = HTMLMediaElement.prototype.captureStream;
      HTMLMediaElement.prototype.captureStream = function (...args) {
        setIsScreenRecording(true);
        return origMediaCapture.apply(this, args);
      };
    }

    if (typeof HTMLVideoElement !== 'undefined' && HTMLVideoElement.prototype.requestPictureInPicture) {
      origPiP = HTMLVideoElement.prototype.requestPictureInPicture;
      HTMLVideoElement.prototype.requestPictureInPicture = async function () {
        setIsScreenRecording(true);
        throw new DOMException('Picture-in-picture is restricted for security.', 'NotAllowedError');
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
  }, [isStudent]);

  // ── 3. Background Privacy & Visibility Listeners ───────────────────────────
  useEffect(() => {
    if (!isStudent) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Portal switched to background / tab changed / app minimized
        setIsBackgrounded(true);
        window.dispatchEvent(new CustomEvent('heimdall-portal-backgrounded'));
      } else {
        // Student resumed active tab
        setIsBackgrounded(false);
        window.dispatchEvent(new CustomEvent('heimdall-portal-resumed'));
      }
    };

    const handlePageHide = () => {
      setIsBackgrounded(true);
    };

    const handleBlur = () => {
      if (window.__filePickerActive) return;
      // Debounce window blur to prevent spuriously triggering during rapid focus shifts
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => {
        if (!document.hasFocus() || document.hidden) {
          setIsBackgrounded(true);
        }
      }, 100);
    };

    const handleFocus = () => {
      clearTimeout(blurTimerRef.current);
      if (!document.hidden) {
        setIsBackgrounded(false);
      }
    };

    // Keyboard print and offline saving prevention
    const handleKeyDown = (e) => {
      const isMac = navigator.platform?.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Print (Cmd+P / Ctrl+P)
      if (cmdOrCtrl && (e.key === 'p' || e.key === 'P' || e.code === 'KeyP')) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Save page (Cmd+S / Ctrl+S)
      if (cmdOrCtrl && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    // Right-click context menu prevention
    const handleContextMenu = (e) => {
      // Disallow right-click context menu within student portal
      e.preventDefault();
    };

    // Image & element drag protection
    const handleDragStart = (e) => {
      e.preventDefault();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('dragstart', handleDragStart);

    return () => {
      clearTimeout(blurTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('dragstart', handleDragStart);
    };
  }, [isStudent]);

  const handleResumePortal = useCallback((e) => {
    e?.stopPropagation();
    setIsBackgrounded(false);
    setIsScreenRecording(false);
  }, []);

  // ── 4. Non-Student Role Bypass ─────────────────────────────────────────────
  // If user is not authenticated or not a student (e.g. Guard, Warden, Admin),
  // render children directly with zero shielding overhead.
  if (!isStudent) {
    return <>{children}</>;
  }

  const isShieldVisible = isBackgrounded || isScreenRecording;

  return (
    <>
      {/* ── Scoped Print Shield & Anti-Selection Styles ── */}
      <style>{`
        @media print {
          .student-portal-shield-protected,
          .student-portal-shield-protected * {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            overflow: hidden !important;
          }
        }
        .student-portal-shield-protected {
          -webkit-user-select: none !important;
          user-select: none !important;
          -webkit-touch-callout: none !important;
        }
        .student-portal-shield-protected img {
          -webkit-user-drag: none !important;
          user-select: none !important;
          pointer-events: auto;
        }
      `}</style>

      {/* Visual Forensic Watermark (Roll No, Name, Date) */}
      <StudentWatermark user={user} />

      {/* Main Student Portal Content */}
      <div
        className="student-portal-shield-protected"
        style={{
          filter: isShieldVisible ? 'blur(45px)' : 'none',
          opacity: isShieldVisible ? 0 : 1,
          visibility: isShieldVisible ? 'hidden' : 'visible',
          pointerEvents: isShieldVisible ? 'none' : 'auto',
          transition: 'none',
          minHeight: '100%',
          position: 'relative',
        }}
      >
        {children}
      </div>

      {/* ── Neutral Background Privacy & Recording Shield ── */}
      {isShieldVisible && (
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
            WebkitUserSelect: 'none',
          }}
        >
          {/* Glowing Shield Icon */}
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(16, 185, 129, 0.25) 100%)',
              border: '2px solid rgba(99, 102, 241, 0.45)',
              boxShadow: '0 0 45px rgba(99, 102, 241, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
              color: '#818cf8',
            }}
          >
            <MdSecurity size={44} />
          </div>

          {/* Neutral Title */}
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              margin: '0 0 10px',
              color: '#ffffff',
              letterSpacing: '-0.02em',
            }}
          >
            HEIMDALL — Protected
          </h2>

          <p
            style={{
              fontSize: 13.5,
              color: '#94a3b8',
              maxWidth: 360,
              margin: '0 0 24px',
              lineHeight: 1.5,
            }}
          >
            {isScreenRecording
              ? 'Screen recording active • Portal content concealed'
              : 'Student Portal active • Content secured'}
          </p>

          {/* Resume Portal Button */}
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
              transition: 'transform 0.15s ease',
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
