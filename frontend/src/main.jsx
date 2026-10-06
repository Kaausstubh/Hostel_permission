import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { prewarmApiConnection } from './services/api'

// ⚡ Immediate non-blocking connection prewarm to eliminate cold-start latency
prewarmApiConnection();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
