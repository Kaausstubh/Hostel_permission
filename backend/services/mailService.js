/**
 * Mail Service
 * Production-ready email transport with mobile-responsive HTML templates.
 * Falls back gracefully to structured dev logging when SMTP credentials are not configured.
 */

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

let transporter = null;

const getCleanCredentials = () => {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const rawUser = (process.env.SMTP_USER || '').trim().replace(/^["']|["']$/g, '');
  const rawPass = (process.env.SMTP_PASS || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
  return { host, user: rawUser, pass: rawPass };
};

const isConfigured = () => {
  const { host, user, pass } = getCleanCredentials();
  return Boolean(host && user && pass);
};

const getTransporter = () => {
  if (transporter) return transporter;

  if (isConfigured()) {
    const { host, user, pass } = getCleanCredentials();
    const isGmail = host.includes('gmail') || user.endsWith('@gmail.com');

    const timeoutOptions = {
      connectionTimeout: 10000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
    };

    if (isGmail) {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true,
        maxConnections: 1,
        rateDelta: 1000,
        rateLimit: 5,
        ...timeoutOptions,
        auth: {
          user,
          pass,
        },
      });
    } else {
      transporter = nodemailer.createTransport({
        host,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
        pool: true,
        maxConnections: 1,
        ...timeoutOptions,
        auth: {
          user,
          pass,
        },
      });
    }
  }
  return transporter;
};

/**
 * Base email dispatcher
 */
const sendMail = async ({ to, subject, html, text }) => {
  if (!isConfigured()) {
    logger.warn(`[MailService:Mock] SMTP credentials not set (SMTP_USER/SMTP_PASS missing). Skipping live email to: ${to} | Subject: "${subject}"`);
    return {
      success: false,
      mocked: true,
      error: 'SMTP credentials not configured on backend (SMTP_USER / SMTP_PASS missing)',
      messageId: `mock-${Date.now()}`,
    };
  }

  const { host, user } = getCleanCredentials();
  const isGmail = host.includes('gmail') || user.endsWith('@gmail.com');

  let from = process.env.SMTP_FROM || '"IIIT Pune Smart Campus" <no-reply@iiitpune.ac.in>';
  // In Gmail SMTP, sender address must match authenticated user to avoid SMTP 553 / SPF drop
  if (isGmail && user) {
    const matchName = from.match(/^"?(.*?)"?\s*<.*?>$/);
    const displayName = matchName && matchName[1] ? matchName[1] : 'IIIT Pune Smart Campus';
    from = `"${displayName}" <${user}>`;
  }

  try {
    const tx = getTransporter();
    const info = await tx.sendMail({
      from,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''),
    });
    logger.info(`[MailService] Sent email to ${to}`, { messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error(`[MailService] Failed to send email to ${to}: ${error.message}`);
    return { success: false, error: error.message };
  }
};

// ── HTML Template Wrapper ──────────────────────────────────────────────────────
const wrapEmail = (title, bodyContent) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f3f4f6; }
    .container { max-width: 560px; margin: 30px auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .header { padding: 24px; text-align: center; background: linear-gradient(135deg, #1e3a8a, #0f172a); border-bottom: 1px solid #1f2937; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; color: #60a5fa; letter-spacing: 0.5px; }
    .header p { margin: 4px 0 0; font-size: 13px; color: #9ca3af; }
    .content { padding: 28px 24px; line-height: 1.6; font-size: 14.5px; color: #e5e7eb; }
    .btn { display: inline-block; padding: 12px 26px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px; margin: 20px 0; }
    .btn-primary { background-color: #2563eb; color: #ffffff !important; }
    .btn-green { background-color: #059669; color: #ffffff !important; }
    .details-box { background-color: #1f2937; border-left: 4px solid #3b82f6; padding: 14px 16px; border-radius: 6px; margin: 18px 0; }
    .details-box p { margin: 6px 0; font-size: 13.5px; }
    .footer { padding: 18px 24px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #1f2937; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏛️ HEIMDALL</h1>
      <p>Hostel & Campus Access Platform</p>
    </div>
    <div class="content">
      ${bodyContent}
    </div>
    <div class="footer">
      This is an automated communication from the Campus Management System.<br>
      Please do not reply directly to this email.
    </div>
  </div>
</body>
</html>
`;

// ── 1. Guardian Invitation Email ───────────────────────────────────────────────
const sendGuardianInviteEmail = async ({ to, guardianName, studentName, collegeName, inviteUrl, expiryDays = 7 }) => {
  const subject = `Campus Hostel: Guardian Account Activation for ${studentName}`;
  const text = `Dear ${guardianName},\n\nYou have been registered as an authorized guardian for student ${studentName} at ${collegeName || 'Campus Management'}.\n\nYou can review and digitally approve or reject your ward's hostel leave requests.\n\nPlease activate your parent account by visiting this secure link:\n${inviteUrl}\n\nNote: This link is valid for ${expiryDays} days and can only be used once.\n\nRegards,\nCampus Hostel Management`;
  const html = wrapEmail(
    subject,
    `
      <h2 style="font-size: 17px; color: #ffffff; margin-top: 0;">Dear ${guardianName},</h2>
      <p>You have been registered as a primary guardian for <strong>${studentName}</strong>.</p>
      <p>You will now review and digitally approve or reject your ward's home-visit (hostel leave) requests securely from your phone or computer.</p>
      <div style="text-align: center;">
        <a href="${inviteUrl}" class="btn btn-primary">Activate Parent Account</a>
      </div>
      <p style="font-size: 12.5px; color: #9ca3af;">
        This invitation link is valid for <strong>${expiryDays} days</strong> and can be used once. If the button above does not work, copy and paste this link into your browser:
      </p>
      <p style="font-size: 11.5px; word-break: break-all; color: #60a5fa;">${inviteUrl}</p>
    `
  );
  return sendMail({ to, subject, html, text });
};

// ── 2. Home Visit Request Notification to Parents ─────────────────────────────
const sendLeaveRequestEmail = async ({ to, guardianName, studentName, leaveDate, returnDate, reason, place, requestUrl }) => {
  const subject = `Home-Visit Leave Approval Request: ${studentName} (${leaveDate} to ${returnDate})`;
  const html = wrapEmail(
    subject,
    `
      <h2 style="font-size: 17px; color: #ffffff; margin-top: 0;">Dear ${guardianName},</h2>
      <p>Your ward <strong>${studentName}</strong> has submitted a home-visit leave request requiring your decision.</p>
      
      <div class="details-box">
        <p><strong>📍 Destination:</strong> ${place || 'Home'}</p>
        <p><strong>📅 Departure:</strong> ${leaveDate}</p>
        <p><strong>📅 Return Date:</strong> ${returnDate}</p>
        <p><strong>📝 Reason:</strong> ${reason}</p>
      </div>

      <p>Please open the Parent Portal to review the details and submit your decision (Approve or Reject):</p>
      <div style="text-align: center; margin: 20px 0;">
        <a href="${requestUrl}" class="btn btn-green" style="font-size: 15px; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 700;">Open Parent Portal & Decide Request</a>
      </div>
      <p style="font-size: 12.5px; color: #9ca3af; line-height: 1.5;">
        Once approved by you, your ward's digital QR gate pass will be automatically generated so they can leave the hostel.<br><br>
        Direct Parent Portal link:<br>
        <a href="${requestUrl}" style="font-size: 12px; word-break: break-all; color: #60a5fa;">${requestUrl}</a>
      </p>
    `
  );
  return sendMail({ to, subject, html });
};

// ── 3. Home Visit Expiry Reminder to Parents ──────────────────────────────────
const sendLeaveReminderEmail = async ({ to, guardianName, studentName, leaveDate, returnDate, reason, requestUrl, hoursLeft = 12 }) => {
  const subject = `Reminder: Pending Leave Approval for ${studentName} (Action needed within ${hoursLeft}h)`;
  const html = wrapEmail(
    subject,
    `
      <h2 style="font-size: 17px; color: #fbbf24; margin-top: 0;">⏳ Reminder: Leave Request Awaiting Your Approval</h2>
      <p>Dear ${guardianName},</p>
      <p>The leave request submitted by <strong>${studentName}</strong> is still awaiting your decision.</p>

      <div class="details-box">
        <p><strong>📅 Departure:</strong> ${leaveDate} | <strong>Return:</strong> ${returnDate}</p>
        <p><strong>📝 Reason:</strong> ${reason}</p>
      </div>

      <p style="color: #f87171; font-weight: 500;">
        If unapproved, this request will automatically expire soon.
      </p>
      <div style="text-align: center;">
        <a href="${requestUrl}" class="btn btn-primary">Take Action Now</a>
      </div>
    `
  );
  return sendMail({ to, subject, html });
};

// ── 4. Leave Request Outcome to Student ───────────────────────────────────────
const sendLeaveOutcomeEmailToStudent = async ({ to, studentName, decision, parentName, remarks, place, leaveDate, returnDate }) => {
  const isApproved = decision === 'APPROVED';
  const approver = parentName || 'Hostel Management';
  const subject = isApproved
    ? `✅ Leave Request Approved (${leaveDate} to ${returnDate})`
    : `❌ Leave Request Rejected (${leaveDate} to ${returnDate})`;

  const statusColor = isApproved ? '#10b981' : '#ef4444';
  const html = wrapEmail(
    subject,
    `
      <h2 style="font-size: 17px; color: ${statusColor}; margin-top: 0;">
        ${isApproved ? '✅ Home Visit Approved' : '❌ Home Visit Rejected'}
      </h2>
      <p>Hello <strong>${studentName}</strong>,</p>
      <p>Your home visit request has been reviewed and <strong>${decision}</strong> by <strong>${approver}</strong>.</p>

      <div class="details-box" style="border-left-color: ${statusColor};">
        <p><strong>📍 Destination:</strong> ${place || 'Home'}</p>
        <p><strong>📅 Dates:</strong> ${leaveDate} → ${returnDate}</p>
        ${remarks ? `<p><strong>💬 Remarks:</strong> "${remarks}"</p>` : ''}
      </div>

      ${isApproved
        ? '<p>Your digital gate pass QR code is active on your student dashboard. Show it at the hostel gate scanner when leaving campus.</p>'
        : '<p>You may not leave the hostel campus for this request without direct consultation with the hostel warden.</p>'
      }
    `
  );
  return sendMail({ to, subject, html });
};

// ── 5. Student Registration OTP ───────────────────────────────────────────────
const sendStudentOtpEmail = async ({ to, name, otp }) => {
  const subject = `Your HEIMDALL Verification Code: ${otp}`;
  const html = wrapEmail(
    subject,
    `
      <h2 style="font-size: 17px; color: #ffffff; margin-top: 0;">Verify your College Email</h2>
      <p>Hello ${name},</p>
      <p>Thank you for registering on HEIMDALL. Please use the following 6-digit code to verify your college email:</p>
      <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #60a5fa; background: #1f2937; padding: 12px 24px; border-radius: 8px; border: 1px dashed #3b82f6;">
          ${otp}
        </span>
      </div>
      <p style="font-size: 12.5px; color: #9ca3af;">This code is valid for 15 minutes. Never share this code with anyone.</p>
    `
  );
  return sendMail({ to, subject, html });
};

// ── 6. Parent Password Reset Email ────────────────────────────────────────────
const sendParentResetPasswordEmail = async ({ to, name, resetUrl }) => {
  const subject = `Reset Your HEIMDALL Parent Password`;
  const html = wrapEmail(
    subject,
    `
      <h2 style="font-size: 17px; color: #ffffff; margin-top: 0;">Reset Your Password</h2>
      <p>Dear ${name},</p>
      <p>We received a request to reset your HEIMDALL parent account password. Click below to set a new password:</p>
      <div style="text-align: center;">
        <a href="${resetUrl}" class="btn btn-primary">Reset Password</a>
      </div>
      <p style="font-size: 12.5px; color: #9ca3af;">This link is valid for 1 hour. If you did not make this request, you can safely ignore this email.</p>
    `
  );
  return sendMail({ to, subject, html });
};

// ── 7. Parent Email Login OTP ─────────────────────────────────────────────────
const sendParentLoginOtpEmail = async ({ to, name, otp }) => {
  const subject = `Your HEIMDALL Parent Login Code: ${otp}`;
  const html = wrapEmail(
    subject,
    `
      <h2 style="font-size: 17px; color: #ffffff; margin-top: 0;">Parent Portal Sign-In Code</h2>
      <p>Dear ${name},</p>
      <p>Use the following one-time code to sign in to the HEIMDALL Parent Portal:</p>
      <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; font-size: 30px; font-weight: 800; letter-spacing: 5px; color: #34d399; background: #1f2937; padding: 12px 24px; border-radius: 8px; border: 1px dashed #059669;">
          ${otp}
        </span>
      </div>
      <p style="font-size: 12.5px; color: #9ca3af;">Valid for 10 minutes. If you did not attempt to sign in, please check your account security.</p>
    `
  );
  return sendMail({ to, subject, html });
};

// ── 8. Official Notice / Communication Email (from Warden / Staff) ────────────
const sendWardenNoticeEmail = async ({ to, recipientName, subject, messageContent, wardenName = 'Hostel Warden' }) => {
  const formattedSubject = subject?.startsWith('HEIMDALL') ? subject : `HEIMDALL Hostel Notice: ${subject || 'Important Information'}`;
  const html = wrapEmail(
    formattedSubject,
    `
      <h2 style="font-size: 17px; color: #60a5fa; margin-top: 0;">Official Hostel Communication</h2>
      <p>Dear <strong>${recipientName || 'Student / Parent'}</strong>,</p>
      <div class="details-box" style="border-left-color: #3b82f6; white-space: pre-wrap; font-size: 14.5px; line-height: 1.6;">${messageContent}</div>
      <p style="font-size: 13px; color: #9ca3af; margin-top: 20px;">
        Issued by: <strong>${wardenName}</strong><br>
        Campus Hostel Administration
      </p>
    `
  );
  return sendMail({ to, subject: formattedSubject, html });
};

// ── 9. Leave Request Outcome to Parent ────────────────────────────────────────
const sendLeaveOutcomeEmailToParent = async ({ to, guardianName, studentName, decision, decidedBy = 'Hostel Administration', remarks, place, leaveDate, returnDate }) => {
  const isApproved = decision === 'APPROVED';
  const subject = isApproved
    ? `✅ Leave Request Approved: ${studentName} (${leaveDate} to ${returnDate})`
    : `❌ Leave Request Rejected: ${studentName} (${leaveDate} to ${returnDate})`;

  const statusColor = isApproved ? '#10b981' : '#ef4444';
  const html = wrapEmail(
    subject,
    `
      <h2 style="font-size: 17px; color: ${statusColor}; margin-top: 0;">
        ${isApproved ? '✅ Home Visit Approved' : '❌ Home Visit Rejected'}
      </h2>
      <p>Dear <strong>${guardianName || 'Parent / Guardian'}</strong>,</p>
      <p>This is to notify you that the home visit request for your ward <strong>${studentName}</strong> has been <strong>${decision}</strong> by <strong>${decidedBy}</strong>.</p>

      <div class="details-box" style="border-left-color: ${statusColor};">
        <p><strong>📍 Destination:</strong> ${place || 'Home'}</p>
        <p><strong>📅 Departure:</strong> ${leaveDate}</p>
        <p><strong>📅 Return Date:</strong> ${returnDate}</p>
        ${remarks ? `<p><strong>💬 Remarks / Reason:</strong> "${remarks}"</p>` : ''}
      </div>

      ${isApproved
        ? '<p>The digital exit gate pass has been generated. Your ward can now scan at the hostel gate to leave.</p>'
        : '<p>The request was not approved. The student is not authorized to leave the hostel campus.</p>'
      }
    `
  );
  return sendMail({ to, subject, html });
};

module.exports = {
  isMailConfigured: isConfigured,
  sendMail,
  sendGuardianInviteEmail,
  sendLeaveRequestEmail,
  sendLeaveReminderEmail,
  sendLeaveOutcomeEmailToStudent,
  sendLeaveOutcomeEmailToParent,
  sendStudentOtpEmail,
  sendParentResetPasswordEmail,
  sendParentLoginOtpEmail,
  sendWardenNoticeEmail,
};

