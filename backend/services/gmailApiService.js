/**
 * Gmail API Service
 * Dispatches automated transactional emails via Google's official Gmail REST API v1
 * using an authorized OAuth2 refresh token for the designated HEIMDALL sender account.
 *
 * Scope: https://www.googleapis.com/auth/gmail.send (minimal necessary privilege)
 * Endpoint: POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send
 */

const MailComposer = require('nodemailer/lib/mail-composer');
const logger = require('../utils/logger');

// In-memory token cache to avoid making a token request on every email
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Validates basic email format
 * @param {string} email
 * @returns {boolean}
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
};

/**
 * Returns clean credentials from environment variables
 */
const getGmailApiCredentials = () => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = (process.env.GMAIL_REFRESH_TOKEN || '').trim();
  const senderAddress = (process.env.GMAIL_SENDER_ADDRESS || process.env.SMTP_USER || '').trim().toLowerCase();
  const senderName = (process.env.GMAIL_SENDER_NAME || 'HEIMDALL Hostel Management').trim();

  return {
    clientId,
    clientSecret,
    refreshToken,
    senderAddress,
    senderName,
  };
};

/**
 * Checks whether Gmail API OAuth credentials are fully configured
 * @returns {boolean}
 */
const isGmailApiConfigured = () => {
  const { clientId, clientSecret, refreshToken } = getGmailApiCredentials();
  return Boolean(clientId && clientSecret && refreshToken);
};

/**
 * Clears the in-memory access token cache (useful in tests or when token is revoked)
 */
const resetTokenCache = () => {
  tokenCache = {
    accessToken: null,
    expiresAt: 0,
  };
};

/**
 * Exchanges the long-lived refresh token for a short-lived access token.
 * Caches the access token until 5 minutes prior to expiration.
 *
 * @returns {Promise<string>} Valid access token
 */
const getAccessToken = async () => {
  const { clientId, clientSecret, refreshToken } = getGmailApiCredentials();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail API credentials incomplete: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN is missing');
  }

  // Return cached token if valid for at least 5 more minutes (300,000 ms)
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt - now > 300000) {
    return tokenCache.accessToken;
  }

  const tokenEndpoint = 'https://oauth2.googleapis.com/token';
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`Failed to parse Google OAuth token response: HTTP ${response.status}`);
  }

  if (!response.ok || data.error) {
    const errorType = data.error || 'token_error';
    const errorDesc = data.error_description || response.statusText;

    if (errorType === 'invalid_grant') {
      logger.error('[GmailApi] Refresh token invalid, expired, or revoked', {
        error: errorType,
        description: errorDesc,
      });
      throw new Error(
        'Gmail authorization expired or revoked (invalid_grant). ' +
        'If your Google Cloud OAuth consent screen is in "Testing" mode, refresh tokens expire after 7 days. ' +
        'Re-authorize the designated sender account using scripts/authorizeGmailSender.js or switch the OAuth app to "Production".'
      );
    }

    if (errorType === 'unauthorized_client' || errorType === 'invalid_client') {
      throw new Error(`Google OAuth Client ID or Client Secret rejected (${errorType}): ${errorDesc}`);
    }

    throw new Error(`Google token refresh failed (${errorType}): ${errorDesc}`);
  }

  const expiresInSeconds = parseInt(data.expires_in || '3600', 10);
  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = now + expiresInSeconds * 1000;

  return data.access_token;
};

/**
 * Builds and base64url-encodes a standard RFC 2822 MIME message
 *
 * @param {Object} options
 * @param {string} options.from
 * @param {string|string[]} options.to
 * @param {string} [options.replyTo]
 * @param {string} options.subject
 * @param {string} [options.text]
 * @param {string} [options.html]
 * @returns {Promise<string>} Base64url-encoded raw email
 */
