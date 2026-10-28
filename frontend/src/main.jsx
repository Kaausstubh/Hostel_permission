import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { prewarmApiConnection } from './services/api'

// ⚡ Immediate non-blocking connection prewarm to eliminate cold-start latency
prewarmApiConnection();

// ⚡ Automatically recover from stale Vite chunk hashes after new deployments
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const now = Date.now();
  const lastReload = parseInt(sessionStorage.getItem('last_preload_reload') || '0', 10);
  if (now - lastReload > 4000) {
    sessionStorage.setItem('last_preload_reload', String(now));
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('_v', String(now));
      window.location.replace(url.toString());
    } catch (_) {
      window.location.reload();
    }
  }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
