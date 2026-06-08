/**
 * SplashScreen — Premium animated intro screen
 *
 * Shown once when the app first loads (sessionStorage flag prevents repeating).
 * Animation sequence:
 *   0ms   → Logo + ring scales in from 0 with a spring bounce
 *   400ms → Title fades + slides up
 *   700ms → Tagline fades in
 *   900ms → Progress bar sweeps from 0→100% over 1200ms
 *   2200ms→ Entire screen fades out
 *   2600ms→ onDone() fires, splash unmounts
 */
import { useEffect, useState } from 'react';
import iiitLogo from '../assets/iiitpune-logo.png';

export default function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState('enter'); // enter | exit

  useEffect(() => {
    // Phase timeline
    const exitTimer  = setTimeout(() => setPhase('exit'),  2100);
    const doneTimer  = setTimeout(() => onDone(),          2700);
    return () => { clearTimeout(exitTimer); clearTimeout(doneTimer); };
  }, [onDone]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-page, #0a0f1e)',
        gap: 0,
        opacity: phase === 'exit' ? 0 : 1,
        transition: 'opacity 0.55s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {/* ── Ambient radial glow behind logo ── */}
      <div style={{
        position: 'absolute',
        width: 340,
        height: 340,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)',
        animation: 'splashGlowPulse 2s ease-in-out infinite alternate',
      }} />

      {/* ── Spinning outer ring ── */}
      <div style={{
        position: 'relative',
        width: 148,
        height: 148,
        marginBottom: 36,
        animation: 'splashLogoIn 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        opacity: 0,
      }}>
        {/* Rotating dashed ring */}
        <svg
          width="148" height="148"
          viewBox="0 0 148 148"
          style={{
            position: 'absolute',
            inset: 0,
            animation: 'splashRingSpin 3s linear infinite',
          }}
        >
          <circle
            cx="74" cy="74" r="68"
            fill="none"
            stroke="url(#ringGrad)"
            strokeWidth="2"
            strokeDasharray="14 8"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#3b82f6" stopOpacity="1" />
              <stop offset="50%"  stopColor="#8b5cf6" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        {/* Inner solid ring */}
        <div style={{
          position: 'absolute',
          inset: 8,
          borderRadius: '50%',
          border: '1.5px solid rgba(59,130,246,0.25)',
          boxShadow: '0 0 32px rgba(59,130,246,0.3), inset 0 0 20px rgba(59,130,246,0.1)',
        }} />

        {/* Logo image */}
        <img
          src={iiitLogo}
          alt="IIIT Pune"
          style={{
            position: 'absolute',
            inset: 14,
            width: 'calc(100% - 28px)',
            height: 'calc(100% - 28px)',
            borderRadius: '50%',
            objectFit: 'cover',
          }}
        />
      </div>

      {/* ── Title ── */}
      <div style={{
        animation: 'splashTitleIn 0.55s 0.35s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        opacity: 0,
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 700,
          letterSpacing: '0.22em',
          color: '#3b82f6',
          textTransform: 'uppercase',
          marginBottom: 10,
          fontFamily: 'Space Grotesk, Inter, sans-serif',
        }}>
          Smart Access Portal
        </div>
        <h1 style={{
          fontSize: '32px',
          fontWeight: 800,
          letterSpacing: '-0.5px',
          color: 'var(--text-primary, #f8fafc)',
          margin: 0,
          fontFamily: 'Space Grotesk, Inter, sans-serif',
          lineHeight: 1.1,
        }}>
          IIIT Pune
        </h1>
      </div>

      {/* ── Tagline ── */}
      <div style={{
        animation: 'splashTitleIn 0.5s 0.65s ease forwards',
        opacity: 0,
        marginTop: 12,
        fontSize: '13.5px',
        color: 'rgba(148,163,184,0.8)',
        fontFamily: 'Inter, sans-serif',
        letterSpacing: '0.01em',
      }}>
        Hostel · Gate Pass · Security
      </div>

      {/* ── Progress bar ── */}
      <div style={{
        position: 'absolute',
        bottom: 52,
        width: 180,
        height: 2,
        borderRadius: 99,
        background: 'rgba(255,255,255,0.06)',
        overflow: 'hidden',
        animation: 'splashTitleIn 0.4s 0.8s ease forwards',
        opacity: 0,
      }}>
        <div style={{
          height: '100%',
          borderRadius: 99,
          background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
          animation: 'splashProgress 1.4s 0.9s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          width: '0%',
          boxShadow: '0 0 8px rgba(139,92,246,0.6)',
        }} />
      </div>

      {/* ── Keyframes injected via <style> ── */}
      <style>{`
        @keyframes splashLogoIn {
          from { opacity: 0; transform: scale(0.55); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes splashTitleIn {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes splashRingSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes splashProgress {
          from { width: 0%; }
          to   { width: 100%; }
        }
        @keyframes splashGlowPulse {
          from { transform: scale(0.85); opacity: 0.6; }
          to   { transform: scale(1.1);  opacity: 1; }
        }
      `}</style>
    </div>
  );
}
