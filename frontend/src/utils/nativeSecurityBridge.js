/**
 * Native Android & Web Security Bridge for Heimdall
 *
 * Provides bidirectional communication with host Android WebView containers
 * to toggle Android's official secure-window mechanism:
 *   WindowManager.LayoutParams.FLAG_SECURE
 *
 * SCOPE:
 *  - Enabled ONLY while the authenticated student is active inside the Student Portal.
 *  - Automatically disabled when navigating to Guard, Warden, Admin, Login, or Public pages.
 *
 * ANDROID INTEGRATION REFERENCE:
 * ─────────────────────────────────────────────────────────────────────────────
 * In your Android Activity / WebView client (Kotlin):
 *
 * class WebAppInterface(private val activity: Activity) {
 *     @JavascriptInterface
 *     fun setFlagSecure(enabled: Boolean) {
 *         activity.runOnUiThread {
 *             if (enabled) {
 *                 activity.window.setFlags(
 *                     WindowManager.LayoutParams.FLAG_SECURE,
 *                     WindowManager.LayoutParams.FLAG_SECURE
 *                 )
 *             } else {
 *                 activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
 *             }
 *         }
 *     }
 * }
 *
 * webView.addJavascriptInterface(WebAppInterface(this), "Android")
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Checks if a native WebView bridge is currently available.
 */
export function isNativeBridgeAvailable() {
  return typeof window !== 'undefined' && (
    typeof window.Android?.setFlagSecure === 'function' ||
    typeof window.AndroidBridge?.setSecureWindow === 'function' ||
    typeof window.webkit?.messageHandlers?.setFlagSecure?.postMessage === 'function'
  );
}

/**
 * Toggles Android OS-level WindowManager.LayoutParams.FLAG_SECURE via native bridge.
 *
 * @param {boolean} enabled - true to enable OS screenshot/screen-recording blocking; false to release.
 * @returns {boolean} Whether a native bridge successfully received the instruction.
 */
export function setAndroidSecureWindow(enabled) {
  if (typeof window === 'undefined') return false;

  let bridged = false;

  try {
    // 1. Android Standard JavascriptInterface
    if (typeof window.Android?.setFlagSecure === 'function') {
      window.Android.setFlagSecure(Boolean(enabled));
      bridged = true;
    }
    // 2. Alternate AndroidBridge naming convention
    else if (typeof window.AndroidBridge?.setSecureWindow === 'function') {
      window.AndroidBridge.setSecureWindow(Boolean(enabled));
      bridged = true;
    }
    // 3. iOS WebKit message handler (if wrapped in WKWebView)
    else if (typeof window.webkit?.messageHandlers?.setFlagSecure?.postMessage === 'function') {
      window.webkit.messageHandlers.setFlagSecure.postMessage({ enabled: Boolean(enabled) });
      bridged = true;
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[SecurityBridge] Failed to set native secure window:', err);
    }
  }

  // Always emit a custom DOM event so custom WebView wrappers or Capacitor/Cordova plugins can listen
  try {
    window.dispatchEvent(
      new CustomEvent('heimdall:secure-window', {
        detail: { enabled: Boolean(enabled), timestamp: Date.now() },
      })
    );
  } catch {}

  return bridged;
}
