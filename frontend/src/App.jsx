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
import SplashScreen from './components/SplashScreen';
import './index.css';

// Helper to automatically retry or force refresh if a chunk fails to load due to a new deployment
const lazyWithRetry = (componentImport) =>
  lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      const isForceRefreshed = sessionStorage.getItem('chunk_retry_refreshed');
      if (!isForceRefreshed) {
        sessionStorage.setItem('chunk_retry_refreshed', 'true');
        window.location.reload();
        return { default: () => null };
      }
      sessionStorage.removeItem('chunk_retry_refreshed');
      throw error;
    }
  });

// ─── Lazy page imports (code splitting with deployment chunk retry) ───────────
const Login               = lazyWithRetry(() => import('./pages/Login'));
const OAuthCallback       = lazyWithRetry(() => import('./pages/OAuthCallback'));
const StudentDashboard    = lazyWithRetry(() => import('./pages/StudentDashboard'));
const WardenDashboard     = lazyWithRetry(() => import('./pages/WardenDashboard'));
const SecurityDashboard   = lazyWithRetry(() => import('./pages/SecurityDashboard'));
const NotReturned         = lazyWithRetry(() => import('./pages/NotReturned'));
const HomeVisits          = lazyWithRetry(() => import('./pages/HomeVisits'));
const ComplaintDashboard  = lazyWithRetry(() => import('./pages/ComplaintDashboard'));
const ScanLogs            = lazyWithRetry(() => import('./pages/ScanLogs'));
const StudentsOut         = lazyWithRetry(() => import('./pages/StudentsOut'));
const WardenStudents      = lazyWithRetry(() => import('./pages/WardenStudents'));
const StudentSimulator    = lazyWithRetry(() => import('./pages/StudentSimulator'));
const ParentHomeVisitRespond = lazyWithRetry(() => import('./pages/ParentHomeVisitRespond'));
const Onboarding          = lazyWithRetry(() => import('./pages/Onboarding'));

// Layout
import Sidebar from './components/Sidebar';
import StudentLayout from './components/StudentLayout';

// ─── Global page loading fallback ─────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="loading-page" style={{ height: 'var(--app-viewport-height)' }}>
      <div className="loading-spinner" style={{ width: 44, height: 44 }} />
      <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</span>
    </div>
  );
}

// ─── Protected Route Wrapper ──────────────────────────────────────────────────
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const hasToken = typeof window !== 'undefined' && Boolean(localStorage.getItem('token'));

  if (loading) return <PageLoader />;
  if (!user || !hasToken) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="loading-page" style={{ height: 'var(--app-viewport-height)' }}>
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

  // Student onboarding redirection guard — triggers ONLY ONCE at initial registration
  if (user.role === 'student') {
    const needsOnboard = !user.rollNo || !user.hostel || !user.phone || !user.parentPhone;
    const isCurrentlyOnboarding = window.location.pathname === '/onboarding';

    if (needsOnboard && !isCurrentlyOnboarding) {
      return <Navigate to="/onboarding" replace />;
    }
    if (!needsOnboard && isCurrentlyOnboarding) {
      return <Navigate to="/student" replace />;
    }
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
  const hasToken = typeof window !== 'undefined' && Boolean(localStorage.getItem('token'));
  const isAuth = Boolean(user && hasToken);

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
          element={isAuth ? <Navigate to={defaultRedirect()} replace /> : <Login />}
        />
        {/* OAuth callback — must be public and unguarded */}
        <Route path="/auth/callback" element={<OAuthCallback />} />
        <Route path="/simulator" element={<StudentSimulator />} />
        <Route path="/home-visit/respond/:visitId" element={<ParentHomeVisitRespond />} />

        {/* ── Student Portal (wrapped in StudentLayout for capture-deterrence) ── */}
        <Route
          path="/student"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentLayout><StudentDashboard /></StudentLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentLayout><Onboarding /></StudentLayout>
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
            <AppLayout><ScanLogs defaultTab="gate" /></AppLayout>
          </ProtectedRoute>
        } />
        <Route path="/home-logs" element={
          <ProtectedRoute allowedRoles={['warden', 'admin']}>
            <AppLayout><ScanLogs defaultTab="home" /></AppLayout>
          </ProtectedRoute>
        } />
        <Route path="/archived-records" element={<Navigate to="/dashboard" replace />} />

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
  const [showSplash, setShowSplash] = useState(true);

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
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
