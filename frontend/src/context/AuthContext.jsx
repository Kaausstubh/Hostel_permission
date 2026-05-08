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

  // Rehydrate from localStorage on mount — wrapped in try-catch to handle
  // corrupted or truncated JSON values that would otherwise crash the app.
  useEffect(() => {
    let cancelled = false;

    try {
      const storedToken = localStorage.getItem('token');
      const storedUser  = localStorage.getItem('user');
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));

        // Keep refreshes fast with cached session state, then silently verify
        // that the stored token still maps to a live account.
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
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setToken(null);
            setUser(null);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });

        return () => {
          cancelled = true;
        };
      }
    } catch {
      // Corrupted storage — clear it and start fresh
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }

    setLoading(false);

    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for forced-logout events emitted by the API interceptor
  // (avoids full page reload on 401 — uses React Router navigation instead)
  useEffect(() => {
    const handleForceLogout = () => {
      setToken(null);
      setUser(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    };
    window.addEventListener('auth:logout', handleForceLogout);
    return () => window.removeEventListener('auth:logout', handleForceLogout);
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { token: t, user: u } = res.data;
    localStorage.setItem('token', t);
    localStorage.setItem('user', JSON.stringify(u));
    setToken(t);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

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
