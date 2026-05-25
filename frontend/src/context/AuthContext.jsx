/**
 * Auth Context
 * Provides authentication state globally via React Context.
 * Hardened with try-catch on localStorage parsing and useCallback on mutations.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]     = useState(null);
  const [token, setToken]   = useState(null);
  const [loading, setLoading] = useState(true);

  // Rehydrate from localStorage on mount.
  // KEY PERF FIX: set loading=false immediately when localStorage has a session,
  // then silently re-validate the token in the background (stale-while-revalidate).
  // This eliminates the full-page spinner on every page refresh.
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

        // Silently verify token is still valid in the background.
        // If expired/revoked, clear state and redirect to login.
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
            // Token was invalid — clear everything and force re-login
            if (parsedUser && parsedUser.role === 'student') {
              const uid = parsedUser.id || parsedUser._id || parsedUser.email;
              const uidStr = typeof uid === 'object' ? uid.toString() : String(uid);
              localStorage.removeItem(`student-dashboard-chat:${uidStr}`);
            }
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setToken(null);
            setUser(null);
          });

        return () => { cancelled = true; };
      }
    } catch {
      // Corrupted storage — clear it and start fresh
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }

    setLoading(false);
    return () => { cancelled = true; };
  }, []);

  // Listen for forced-logout events emitted by the API interceptor
  // (avoids full page reload on 401 — uses React Router navigation instead)
  useEffect(() => {
    const handleForceLogout = () => {
      if (user && user.role === 'student') {
        const uid = user.id || user._id || user.email;
        const uidStr = typeof uid === 'object' ? uid.toString() : String(uid);
        localStorage.removeItem(`student-dashboard-chat:${uidStr}`);
      }
      setToken(null);
      setUser(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    };
    window.addEventListener('auth:logout', handleForceLogout);
    return () => window.removeEventListener('auth:logout', handleForceLogout);
  }, [user]);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { token: t, user: u } = res.data;
    localStorage.setItem('token', t);
    localStorage.setItem('user', JSON.stringify(u));
    if (u && u.role === 'student') {
      const uid = u.id || u._id || u.email;
      const uidStr = typeof uid === 'object' ? uid.toString() : String(uid);
      localStorage.removeItem(`student-dashboard-chat:${uidStr}`);
    }
    setToken(t);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    if (user && user.role === 'student') {
      const uid = user.id || user._id || user.email;
      const uidStr = typeof uid === 'object' ? uid.toString() : String(uid);
      localStorage.removeItem(`student-dashboard-chat:${uidStr}`);
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, [user]);

  const isAuthenticated = Boolean(user && token);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, isAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
