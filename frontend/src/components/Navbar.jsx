/**
 * Navbar Component
 * Top bar with page title and timestamp
 */
import { useState, useEffect } from 'react';
import { MdNotifications, MdLightMode, MdDarkMode } from 'react-icons/md';
import { useTheme } from '../context/ThemeContext';

export default function Navbar({ title }) {
  const [time, setTime] = useState(new Date());
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="navbar fade-in">
      <div className="navbar-title">{title}</div>
      <div className="navbar-actions">
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {time.toLocaleTimeString('en-IN')}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={toggleTheme} style={{ padding: '8px', position: 'relative', overflow: 'hidden' }} aria-label="Toggle theme">
          {theme === 'light' ? <MdDarkMode size={18} /> : <MdLightMode size={18} />}
        </button>
        <button className="btn btn-ghost btn-sm" style={{ padding: '8px' }}>
          <MdNotifications size={18} />
        </button>
      </div>
    </header>
  );
}
