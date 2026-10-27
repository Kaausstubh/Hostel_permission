/**
 * Google Apps Script Free Email Relay Service
 *
 * Dispatches automated transactional emails via Google Apps Script (MailApp)
 * within Google's free quota tier (100 emails/day on free accounts, 1,500/day on Google Workspace).
 *
 * Completely free: ₹0 budget, zero paid SMTP plugins, zero subscription APIs.
 */

const logger = require('../utils/logger');
const { getCleanFrontendUrl } = require('../utils/frontendUrl');

/**
 * Escapes dynamic string values to prevent HTML injection in email templates.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Core dispatcher that calls the Google Apps Script Web App.
 *
 * @param {Object} options
 * @param {string} options.requestId - Unique identifier of the request (for audit/tracing)
 * @param {string} options.to - Recipient parent email address
 * @param {string} options.subject - Email subject line
 * @param {string} options.html - HTML body
 * @param {string} [options.text] - Plain text body fallback
 * @returns {Promise<{ success: boolean, status: string, messageId?: string, error?: string, quotaRemaining?: number, isMocked?: boolean }>}
 */
async function sendViaGoogleAppsScript({ requestId, to, subject, html, text }) {
  const scriptUrl = (process.env.GOOGLE_APPS_SCRIPT_URL || '').trim();
  const scriptSecret = (process.env.GOOGLE_APPS_SCRIPT_SECRET || '').trim();

  // If Google Apps Script is not configured, fall back gracefully to SMTP or mock
  if (!scriptUrl) {
    logger.warn('[GAS MailService] GOOGLE_APPS_SCRIPT_URL not configured. Attempting SMTP/mock fallback...');
    try {
      const { sendMail } = require('./mailService');
      const smtpRes = await sendMail({ to, subject, html, text });
      return {
        success: smtpRes.success,
        status: smtpRes.success ? 'SUBMITTED' : 'FAILED',
        messageId: smtpRes.messageId || `fallback-${Date.now()}`,
        error: smtpRes.error,
        isMocked: Boolean(smtpRes.mocked),
      };
    } catch (fallbackErr) {
      logger.error(`[GAS MailService] Fallback dispatch failed: ${fallbackErr.message}`);
      return {
        success: false,
        status: 'FAILED',
        error: `GAS URL unconfigured and fallback failed: ${fallbackErr.message}`,
      };
    }
  }

  const payload = {
    requestId: String(requestId || `req-${Date.now()}`),
    recipientEmail: to.trim().toLowerCase(),
    subject: subject.trim(),
    htmlBody: html,
    textBody: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    authSecret: scriptSecret,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      redirect: 'follow', // Crucial for Google Apps Script 302 redirects
      signal: controller.signal,
    });

    clearTimeout(timeout);

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      const textRes = await res.text().catch(() => '');
      throw new Error(`Google Apps Script returned invalid JSON (HTTP ${res.status}): ${textRes.slice(0, 200)}`);
    }

    if (!res.ok || data.success === false) {
      const errMsg = data.error || `HTTP ${res.status}: ${res.statusText}`;
      logger.error(`[GAS MailService] Delivery submission error for ${to}: ${errMsg}`);
      return {
        success: false,
        status: 'FAILED',
        error: errMsg,
        quotaRemaining: data.quotaRemaining,
      };
    }

    logger.info(`[GAS MailService] Email submitted via Google Apps Script to ${to}`, {
      messageId: data.messageId,
      quotaRemaining: data.quotaRemaining,
    });

    return {
      success: true,
      status: 'SUBMITTED',
      messageId: data.messageId,
      quotaRemaining: data.quotaRemaining,
    };
  } catch (err) {
    const errMsg = err.name === 'AbortError' ? 'Google Apps Script request timed out (15s)' : err.message;
    logger.error(`[GAS MailService] Network/system exception dispatching to ${to}: ${errMsg}`);
    return {
      success: false,
      status: 'FAILED',
      error: errMsg,
    };
  }
}

/**
 * Generates the standardized Parent Approval email template required by the specification.
 */
