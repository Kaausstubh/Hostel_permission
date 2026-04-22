/**
 * Sidebar Component
 * Role-adaptive navigation for Warden and Security.
 * Students have their own full-page dashboard (no sidebar needed).
 */
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  MdDashboard, MdQrCodeScanner, MdHome, MdReport,
  MdPeople, MdLogout, MdWarning, MdHistory, MdClose,
} from 'react-icons/md';
import toast from 'react-hot-toast';

const wardenNav = [
  { to: '/dashboard',    icon: <MdDashboard />,    label: 'Overview' },
  { to: '/students-out', icon: <MdPeople />,        label: 'Students Out' },
  { to: '/not-returned', icon: <MdWarning />,       label: 'Not Returned', alert: true },
  { to: '/home-visits',  icon: <MdHome />,          label: 'Home Visits' },
  { to: '/complaints',   icon: <MdReport />,        label: 'Complaints' },
  { to: '/logs',         icon: <MdHistory />,       label: 'Scan Logs' },
];

const securityNav = [
  { to: '/scanner', icon: <MdQrCodeScanner />, label: 'QR Scanner' },
  { to: '/logs',    icon: <MdHistory />,       label: 'Scan Logs' },
];

export default function Sidebar({ mobileOpen = false, onClose = () => {} }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navItems = user?.role === 'warden' ? wardenNav : securityNav;

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  return (
    <>
      <div className={`sidebar-backdrop ${mobileOpen ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-mobile-head">
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close navigation">
          <MdClose size={20} />
        </button>
      </div>
      <div className="sidebar-logo">
        <h2>🏛️ Smart Campus</h2>
        <span>Hostel Management System</span>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Navigation</div>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={onClose}
          >
            {item.icon}
            {item.label}
            {item.alert && (
              <span style={{
                marginLeft: 'auto',
                background: '#ef4444',
                borderRadius: '999px',
                width: '8px',
                height: '8px',
                flexShrink: 0,
              }} />
            )}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user" onClick={handleLogout} title="Logout">
          <div className="user-avatar">
            {user?.name?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="user-info">
            <div className="user-name">{user?.name}</div>
            <div className="user-role">{user?.role}</div>
          </div>
          <MdLogout style={{ color: 'var(--text-muted)', fontSize: '18px', flexShrink: 0 }} />
        </div>
      </div>
      </aside>
    </>
  );
}
