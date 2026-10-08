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
  MdExitToApp, MdAssignmentInd
} from 'react-icons/md';
import toast from 'react-hot-toast';

const wardenNav = [
  { to: '/dashboard',    icon: <MdDashboard />,    label: 'Overview' },
  { to: '/students',     icon: <MdPeople />,       label: 'Students Directory' },
  { to: '/students-out', icon: <MdExitToApp />,    label: 'Students Out' },
  { to: '/not-returned', icon: <MdWarning />,       label: 'Not Returned', alert: true },
  { to: '/visitors',     icon: <MdAssignmentInd />,label: 'Visitor Logs' },
  { to: '/home-visits',  icon: <MdHome />,          label: 'Home Visits' },
  { to: '/complaints',   icon: <MdReport />,        label: 'Complaints' },
  { to: '/logs',         icon: <MdHistory />,       label: 'Gate Scan Logs' },
  { to: '/home-logs',    icon: <MdHistory />,       label: 'Home Scan Logs' },
];

const securityNav = [
  { to: '/scanner',          icon: <MdQrCodeScanner />, label: 'QR Scanner' },
  { to: '/visitors',         icon: <MdAssignmentInd />, label: 'Visitor Passes' },
  { to: '/logs',             icon: <MdHistory />,       label: 'Scan Logs' },
];

export default function Sidebar({ mobileOpen = false, onClose = () => {} }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navItems = ['warden', 'admin'].includes(user?.role) ? wardenNav : securityNav;

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      toast.success('Logged out successfully');
      navigate('/login', { replace: true });
    }
  };

  const isCurfewAlertActive = () => {
    try {
      const cached = sessionStorage.getItem('heimdall_curfew_info_cache');
      if (cached) {
        const info = JSON.parse(cached);
        if (!info.isPastCurfew) return false;
      } else {
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istDate = new Date(now.getTime() + istOffset);
        if (istDate.getUTCHours() < 20) return false;
      }
      const notReturnedCache = sessionStorage.getItem('heimdall_not_returned_cache');
      if (notReturnedCache) {
        const list = JSON.parse(notReturnedCache);
        return list.length > 0;
      }
      return false;
    } catch {
      return false;
    }
  };

  const curfewAlert = isCurfewAlertActive();

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
        <h2>🏛️ HEIMDALL</h2>
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
            {item.alert && curfewAlert && (
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
            <div className="user-role">{user?.role === 'warden' ? 'Hostel Staff' : user?.role}</div>
          </div>
          <MdLogout style={{ color: 'var(--text-muted)', fontSize: '18px', flexShrink: 0 }} />
        </div>
      </div>
      </aside>
    </>
  );
}
