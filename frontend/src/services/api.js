/**
 * Axios API Service
 * Centralized HTTP client with JWT interceptor, retry logic, and graceful 401 handling.
 */
import axios from 'axios';
import { resolveApiUrl } from './backendUrl';
import backendHealthService from './backendHealthService';

const WARMUP_CACHE_KEY = 'api-prewarm-at';
const WARMUP_TTL_MS = 4 * 60 * 1000;

const API_URL = resolveApiUrl();

if (import.meta.env.DEV) {
  console.info('[API] Using base URL:', API_URL);
}

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS || 12000),
});

let prewarmPromise = null;

const shouldWarmConnection = () => {
  try {
    const lastWarmAt = Number(sessionStorage.getItem(WARMUP_CACHE_KEY) || '0');
    return !lastWarmAt || Date.now() - lastWarmAt > WARMUP_TTL_MS;
  } catch {
    return true;
  }
};

export const prewarmApiConnection = async () => {
  if (!shouldWarmConnection()) return;
  if (prewarmPromise) return prewarmPromise;

  // Best-effort warmup so the first real auth request is less likely to pay
  // the full cold-start penalty on serverless/container deployments.
  prewarmPromise = api
    .get('/health', {
      timeout: 5000,
      headers: { 'x-prewarm-request': 'true' },
    })
    .then(() => {
      sessionStorage.setItem(WARMUP_CACHE_KEY, String(Date.now()));
    })
    .catch(() => {
      // Silent optimization only.
    })
    .finally(() => {
      prewarmPromise = null;
    });

  return prewarmPromise;
};

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

// ─── Response interceptor: handle 401 globally + cold-start retries ─────────
api.interceptors.response.use(
  (response) => {
    // Mark backend as healthy upon receiving any successful response
    backendHealthService.markHealthy();
    return response;
  },
  async (error) => {
    const config = error.config;
    const status = error.response?.status;

    // Strict 401 check: Only dispatch logout when the backend explicitly rejects the token.
    // Never logout on network errors, timeouts, or 5xx cold-start statuses!
    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.dispatchEvent(new CustomEvent('auth:logout'));
      return Promise.reject(error);
    }

    // Identify cold-start or temporary network failure conditions
    const isNetworkError = !error.response || error.code === 'ECONNABORTED';
    const isWakingStatus = status === 502 || status === 503 || status === 504;
    const isRetryable = isNetworkError || isWakingStatus;

    // Retry read operations or uncompleted requests up to 2 times during cold start
    const method = (config?.method || 'get').toLowerCase();
    const isSafeOrGet = ['get', 'head', 'options'].includes(method) || isNetworkError;
    const maxRetries = 2;
    const retryCount = config?._retryCount ?? 0;

    if (isRetryable && isSafeOrGet && config && retryCount < maxRetries) {
      config._retryCount = retryCount + 1;
      backendHealthService.invalidateCache();

      // Exponential backoff: 1.2s on attempt 1, 2.5s on attempt 2
      const delayMs = retryCount === 0 ? 1200 : 2500;
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      return api(config);
    }

    // Attach user-friendly explanation to error for UI components
    if (isWakingStatus || isNetworkError) {
      error.userFriendlyMessage = 'Campus server is waking up or temporarily busy. Please wait a few seconds and try again.';
    }

    return Promise.reject(error);
  }
);

export default api;