const buildMimeMessage = async ({ from, to, replyTo, subject, text, html }) => {
  const recipients = Array.isArray(to) ? to.join(', ') : String(to || '').trim();

  const composer = new MailComposer({
    from,
    to: recipients,
    replyTo: replyTo || from,
    subject,
    text: text || '',
    html: html || undefined,
    headers: {
      'X-Priority': '1',
      'Importance': 'high',
      'X-Entity-Ref-ID': `heimdall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      'X-Auto-Response-Suppress': 'All, OOF, AutoReply',
    },
  });

  const buffer = await composer.compile().build();

  // Convert buffer to RFC 4648 base64url format required by Gmail API
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

/**
 * Sends an email using the Gmail REST API (v1)
 *
 * @param {Object} params
 * @param {string|string[]} params.to - Recipient email(s)
 * @param {string} params.subject - Email subject line
 * @param {string} [params.html] - HTML body
 * @param {string} [params.text] - Plain text body fallback
 * @param {string} [params.replyTo] - Reply-To email address
 * @param {string} [params.fromName] - Display name for sender
 * @returns {Promise<{ success: boolean, messageId?: string, threadId?: string, error?: string }>}
 */
const sendViaGmailApi = async ({ to, subject, html, text, replyTo, fromName }) => {
  const recipients = Array.isArray(to) ? to : String(to || '').split(',').map((e) => e.trim()).filter(Boolean);

  if (recipients.length === 0) {
    logger.error('[GmailApi] Recipient address is empty');
    return { success: false, error: 'Recipient address (to) is empty' };
  }

  // Validate recipient addresses
  for (const recipient of recipients) {
    if (!isValidEmail(recipient)) {
      logger.error(`[GmailApi] Invalid recipient email address: "${recipient}"`);
      return { success: false, error: `Invalid recipient email address: ${recipient}` };
    }
  }

  const { senderAddress, senderName } = getGmailApiCredentials();
  const effectiveSenderName = fromName || senderName;
  const fromHeader = senderAddress
    ? `"${effectiveSenderName}" <${senderAddress}>`
    : `"${effectiveSenderName}"`;

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (authErr) {
    logger.error(`[GmailApi] Authentication failed: ${authErr.message}`);
    return { success: false, error: authErr.message };
  }

  let rawMessage;
  try {
    rawMessage = await buildMimeMessage({
      from: fromHeader,
      to: recipients,
      replyTo: replyTo || senderAddress || undefined,
      subject,
      text,
      html,
    });
  } catch (mimeErr) {
    logger.error(`[GmailApi] Failed to construct MIME message: ${mimeErr.message}`);
    return { success: false, error: `MIME construction failed: ${mimeErr.message}` };
  }

  const sendEndpoint = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

  const executeSend = async (token) => {
    const res = await fetch(sendEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawMessage }),
    });

    let resData;
    try {
      resData = await res.json();
    } catch (_) {
      resData = {};
    }

    return { ok: res.ok, status: res.status, data: resData };
  };

  try {
    let result = await executeSend(accessToken);

    // If 401 Unauthorized (access token expired or invalidated), invalidate cache and retry once
    if (result.status === 401) {
      logger.warn('[GmailApi] Access token rejected (401). Refreshing token and retrying dispatch...');
      resetTokenCache();
      accessToken = await getAccessToken();
      result = await executeSend(accessToken);
    }

    // If 429 Rate Limited or 503 Service Unavailable, wait briefly and retry once
    if (result.status === 429 || result.status === 503) {
      logger.warn(`[GmailApi] Rate limited or server busy (HTTP ${result.status}). Retrying after 1.5s...`);
      await new Promise((r) => setTimeout(r, 1500));
      result = await executeSend(accessToken);
    }

    if (!result.ok) {
      const errDetail = result.data?.error?.message || `HTTP ${result.status}`;
      const errCode = result.data?.error?.code || result.status;
      logger.error(`[GmailApi] API dispatch failed (${errCode}): ${errDetail}`);

      if (errDetail.toLowerCase().includes('insufficient authentication scopes') || errCode === 403) {
        return {
          success: false,
          error:
            'Insufficient Gmail API scope. Ensure the designated sender authorized https://www.googleapis.com/auth/gmail.send. ' +
            `Details: ${errDetail}`,
        };
      }

      return { success: false, error: `Gmail API error (${errCode}): ${errDetail}` };
    }

    logger.info(`[GmailApi] Successfully sent email to ${recipients.join(', ')}`, {
      messageId: result.data.id,
      threadId: result.data.threadId,
    });

    return {
      success: true,
      messageId: result.data.id,
      threadId: result.data.threadId,
    };
  } catch (networkErr) {
    logger.error(`[GmailApi] Network error during dispatch: ${networkErr.message}`);
    return { success: false, error: `Network dispatch error: ${networkErr.message}` };
  }
};

module.exports = {
  getGmailApiCredentials,
  isGmailApiConfigured,
  getAccessToken,
  buildMimeMessage,
  sendViaGmailApi,
  isValidEmail,
  resetTokenCache,
};
