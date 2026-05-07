/**
 * Navbar Component
 * Top bar with page title, timestamp, animated theme toggle, and PWA install
 */
import { useState, useEffect } from 'react';
import { MdNotifications, MdLightMode, MdDarkMode, MdDownload } from 'react-icons/md';
import { useTheme } from '../context/ThemeContext';
import toast from 'react-hot-toast';

export default function Navbar({ title }) {
  const [time, setTime] = useState(new Date());
  const { theme, toggleTheme } = useTheme();
  const [isAnimating, setIsAnimating] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for the PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleToggle = () => {
    setIsAnimating(true);
    toggleTheme();
    setTimeout(() => setIsAnimating(false), 500);
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        toast.success('App installed successfully! 🎉');
        setDeferredPrompt(null);
      }
    } else {
      toast('App is already installed or not supported on this browser', { icon: 'ℹ️' });
    }
  };

  return (
    <header className="navbar fade-in">
      <div className="navbar-title">{title}</div>
      <div className="navbar-actions">
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {time.toLocaleTimeString('en-IN')}
        </span>

        {/* PWA Install Button */}
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleInstall}
          aria-label="Install App"
          title="Install App"
          style={{
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 20,
          }}
        >
          <MdDownload size={15} />
          <span style={{ display: 'none' }} className="install-label">Install</span>
        </button>

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
        @media (min-width: 640px) {
          .install-label { display: inline !important; }
        }
      `}</style>
    </header>
  );
}
