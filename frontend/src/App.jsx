/**
 * Root App Component
 * React Router setup with protected routes and role-based access.
 * All pages are lazy-loaded to minimise the initial bundle.
 */
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { MdMenu } from 'react-icons/md';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// ─── Lazy page imports (code splitting) ───────────────────────────────────────
const Login               = lazy(() => import('./pages/Login'));
const Register            = lazy(() => import('./pages/Register'));
const StudentDashboard    = lazy(() => import('./pages/StudentDashboard'));
const WardenDashboard     = lazy(() => import('./pages/WardenDashboard'));
const SecurityDashboard   = lazy(() => import('./pages/SecurityDashboard'));
const NotReturned         = lazy(() => import('./pages/NotReturned'));
const HomeVisits          = lazy(() => import('./pages/HomeVisits'));
const ComplaintDashboard  = lazy(() => import('./pages/ComplaintDashboard'));
const ScanLogs            = lazy(() => import('./pages/ScanLogs'));
const StudentsOut         = lazy(() => import('./pages/StudentsOut'));
const WardenStudents      = lazy(() => import('./pages/WardenStudents'));
const StudentSimulator    = lazy(() => import('./pages/StudentSimulator'));
const ParentHomeVisitRespond = lazy(() => import('./pages/ParentHomeVisitRespond'));

// Layout
import Sidebar from './components/Sidebar';

// ─── Global page loading fallback ─────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="loading-page" style={{ height: '100vh' }}>
      <div className="loading-spinner" style={{ width: 44, height: 44 }} />
      <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</span>
    </div>
  );
}

// ─── Protected Route Wrapper ──────────────────────────────────────────────────
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="loading-page" style={{ height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 60 }}>🚫</div>
          <div style={{ fontWeight: 700, marginTop: 16, fontSize: 20 }}>Access Denied</div>
          <div style={{ color: 'var(--text-muted)', marginTop: 8 }}>
            Your role (<code>{user.role}</code>) cannot access this page.
          </div>
        </div>
      </div>
    );
  }

  return children;
};

// ─── Layout Wrapper (with sidebar — for warden + security) ───────────────────
const AppLayout = ({ children }) => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 768) setMobileNavOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="app-layout">
      <button
        className="mobile-nav-toggle"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open navigation menu"
      >
        <MdMenu size={20} />
      </button>
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="main-content">{children}</div>
    </div>
  );
};

// ─── App Routes ───────────────────────────────────────────────────────────────
function AppRoutes() {
  const { user } = useAuth();

  const defaultRedirect = () => {
    if (!user) return '/login';
    if (user.role === 'student')  return '/student';
    if (user.role === 'security') return '/scanner';
    return '/dashboard';
  };

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* ── Public routes ── */}
        <Route
          path="/login"
          element={user ? <Navigate to={defaultRedirect()} replace /> : <Login />}
        />
        <Route
          path="/register"
          element={user ? <Navigate to={defaultRedirect()} replace /> : <Register />}
        />
        <Route path="/simulator" element={<StudentSimulator />} />
        <Route path="/home-visit/respond/:visitId" element={<ParentHomeVisitRespond />} />

        {/* ── Student Portal ── */}
        <Route
          path="/student"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentDashboard />
            </ProtectedRoute>
          }
        />

        {/* ── Warden Routes ── */}
        <Route path="/dashboard" element={
          <ProtectedRoute allowedRoles={['warden']}>
            <AppLayout><WardenDashboard /></AppLayout>
          </ProtectedRoute>
        } />
        <Route path="/students" element={
          <ProtectedRoute allowedRoles={['warden']}>
            <AppLayout><WardenStudents /></AppLayout>
          </ProtectedRoute>
        } />
        <Route path="/students-out" element={
          <ProtectedRoute allowedRoles={['warden', 'security']}>
            <AppLayout><StudentsOut /></AppLayout>
          </ProtectedRoute>
        } />
        <Route path="/not-returned" element={
          <ProtectedRoute allowedRoles={['warden']}>
            <AppLayout><NotReturned /></AppLayout>
          </ProtectedRoute>
        } />
        <Route path="/home-visits" element={
          <ProtectedRoute allowedRoles={['warden']}>
            <AppLayout><HomeVisits /></AppLayout>
          </ProtectedRoute>
        } />
        <Route path="/complaints" element={
          <ProtectedRoute allowedRoles={['warden']}>
            <AppLayout><ComplaintDashboard /></AppLayout>
          </ProtectedRoute>
        } />
        <Route path="/logs" element={
          <ProtectedRoute allowedRoles={['warden', 'security']}>
            <AppLayout><ScanLogs /></AppLayout>
          </ProtectedRoute>
        } />

        {/* ── Security Routes ── */}
        <Route path="/scanner" element={
          <ProtectedRoute allowedRoles={['security', 'warden']}>
            <AppLayout><SecurityDashboard /></AppLayout>
          </ProtectedRoute>
        } />

        {/* ── Default redirects ── */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: 'var(--border)',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '14px',
                },
                success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
                error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
              }}
            />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
