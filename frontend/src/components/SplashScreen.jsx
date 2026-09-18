/**
 * SplashScreen — Server-Aware Startup Screen
 *
 * Combines brand splash with seamless cold-start wake handling for Render free-tier:
 *  1. Immediate startup intro animation (Logo + IIIT Pune branding).
 *  2. If backend is warm: completes smoothly in ~1.5s and reveals the app.
 *  3. If backend is sleeping/cold-starting: transitions into a polished campus
 *     connection state matching the HEIMDALL design system:
 *        --------------------------------
 *               HEIMDALL
 *           Connecting to Campus Server
 *           ● Starting secure services...
 *           Please wait a few seconds.
 *        --------------------------------
 *  4. Once connected: shows "✓ Connected" and transitions seamlessly.
 *  5. If timed out: displays friendly error with [Retry] button without page reload.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import iiitLogo from '../assets/iiitpune-logo.png';
import backendHealthService from '../services/backendHealthService';

export default function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState('enter'); // 'enter' | 'waking' | 'connected' | 'error' | 'exit'
  const [wakeAttempt, setWakeAttempt] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const isMountedRef = useRef(true);
  const minIntroDoneRef = useRef(false);
  const backendReadyRef = useRef(false);

  const transitionToApp = useCallback(() => {
    if (!isMountedRef.current) return;
    setPhase('exit');
    setTimeout(() => {
      if (isMountedRef.current && typeof onDone === 'function') {
        onDone();
      }
    }, 550);
  }, [onDone]);

  const startWakeProcess = useCallback(() => {
    setPhase((curr) => (curr === 'enter' ? curr : 'waking'));

    backendHealthService
      .waitForBackend({
        maxDurationMs: 75000,
        intervalMs: 2500,
        onProgress: ({ attempt, elapsedSeconds }) => {
          if (!isMountedRef.current) return;
          setWakeAttempt(attempt);
          setElapsedSec(elapsedSeconds);
        },
      })
      .then(() => {
        if (!isMountedRef.current) return;
        backendReadyRef.current = true;

        if (minIntroDoneRef.current) {
          setPhase('connected');
          setTimeout(() => {
            transitionToApp();
          }, 650);
        }
      })
      .catch(() => {
        if (!isMountedRef.current) return;
        setPhase('error');
      });
  }, [transitionToApp]);

  useEffect(() => {
    isMountedRef.current = true;

    // Trigger backend wake-up in background immediately
    startWakeProcess();

    // Minimum intro animation timer (1.4s)
    const introTimer = setTimeout(() => {
      if (!isMountedRef.current) return;
      minIntroDoneRef.current = true;

      if (backendReadyRef.current) {
        // Backend was already warm!
        transitionToApp();
      } else {
        // Backend is still waking up on Render
        setPhase('waking');
      }
    }, 1400);

    return () => {
      isMountedRef.current = false;
      clearTimeout(introTimer);
    };
  }, [startWakeProcess, transitionToApp]);

  const handleRetry = () => {
    setElapsedSec(0);
    setWakeAttempt(0);
    setPhase('waking');
    startWakeProcess();
  };

  const isInteractive = phase === 'error';

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
        background: 'var(--bg-base, #06061a)',
        gap: 0,
        opacity: phase === 'exit' ? 0 : 1,
        transition: 'opacity 0.55s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: isInteractive ? 'auto' : 'none',
        userSelect: 'none',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Ambient radial glow behind card ── */}
      <div
        style={{
          position: 'absolute',
          width: 380,
          height: 380,
          borderRadius: '50%',
          background:
            phase === 'connected'
              ? 'radial-gradient(circle, rgba(16,185,129,0.2) 0%, transparent 70%)'
              : phase === 'error'
              ? 'radial-gradient(circle, rgba(239,68,68,0.15) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, rgba(34,211,238,0.08) 50%, transparent 70%)',
          animation: 'splashGlowPulse 2.4s ease-in-out infinite alternate',
          transition: 'background 0.5s ease',
        }}
      />

      {/* ── Central Logo & Spinner ── */}
      <div
        style={{
          position: 'relative',
          width: 132,
          height: 132,
          marginBottom: 28,
          animation: 'splashLogoIn 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        }}
      >
        {/* Rotating dashed ring */}
        <svg
          width="132"
          height="132"
          viewBox="0 0 132 132"
          style={{
            position: 'absolute',
            inset: 0,
            animation: phase === 'connected' ? 'none' : 'splashRingSpin 3s linear infinite',
          }}
        >
          <circle
            cx="66"
            cy="66"
            r="60"
            fill="none"
            stroke="url(#ringGrad)"
            strokeWidth="2.5"
            strokeDasharray={phase === 'connected' ? 'none' : '14 8'}
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop
                offset="0%"
                stopColor={phase === 'connected' ? '#10b981' : phase === 'error' ? '#ef4444' : '#8b5cf6'}
                stopOpacity="1"
              />
              <stop
                offset="50%"
                stopColor={phase === 'connected' ? '#34d399' : phase === 'error' ? '#f87171' : '#22d3ee'}
                stopOpacity="0.8"
              />
              <stop
                offset="100%"
                stopColor={phase === 'connected' ? '#059669' : phase === 'error' ? '#dc2626' : '#8b5cf6'}
                stopOpacity="0.2"
              />
            </linearGradient>
          </defs>
        </svg>

        {/* Inner solid ring */}
        <div
          style={{
            position: 'absolute',
            inset: 8,
            borderRadius: '50%',
            border: `1.5px solid ${
              phase === 'connected'
                ? 'rgba(16,185,129,0.4)'
                : phase === 'error'
                ? 'rgba(239,68,68,0.4)'
                : 'rgba(139,92,246,0.3)'
            }`,
            boxShadow:
              phase === 'connected'
                ? '0 0 28px rgba(16,185,129,0.35)'
                : '0 0 28px rgba(139,92,246,0.25)',
            transition: 'all 0.4s ease',
          }}
        />

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

      {/* ── Status Card ── */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          maxWidth: 380,
          width: '100%',
          padding: '20px 24px',
          background: 'rgba(139, 92, 246, 0.05)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(139, 92, 246, 0.18)',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
        }}
      >
        {/* Brand Eyebrow */}
        <div
          style={{
            fontSize: '11.5px',
            fontWeight: 800,
            letterSpacing: '0.24em',
            color: '#22d3ee',
            textTransform: 'uppercase',
            marginBottom: 8,
            fontFamily: 'Space Grotesk, Inter, sans-serif',
          }}
        >
          HEIMDALL
        </div>

        {/* State Content */}
        {phase === 'enter' && (
          <>
            <h1
              style={{
                fontSize: '24px',
                fontWeight: 800,
                letterSpacing: '-0.3px',
                color: 'var(--text-primary, #f8fafc)',
                margin: 0,
                fontFamily: 'Space Grotesk, Inter, sans-serif',
              }}
            >
              IIIT Pune
            </h1>
            <div
              style={{
                marginTop: 6,
                fontSize: '13px',
                color: 'var(--text-muted, #7c86b4)',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              Smart Access & Hostel Management
            </div>
            <div
              style={{
                marginTop: 18,
                width: 140,
                height: 3,
                borderRadius: 99,
                background: 'rgba(255,255,255,0.06)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: 99,
                  background: 'linear-gradient(90deg, #8b5cf6, #22d3ee)',
                  animation: 'splashProgress 1.4s ease forwards',
                  width: '0%',
                }}
              />
            </div>
          </>
        )}

        {phase === 'waking' && (
          <>
            <h2
              style={{
                fontSize: '19px',
                fontWeight: 700,
                color: 'var(--text-primary, #f8fafc)',
                margin: '0 0 8px 0',
                fontFamily: 'Space Grotesk, Inter, sans-serif',
              }}
            >
              Connecting to Campus Server
            </h2>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: '6px 0 10px 0',
                fontSize: '13.5px',
                color: '#a5b4fc',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#38bdf8',
                  boxShadow: '0 0 10px #38bdf8',
                  animation: 'pulseDot 1.4s ease-in-out infinite',
                }}
              />
              <span>Starting secure campus services…</span>
            </div>

            <p
              style={{
                margin: 0,
                fontSize: '12.5px',
                color: 'var(--text-muted, #7c86b4)',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              Please wait a few seconds. {elapsedSec > 0 && `(${elapsedSec}s)`}
            </p>

            {/* Indeterminate animated loading bar */}
            <div
              style={{
                marginTop: 18,
                width: 160,
                height: 3,
                borderRadius: 99,
                background: 'rgba(255,255,255,0.06)',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  width: '45%',
                  borderRadius: 99,
                  background: 'linear-gradient(90deg, #8b5cf6, #22d3ee)',
                  animation: 'indeterminateSweep 1.6s ease-in-out infinite',
                  boxShadow: '0 0 10px rgba(34,211,238,0.5)',
                }}
              />
            </div>
          </>
        )}

        {phase === 'connected' && (
          <div style={{ padding: '8px 0', animation: 'fadeIn 0.3s ease' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '18px',
                fontWeight: 700,
                color: '#10b981',
                fontFamily: 'Space Grotesk, Inter, sans-serif',
              }}
            >
              <span style={{ fontSize: '20px' }}>✓</span>
              <span>Connected</span>
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: '12.5px',
                color: 'var(--text-muted, #7c86b4)',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              Securing campus connection…
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div style={{ animation: 'fadeIn 0.35s ease' }}>
            <h2
              style={{
                fontSize: '18px',
                fontWeight: 700,
                color: '#ef4444',
                margin: '0 0 8px 0',
                fontFamily: 'Space Grotesk, Inter, sans-serif',
              }}
            >
              Unable to connect to Campus Server
            </h2>
            <p
              style={{
                margin: '0 0 16px 0',
                fontSize: '13px',
                color: 'var(--text-muted, #7c86b4)',
                fontFamily: 'Inter, sans-serif',
                lineHeight: 1.5,
              }}
            >
              The server may be temporarily unavailable or still warming up.
            </p>
            <button
              type="button"
              onClick={handleRetry}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '9px 24px',
                borderRadius: '8px',
                fontSize: '13.5px',
                fontWeight: 600,
                fontFamily: 'Inter, sans-serif',
                background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)',
                transition: 'transform 0.15s ease, opacity 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* ── Keyframes ── */}
      <style>{`
        @keyframes splashLogoIn {
          from { opacity: 0; transform: scale(0.65); }
          to   { opacity: 1; transform: scale(1); }
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
          from { transform: scale(0.88); opacity: 0.55; }
          to   { transform: scale(1.08);  opacity: 0.95; }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 0.4; transform: scale(0.85); }
          50%      { opacity: 1;   transform: scale(1.15); }
        }
        @keyframes indeterminateSweep {
          0%   { left: -45%; }
          100% { left: 100%; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
