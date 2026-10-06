import { MdSecurity, MdLock } from 'react-icons/md';
import useStudentCaptureProtection from '../hooks/useStudentCaptureProtection';
import { useAuth } from '../context/AuthContext';
import { setAndroidSecureWindow } from '../utils/nativeSecurityBridge';
import StudentWatermark from './StudentWatermark';
import { useEffect } from 'react';

/**
 * StudentProtectionProvider
 *
 * Mount this ONCE in the student route tree (via StudentLayout).
 * It orchestrates all capture-deterrence layers:
 *
 *   1. useStudentCaptureProtection hook — visibility detection, scoped blocking
 *   2. StudentWatermark — forensic SVG overlay (Roll No, Name, Date)
 *   3. Privacy overlay — neutral "HEIMDALL — Protected" screen when backgrounded
 *   4. Android native bridge — FLAG_SECURE toggle (only effective in custom WebView)
 *   5. Print blanking — @media print CSS hides all student content
 *
 * IMPORTANT: This component does NOT perform a role check. It trusts that
 * it is ONLY rendered inside <StudentLayout> which is only mounted for
 * student routes in App.jsx. This separation keeps the component focused
 * and testable.
 */
export default function StudentProtectionProvider({ children }) {
  const { user } = useAuth();
  const { isConcealed, dismiss } = useStudentCaptureProtection();

  // ── Android native FLAG_SECURE lifecycle ─────────────────────────────────
  // If the app is wrapped in a custom Android WebView with the JS bridge,
  // enable FLAG_SECURE on mount and disable on unmount (leaving student portal).
  useEffect(() => {
    setAndroidSecureWindow(true);
    return () => setAndroidSecureWindow(false);
  }, []);

  return (
    <>
      {/* ── Print blanking CSS (student portal only) ── */}
      <style>{`
        @media print {
          .student-portal-protected,
          .student-portal-protected * {
            visibility: hidden !important;
            height: 0 !important;
            overflow: hidden !important;
          }
          body::after {
            content: "HEIMDALL — Protected Content — Printing Disabled";
            position: fixed; inset: 0;
            display: flex; align-items: center; justify-content: center;
            font-size: 24px; font-weight: 700; color: #333;
            visibility: visible !important; height: auto !important;
          }
        }
      `}</style>

      {/* Forensic watermark (Roll No, Name, Date) */}
      <StudentWatermark user={user} />

      {/* Main student content — hidden + blurred when concealed */}
      <div
        className="student-portal-protected"
        style={{
          filter: isConcealed ? 'blur(45px) brightness(0.2)' : 'none',
          opacity: isConcealed ? 0 : 1,
          visibility: isConcealed ? 'hidden' : 'visible',
          pointerEvents: isConcealed ? 'none' : 'auto',
          transition: 'none', // instant, no animation to leak frames
          minHeight: '100%',
          position: 'relative',
        }}
      >
        {children}
      </div>

      {/* ── Privacy overlay (neutral screen) ── */}
      {isConcealed && (
        <div
          onClick={dismiss}
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
          {/* Glowing shield icon */}
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(16, 185, 129, 0.25))',
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

          {/* Neutral title — does not reveal any student information */}
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
            Student Portal active · Content secured
          </p>

          {/* Resume button */}
          <button
            type="button"
            onClick={dismiss}
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
