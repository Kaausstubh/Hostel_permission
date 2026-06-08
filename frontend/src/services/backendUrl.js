const LOCAL_API_FALLBACK = 'http://localhost:5001/api';
const PLACEHOLDER_API_HOSTS = ['your-backend-domain.onrender.com'];

let hasWarnedAboutApiUrl = false;

const normalizeApiUrl = (value) => {
  if (!value) return '';
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/api$/i.test(trimmed) ? trimmed : `${trimmed}/api`;
};

const isPlaceholderApiUrl = (value) =>
  PLACEHOLDER_API_HOSTS.some((host) => value.includes(host));

const warnApiFallback = (reason, fallbackUrl) => {
  if (hasWarnedAboutApiUrl) return;
  hasWarnedAboutApiUrl = true;
  console.warn(`[API] ${reason}. Falling back to ${fallbackUrl}.`);
};

export const resolveApiUrl = () => {
  const envUrl = normalizeApiUrl(import.meta.env.VITE_API_URL);
  if (envUrl && !isPlaceholderApiUrl(envUrl)) return envUrl;

  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  if (['localhost', '127.0.0.1'].includes(hostname)) {
    return LOCAL_API_FALLBACK;
  }

  const sameOriginApi =
    typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

  warnApiFallback(
    envUrl
      ? 'VITE_API_URL is still set to the example placeholder value'
      : 'Missing VITE_API_URL in the production build',
    sameOriginApi
  );

  return sameOriginApi;
};

export const resolveBackendOrigin = () =>
  resolveApiUrl().replace(/\/api$/i, '');
