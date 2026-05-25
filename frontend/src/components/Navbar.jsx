/**
 * Navbar Component
 * Top bar with page title, timestamp, and animated theme toggle
 */
import { useState, useEffect } from 'react';
import { MdNotifications, MdLightMode, MdDarkMode } from 'react-icons/md';
import { useTheme } from '../context/ThemeContext';

export default function Navbar({ title }) {
  const [time, setTime] = useState(new Date());
  const { theme, toggleTheme } = useTheme();
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = () => {
    setIsAnimating(true);
    toggleTheme();
    setTimeout(() => setIsAnimating(false), 500);
  };

  return (
    <header className="navbar fade-in">
      <div className="navbar-title">{title}</div>
      <div className="navbar-actions">
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {time.toLocaleTimeString('en-IN')}
        </span>

        {/* Animated Theme Toggle */}
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleToggle}
          aria-label="Toggle theme"
          style={{
            padding: '8px',
            position: 'relative',
            overflow: 'hidden',
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              transition: 'transform 0.45s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease',
              transform: isAnimating
                ? 'rotate(180deg) scale(0.5)'
                : 'rotate(0deg) scale(1)',
              opacity: isAnimating ? 0.3 : 1,
            }}
          >
            {theme === 'light'
              ? <MdDarkMode size={18} />
              : <MdLightMode size={18} />
            }
          </span>

          {/* Glow ripple on click */}
          {isAnimating && (
            <span
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: theme === 'light'
                  ? 'radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%)'
                  : 'radial-gradient(circle, rgba(245,206,80,0.2) 0%, transparent 70%)',
                animation: 'themeRipple 0.5s ease-out forwards',
                pointerEvents: 'none',
              }}
            />
          )}
        </button>

        <button className="btn btn-ghost btn-sm" style={{ padding: '8px' }}>
          <MdNotifications size={18} />
        </button>
      </div>

      <style>{`
        @keyframes themeRipple {
          0% { transform: scale(0); opacity: 1; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      `}</style>
    </header>
  );
}
