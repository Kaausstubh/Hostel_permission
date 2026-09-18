/**
 * React Hook: useBackendStatus
 *
 * Provides reactive backend health status and cold-start helpers.
 *
 * Usage:
 *   const { status, isHealthy, isWaking, error, retry, waitForBackend } = useBackendStatus();
 */

import { useState, useEffect, useCallback } from 'react';
import backendHealthService from './backendHealthService';

export function useBackendStatus() {
  const [status, setStatus] = useState(backendHealthService.status);
  const [errorMessage, setErrorMessage] = useState(backendHealthService.errorMessage);

  useEffect(() => {
    const unsubscribe = backendHealthService.subscribe((newStatus, service) => {
      setStatus(newStatus);
      setErrorMessage(service.errorMessage);
    });
    return unsubscribe;
  }, []);

  const retry = useCallback(async () => {
    try {
      await backendHealthService.waitForBackend();
      return true;
    } catch {
      return false;
    }
  }, []);

  const waitForBackend = useCallback(async (options) => {
    return backendHealthService.waitForBackend(options);
  }, []);

  return {
    status,
    isHealthy: status === 'connected' || backendHealthService.isHealthy(),
    isChecking: status === 'checking',
    isWaking: status === 'waking',
    isError: status === 'error',
    errorMessage,
    retry,
    waitForBackend,
    markHealthy: () => backendHealthService.markHealthy(),
  };
}

export default useBackendStatus;
