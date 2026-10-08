/**
 * WebAuthn Platform Authenticator Helper
 * Handles biometric registration and biometric verification for Web / PWA.
 * Uses navigator.credentials.create / navigator.credentials.get with platform authenticators
 * (TouchID, FaceID, Android Biometrics, Windows Hello).
 * Privacy-first: Raw biometric data never leaves hardware; only public keys / signatures are returned.
 */

// Helpers to encode / decode binary ArrayBuffers to base64url strings
export const bufferToBase64Url = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const base64UrlToBuffer = (base64url) => {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * Check if WebAuthn is supported on the client
 */
export const isWebAuthnSupported = () => {
  return typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);
};

/**
 * Check if a platform authenticator (fingerprint, face, PIN) is available
 */
export const isPlatformAuthenticatorAvailable = async () => {
  if (!isWebAuthnSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

/**
 * Register a platform biometric authenticator
 */
export const registerPlatformAuthenticator = async ({
  userId,
  userName,
  userDisplayName,
  challengeStr = 'heimdall-device-registration-challenge',
}) => {
  if (!isWebAuthnSupported()) {
    // Fallback simulated credential for environments without platform authenticator
    return {
      credentialId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      publicKey: `sim_pub_${Math.random().toString(36).slice(2, 12)}`,
      deviceId: `device_${navigator.userAgent.replace(/\s+/g, '_').slice(0, 40)}`,
      deviceModel: navigator.platform || 'Web/Mobile Client',
      simulated: true,
    };
  }

  const challenge = new TextEncoder().encode(challengeStr);
  const idBuffer = new TextEncoder().encode(String(userId));

  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'HEIMDALL Hostel Attendance',
          id: window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname,
        },
        user: {
          id: idBuffer,
          name: userName || 'student@campus.edu',
          displayName: userDisplayName || 'Student',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },  // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          requireResidentKey: false,
        },
        timeout: 60000,
        attestation: 'none',
      },
    });

    const credentialId = bufferToBase64Url(credential.rawId);
    const publicKey = credential.response?.getPublicKey
      ? bufferToBase64Url(credential.response.getPublicKey())
      : bufferToBase64Url(credential.response.attestationObject);

    return {
      credentialId,
      publicKey,
      deviceId: `web_${credentialId.slice(0, 16)}`,
      deviceModel: `${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'} (${navigator.platform || 'Web'})`,
      simulated: false,
    };
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Biometric prompt was cancelled or timed out.');
    }
    // If platform authenticator creation is unsupported or fails, provide simulated fallback with flag
    console.warn('[WebAuthn] Hardware platform registration unavailable, using fallback', err);
    return {
      credentialId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      publicKey: `sim_pub_${Math.random().toString(36).slice(2, 12)}`,
      deviceId: `device_${navigator.userAgent.replace(/\s+/g, '_').slice(0, 40)}`,
      deviceModel: navigator.platform || 'Web/Mobile Client',
      simulated: true,
    };
  }
};

/**
 * Sign a biometric attendance challenge using the registered credential
 */
export const verifyBiometricAssertion = async ({
  credentialId,
  challengeNonce,
}) => {
  if (!isWebAuthnSupported() || credentialId?.startsWith('sim_')) {
    // Simulated verification for test/fallback credentials
    return {
      signature: `sim_sig_${Date.now()}_${challengeNonce}`,
      credentialId,
      simulated: true,
    };
  }

  const challenge = new TextEncoder().encode(challengeNonce);
  const rawId = base64UrlToBuffer(credentialId);

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            type: 'public-key',
            id: rawId,
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    });

    return {
      signature: bufferToBase64Url(assertion.response.signature),
      clientDataJSON: bufferToBase64Url(assertion.response.clientDataJSON),
      authenticatorData: bufferToBase64Url(assertion.response.authenticatorData),
      credentialId,
      simulated: false,
    };
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error('BIOMETRIC_FAILED: Biometric verification failed or was cancelled');
    }
    throw new Error(`BIOMETRIC_FAILED: ${err.message}`);
  }
};
