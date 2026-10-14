import { useEffect } from 'react';
import { setAndroidSecureWindow } from '../utils/nativeSecurityBridge';

/**
 * StudentProtectionProvider
 *
 * Clean layout wrapper for student routes.
 * Preserves Android native FLAG_SECURE window setting where applicable,
 * but removes all blocking overlays, blur screens, and "HEIMDALL — Protected" lockouts.
 */
export default function StudentProtectionProvider({ children }) {
  // ── Android native FLAG_SECURE lifecycle ─────────────────────────────────
  useEffect(() => {
    setAndroidSecureWindow(true);
    return () => setAndroidSecureWindow(false);
  }, []);

  return <>{children}</>;
}
