/**
 * Axios API Service
 * Centralized HTTP client with JWT interceptor, retry logic, and graceful 401 handling.
 */
import axios from 'axios';

const LOCAL_API_FALLBACK = 'http://localhost:5000/api';

const normalizeApiUrl = (value) => {
  if (!value) return '';
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/api$/i.test(trimmed) ? trimmed : `${trimmed}/api`;
};

const resolveApiUrl = () => {
  const envUrl = normalizeApiUrl(import.meta.env.VITE_API_URL);
  if (envUrl) return envUrl;

  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (isLocalHost) return LOCAL_API_FALLBACK;

  console.error(
    '[API] Missing VITE_API_URL in production build. Set it in Vercel to your Render backend URL, for example https://your-backend.onrender.com/api'
  );

  return LOCAL_API_FALLBACK;
};

const API_URL = resolveApiUrl();

if (import.meta.env.DEV) {
  console.info('[API] Using base URL:', API_URL);
}

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS || 12000),
});

// ─── Request interceptor: attach Bearer token ─────────────────────────────────
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    // Tag each request so the response interceptor can track retries
    config._retryCount = config._retryCount ?? 0;
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response interceptor: handle 401 globally + 1 retry on network error ─────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;

    // On 401 — dispatch a custom event. AuthContext listens and clears state
    // without forcing a full page reload (better UX than window.location.href).
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.dispatchEvent(new CustomEvent('auth:logout'));
      return Promise.reject(error);
    }

    // Retry once on network errors (no response) or 503 — but never on 4xx
    const isNetworkError = !error.response;
    const isRetryable    = isNetworkError || error.response?.status === 503;
    const hasNotRetried  = config && config._retryCount < 1;

    if (isRetryable && hasNotRetried) {
      config._retryCount += 1;
      // Wait 800ms before retry
      await new Promise((resolve) => setTimeout(resolve, 800));
      return api(config);
    }

    return Promise.reject(error);
  }
);

export default api;