function generateParentApprovalEmail({
  studentName,
  studentId,
  rollNo,
  departure,
  expectedReturn,
  reason,
  place,
  reviewUrl,
}) {
  const safeName = escapeHtml(studentName || 'Student');
  const safeId = escapeHtml(rollNo || studentId || 'N/A');
  const safeDeparture = escapeHtml(departure || 'Scheduled Time');
  const safeReturn = escapeHtml(expectedReturn || 'Scheduled Time');
  const safeReason = escapeHtml(reason || 'Home Visit');
  const safePlace = escapeHtml(place || 'Home');
  const safeUrl = encodeURI(reviewUrl);

  const subject = 'HEIMDALL — Home Visit Approval Required';

  const plainText = `Dear Parent/Guardian,

A home-visit request has been submitted by your child through the HEIMDALL Hostel Management System.

Student Details:
* Student Name: ${safeName}
* Student ID: ${safeId}
* Departure: ${safeDeparture}
* Expected Return: ${safeReturn}
* Reason: ${safeReason}
* Destination: ${safePlace}

Please review this request and select your decision:
${safeUrl}

Thank you,
HEIMDALL Hostel Management System

Note: This is a secure automated notification. Do not reply directly to this email.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f3f4f6; }
    .wrapper { width: 100%; background-color: #0b0f19; padding: 24px 12px; }
    .card { max-width: 540px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%); padding: 24px; text-align: center; border-bottom: 1px solid #1f2937; }
    .logo { font-size: 22px; font-weight: 800; color: #60a5fa; letter-spacing: 1px; margin: 0; }
    .subtitle { margin: 4px 0 0; font-size: 13px; color: #9ca3af; letter-spacing: 0.3px; }
    .content { padding: 28px 24px; color: #e5e7eb; font-size: 15px; line-height: 1.6; }
    .details-box { background-color: #1f2937; border: 1px solid #374151; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 16px; margin: 20px 0; }
    .detail-row { margin: 8px 0; font-size: 14px; }
    .detail-label { color: #9ca3af; font-weight: 500; display: inline-block; min-width: 125px; }
    .detail-val { color: #ffffff; font-weight: 600; }
    .btn-wrap { text-align: center; margin: 28px 0 16px; }
    .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 700; font-size: 15px; letter-spacing: 0.3px; box-shadow: 0 4px 14px rgba(37,99,235,0.4); }
    .btn:hover { background-color: #1d4ed8; }
    .security-note { font-size: 12px; color: #9ca3af; background-color: rgba(31,41,55,0.5); border: 1px solid #374151; border-radius: 8px; padding: 12px; margin-top: 20px; line-height: 1.5; }
    .footer { padding: 18px 24px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #1f2937; line-height: 1.5; }
    .link-fallback { word-break: break-all; color: #60a5fa; font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="logo">🏛️ HEIMDALL</div>
        <div class="subtitle">Smart Campus Access &amp; Hostel Management</div>
      </div>
      <div class="content">
        <p style="margin-top: 0;">Dear Parent/Guardian,</p>
        <p>A home-visit request has been submitted by your child through the HEIMDALL Hostel Management System.</p>

        <div style="font-weight: 700; color: #93c5fd; margin-top: 18px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Student Details:</div>
        <div class="details-box">
          <div class="detail-row"><span class="detail-label">• Student Name:</span> <span class="detail-val">${safeName}</span></div>
          <div class="detail-row"><span class="detail-label">• Student ID:</span> <span class="detail-val">${safeId}</span></div>
          <div class="detail-row"><span class="detail-label">• Destination:</span> <span class="detail-val">${safePlace}</span></div>
          <div class="detail-row"><span class="detail-label">• Departure:</span> <span class="detail-val">${safeDeparture}</span></div>
          <div class="detail-row"><span class="detail-label">• Expected Return:</span> <span class="detail-val">${safeReturn}</span></div>
          <div class="detail-row"><span class="detail-label">• Reason:</span> <span class="detail-val">${safeReason}</span></div>
        </div>

        <p>Please review this request and select your decision.</p>

        <div class="btn-wrap">
          <a href="${safeUrl}" class="btn" target="_blank" rel="noopener noreferrer">Review Request</a>
        </div>

        <div class="security-note">
          🔒 <strong>Secure Access:</strong> No account login or app installation required. This encrypted single-use link allows you to review and record your decision directly. Opening the link will not automatically decide the request.
        </div>

        <p style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
          If the button above does not open, copy and paste this link into your browser:<br>
          <a href="${safeUrl}" class="link-fallback">${safeUrl}</a>
        </p>

        <p style="margin-bottom: 0;">Thank you,<br><strong>HEIMDALL Hostel Management System</strong></p>
      </div>
      <div class="footer">
        This is an automated transactional message sent to registered parents/guardians.<br>
        Please do not reply directly to this email.
      </div>
    </div>
  </div>
</body>
</html>`;

  return { subject, html, text: plainText };
}

/**
 * Prepares and sends the parent approval notification for a given home visit.
 *
 * @param {Object} options
 * @param {Object} options.visit - The HomeVisitLog document
 * @param {string} options.rawToken - The unhashed approval token
 * @param {string} options.parentEmail - The recipient parent email
 * @param {string} [options.baseUrl] - Base application URL
 * @returns {Promise<{ success: boolean, status: string, error?: string, messageId?: string, approvalUrl: string }>}
 */
async function sendParentApprovalEmail({ visit, rawToken, parentEmail, baseUrl }) {
  const origin = getCleanFrontendUrl(baseUrl);
  const approvalUrl = `${origin}/home-visit/respond/${visit._id}?token=${rawToken}`;

  const departureFormatted = visit.departure_time
    ? `${visit.leave_date} (${visit.departure_time})`
    : visit.leave_date;

  const returnFormatted = visit.return_time
    ? `${visit.return_date} (${visit.return_time})`
    : visit.return_date;

  const emailContent = generateParentApprovalEmail({
    studentName: visit.name || visit.student_id?.name,
    studentId: visit.rollNo || visit.student_id?.rollNo,
    departure: departureFormatted,
    expectedReturn: returnFormatted,
    reason: visit.reason,
    place: visit.place,
    reviewUrl: approvalUrl,
  });

  const sendResult = await sendViaGoogleAppsScript({
    requestId: visit._id.toString(),
    to: parentEmail,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  return {
    ...sendResult,
    approvalUrl,
  };
}

module.exports = {
  sendViaGoogleAppsScript,
  generateParentApprovalEmail,
  sendParentApprovalEmail,
  escapeHtml,
};
