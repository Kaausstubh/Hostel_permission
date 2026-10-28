/**
 * HEIMDALL — Email Transport Diagnostic & Live Verification Tool
 *
 * Tests the configured email dispatch pipeline (Gmail API v1 / SMTP / GAS)
 * by sending a single verification email to a recipient address you specify.
 *
 * Usage:
 *   node scripts/testEmail.js [your_test_email@example.com]
 *
 * Examples:
 *   node scripts/testEmail.js mypersonal@gmail.com
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { isGmailApiConfigured, sendViaGmailApi, getAccessToken } = require('../services/gmailApiService');
const { isMailConfigured, sendMail } = require('../services/mailService');

async function runDiagnostic() {
  console.log('\n=============================================================');
  console.log('   HEIMDALL — EMAIL TRANSPORT DIAGNOSTIC & VERIFICATION TOOL  ');
  console.log('=============================================================\n');

  const hasGmailApi = isGmailApiConfigured();
  const hasSmtpUser = Boolean(process.env.SMTP_USER);
  const hasSmtpPass = Boolean(process.env.SMTP_PASS);
  const hasGas = Boolean(process.env.GOOGLE_APPS_SCRIPT_URL);

  console.log('Detected Configurations:');
  console.log(`- Gmail API (OAuth2):  ${hasGmailApi ? '✅ CONFIGURED (GMAIL_REFRESH_TOKEN set)' : '❌ Not configured'}`);
  console.log(`- SMTP (App Password): ${hasSmtpUser && hasSmtpPass ? '✅ CONFIGURED' : '❌ Not configured'}`);
  console.log(`- Google Apps Script:  ${hasGas ? '✅ CONFIGURED' : '❌ Not configured'}\n`);

  if (hasGmailApi) {
    console.log('Active Transport Mode: 🚀 Official Gmail REST API v1 (OAuth2)');
    console.log(`- Sender Account:      ${process.env.GMAIL_SENDER_ADDRESS || 'Not specified (will detect from OAuth profile)'}`);
    console.log(`- OAuth Client ID:     ${process.env.GOOGLE_CLIENT_ID?.slice(0, 16)}...`);
    console.log('- Required Scope:      https://www.googleapis.com/auth/gmail.send\n');
  } else if (hasSmtpUser && hasSmtpPass) {
    console.log('Active Transport Mode: 📧 Direct SMTP Transport');
    console.log(`- Host:                ${process.env.SMTP_HOST || 'smtp.gmail.com'}`);
    console.log(`- User:                ${process.env.SMTP_USER}`);
    console.log('- Password:            [Configured]\n');
  } else if (hasGas) {
    console.log('Active Transport Mode: ☁️  Google Apps Script Relay (Free Quota)\n');
  } else {
    console.error('❌ ERROR: No active email transport found!');
    console.error('To configure the Gmail API, run:');
    console.error('  node scripts/authorizeGmailSender.js\n');
    console.error('Or set SMTP_USER and SMTP_PASS in backend/.env.\n');
    process.exit(1);
  }

  const targetRecipient = process.argv[2] || process.env.GMAIL_SENDER_ADDRESS || process.env.SMTP_USER;

  if (!targetRecipient) {
    console.error('❌ Please specify a recipient email address to test sending:');
    console.error('  node scripts/testEmail.js your_email@example.com\n');
    process.exit(1);
  }

  console.log(`[Step 1/2] Verifying authentication credentials...`);
  if (hasGmailApi) {
    try {
      const token = await getAccessToken();
      console.log(`✅ Token validation SUCCESS! Obtained valid access token (${token.slice(0, 10)}...).`);
    } catch (authErr) {
      console.error('\n❌ GMAIL API AUTHENTICATION FAILED:');
      console.error(authErr.message);
      console.error('\nPlease re-authorize your designated sender account:');
      console.error('  node scripts/authorizeGmailSender.js\n');
      process.exit(1);
    }
  }

  console.log(`\n[Step 2/2] Dispatching live test email to: ${targetRecipient}...`);

  const subject = `✅ HEIMDALL Email Transport Test — ${new Date().toLocaleTimeString('en-US')}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: auto; padding: 24px; background: #0f172a; color: #f8fafc; border-radius: 12px; border: 1px solid #1e293b;">
      <h2 style="color: #38bdf8; margin-top: 0;">🏛️ HEIMDALL Email Service Verified</h2>
      <p style="font-size: 15px; color: #e2e8f0;">Your automated notification pipeline is working successfully!</p>
      <div style="background: #1e293b; padding: 14px; border-radius: 8px; font-size: 13.5px; line-height: 1.6; margin: 16px 0;">
        <strong>Transport:</strong> ${hasGmailApi ? 'Official Gmail REST API v1 (OAuth2)' : 'SMTP Transport'}<br>
        <strong>Recipient:</strong> ${targetRecipient}<br>
        <strong>Timestamp:</strong> ${new Date().toISOString()}<br>
        <strong>Status:</strong> Live Dispatched
      </div>
      <p style="color: #4ade80; font-weight: 600; font-size: 14px;">Automated hostel exit/entry, parent approval, and student notifications are ready to dispatch.</p>
      <p style="font-size: 12px; color: #94a3b8; margin-top: 20px; border-top: 1px solid #334155; padding-top: 12px;">HEIMDALL Smart Campus & Hostel Management Platform</p>
    </div>
  `;

  try {
    const result = await sendMail({
      to: targetRecipient,
      subject,
      html,
    });

    if (result.success) {
      console.log('\n=============================================================');
      console.log('🎉 LIVE EMAIL DISPATCHED SUCCESSFULLY!');
      console.log('=============================================================');
      console.log(`- Provider Message ID: ${result.messageId}`);
      console.log(`- Recipient:          ${targetRecipient}`);
      console.log('\nCheck your inbox (and Spam/Junk folder) to view the message.\n');
    } else {
      console.error('\n❌ DISPATCH FAILED:');
      console.error(`Error: ${result.error || 'Unknown dispatch failure'}\n`);
      process.exit(1);
    }
  } catch (sendErr) {
    console.error('\n❌ UNEXPECTED ERROR:');
    console.error(sendErr.message);
    process.exit(1);
  }
}

runDiagnostic().catch((err) => {
  console.error('Unexpected failure:', err);
  process.exit(1);
});
