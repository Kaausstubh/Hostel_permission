/**
 * Backend Health Service
 *
 * Provides lightweight health checks and graceful cold-start wake handling
 * for Render free-tier deployments.
 *
 * Principles:
 *  - Uses fast native fetch with AbortController (avoids heavy Axios interceptors).
 *  - Deduplicates concurrent checks into a single shared Promise.
 *  - In-memory status caching: once healthy, avoids repeated polling on every component mount.
 *  - Sensible retry intervals (2.5s) and bounded duration (~75s) to avoid hammering.
 *  - Event subscription pattern for reactive UI updates without tight coupling.
 */

import { resolveBackendOrigin, resolveApiUrl } from './backendUrl';

// Cache healthy state for 5 minutes before considering re-probing on critical actions
const HEALTHY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CHECK_TIMEOUT_MS = 3500;
const DEFAULT_MAX_DURATION_MS = 75000;
const DEFAULT_RETRY_INTERVAL_MS = 2500;

class BackendHealthService {
  constructor() {
    this._status = 'idle'; // 'idle' | 'checking' | 'waking' | 'connected' | 'error'
    this._lastHealthyAt = 0;
    this._listeners = new Set();
    this._inFlightWaitPromise = null;
    this._abortController = null;
    this._errorMessage = '';
  }

  /**
   * Current status: 'idle' | 'checking' | 'waking' | 'connected' | 'error'
   */
  get status() {
    return this._status;
  }

  /**
   * Last error message, if any
   */
  get errorMessage() {
    return this._errorMessage;
  }

  /**
   * Checks if backend was verified healthy recently (within HEALTHY_TTL_MS)
   */
  isHealthy() {
    return this._lastHealthyAt > 0 && Date.now() - this._lastHealthyAt < HEALTHY_TTL_MS;
  }

  /**
   * Subscribe to status changes.
   * @param {Function} listener (status, service) => void
   * @returns {Function} unsubscribe
   */
  subscribe(listener) {
    this._listeners.add(listener);
    listener(this._status, this);
    return () => this._listeners.delete(listener);
  }

  _notify(status, errorMsg = '') {
    this._status = status;
    this._errorMessage = errorMsg;
    for (const listener of this._listeners) {
      try {
        listener(this._status, this);
      } catch (err) {
        console.error('[HealthService] Listener error:', err);
      }
    }
  }

  /**
   * Mark backend as healthy manually (e.g. after any successful authenticated API call)
   */
  markHealthy() {
    this._lastHealthyAt = Date.now();
    if (this._status !== 'connected') {
      this._notify('connected');
    }
  }

  /**
   * Reset healthy cache (e.g. after encountering cold-start status 502/503/network error)
   */
  invalidateCache() {
    this._lastHealthyAt = 0;
  }

  /**
   * Single probe to /health with a fast timeout.
   * Does NOT retry. Returns true if 200 OK, false otherwise.
   */
  async probeHealth(timeoutMs = DEFAULT_CHECK_TIMEOUT_MS) {
    const origin = resolveBackendOrigin();
    const urls = [
      `${origin}/health`,
      `${resolveApiUrl()}/health`,
    ];

    for (const url of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'Accept': 'application/json' },
          cache: 'no-store',
        });
        clearTimeout(timer);

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.status === 'ok') {
            this.markHealthy();
            return true;
          }
        }
      } catch {
        clearTimeout(timer);
        // Continue to next URL fallback if any
      }
    }

    return false;
  }

  /**
   * Waits for the backend to wake up, retrying every intervalMs up to maxDurationMs.
   * Deduplicates concurrent calls.
   */
  async waitForBackend({
    maxDurationMs = DEFAULT_MAX_DURATION_MS,
    intervalMs = DEFAULT_RETRY_INTERVAL_MS,
    onProgress,
  } = {}) {
    // If recently healthy, return immediately
    if (this.isHealthy()) {
      this._notify('connected');
      return true;
    }

    // Deduplicate concurrent wait calls
    if (this._inFlightWaitPromise) {
      return this._inFlightWaitPromise;
    }

    this._inFlightWaitPromise = this._runWaitLoop({ maxDurationMs, intervalMs, onProgress })
      .finally(() => {
        this._inFlightWaitPromise = null;
      });

    return this._inFlightWaitPromise;
  }

  async _runWaitLoop({ maxDurationMs, intervalMs, onProgress }) {
    const startTime = Date.now();
    let attempt = 0;

    this._notify('checking');

    // First fast probe
    attempt += 1;
    const initialOk = await this.probeHealth(3000);
    if (initialOk) {
      this._notify('connected');
      return true;
    }

    // Backend is sleeping / waking up on Render
    this._notify('waking');

    while (Date.now() - startTime < maxDurationMs) {
      attempt += 1;
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

      if (typeof onProgress === 'function') {
        onProgress({ attempt, elapsedSeconds });
      }

      // Wait interval before next poll
      await new Promise((resolve) => setTimeout(resolve, intervalMs));

      const isOk = await this.probeHealth(4000);
      if (isOk) {
        this._notify('connected');
        return true;
      }
    }

    // Exhausted retries without waking
    const failureMessage = 'Unable to connect to Campus Server. The server may be temporarily unavailable.';
    this._notify('error', failureMessage);
    throw new Error(failureMessage);
  }

  /**
   * Cancel any pending wait operation
   */
  cancel() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._inFlightWaitPromise = null;
    this._notify('idle');
  }
}

export const backendHealthService = new BackendHealthService();
export default backendHealthService;
