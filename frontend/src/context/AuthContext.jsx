/**
 * Auth Context — OAuth Edition
 *
 * Provides global authentication state.
 *
 * Flow:
 *   1. User clicks "Continue with Google" on a portal card in Login.jsx
 *   2. Browser redirects to backend /api/auth/google?portal=<role>
 *   3. Google authenticates → backend redirects to /auth/callback?token=JWT&user=BASE64
 *   4. OAuthCallback.jsx reads params → calls loginWithOAuth(token, user)
 *   5. Token stored in localStorage → all API calls use Bearer token
 *
 * Token re-validation (stale-while-revalidate):
 *   On mount, if a token exists in localStorage, user sees their dashboard instantly.
 *   A background /auth/me call silently re-validates — clears state if token is invalid.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [token, setToken]     = useState(null);
  const [loading, setLoading] = useState(true);

  // ── Rehydrate from localStorage on mount ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    try {
      const storedToken = localStorage.getItem('token');
      const storedUser  = localStorage.getItem('user');

      if (storedToken && storedUser) {
        const parsedUser = JSON.parse(storedUser);
        setToken(storedToken);
        setUser(parsedUser);
        // ⚡ Set loading=false immediately — user sees their dashboard instantly
        setLoading(false);

        // Silently re-validate token in background (stale-while-revalidate)
        api.get('/auth/me')
          .then((res) => {
            if (cancelled) return;
            const freshUser = res.data?.user;
            if (freshUser) {
              localStorage.setItem('user', JSON.stringify(freshUser));
              setUser(freshUser);
            }
          })
          .catch(() => {
            if (cancelled) return;
            // Token is invalid or expired — clear everything and force re-login
            _clearSession(parsedUser);
          });

        return () => { cancelled = true; };
      }
    } catch {
      // Corrupted storage — start fresh
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }

    setLoading(false);
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Listen for forced-logout events from the API 401 interceptor ────────────
  useEffect(() => {
    const handleForceLogout = () => _clearSession(user);
    window.addEventListener('auth:logout', handleForceLogout);
    return () => window.removeEventListener('auth:logout', handleForceLogout);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Internal: clear all session state ───────────────────────────────────────
  const _clearSession = (currentUser) => {
    if (currentUser?.role === 'student') {
      const uid = currentUser.id || currentUser._id || currentUser.email;
      const uidStr = typeof uid === 'object' ? uid.toString() : String(uid);
      localStorage.removeItem(`student-dashboard-chat:${uidStr}`);
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  // ── loginWithOAuth: called by OAuthCallback.jsx after OAuth redirect ─────────
  // Receives the JWT and user payload from the backend redirect URL params.
  const loginWithOAuth = useCallback((newToken, newUser) => {
    if (newUser?.role === 'student') {
      const uid = newUser.id || newUser._id || newUser.email;
      const uidStr = typeof uid === 'object' ? uid.toString() : String(uid);
      localStorage.removeItem(`student-dashboard-chat:${uidStr}`);
    }
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  // ── initiateGoogleOAuth: redirects browser to begin Google OAuth ─────────────
  // portal: 'student' | 'warden' | 'security'
  const initiateGoogleOAuth = useCallback((portal) => {
    const backendUrl =
      import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, '') ||
      'http://localhost:5001';
    window.location.href = `${backendUrl}/api/auth/google?portal=${portal}`;
  }, []);

  // ── logout ───────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      // Best-effort server-side cache invalidation (non-blocking)
      await api.post('/auth/logout').catch(() => {});
    } finally {
      _clearSession(user);
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAuthenticated = Boolean(user && token);

  return (
    <AuthContext.Provider
      value={{ user, token, loginWithOAuth, initiateGoogleOAuth, logout, loading, isAuthenticated }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
