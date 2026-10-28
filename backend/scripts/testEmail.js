/**
 * Diagnostic script to test SMTP credentials and Gmail connectivity
 * Usage: node scripts/testEmail.js [recipient_email]
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

async function testSmtp() {
  console.log('\n=========================================');
  console.log('   HEIMDALL SMTP DIAGNOSTIC TEST TOOL   ');
  console.log('=========================================\n');

  const rawUser = process.env.SMTP_USER || '';
  const rawPass = process.env.SMTP_PASS || '';
  const rawHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const rawPort = process.env.SMTP_PORT || '587';

  const cleanUser = rawUser.trim().replace(/^["']|["']$/g, '');
  const cleanPass = rawPass.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');

  console.log('Configuration Check:');
  console.log(`- SMTP_HOST: ${rawHost}`);
  console.log(`- SMTP_PORT: ${rawPort}`);
  console.log(`- SMTP_USER: ${cleanUser ? cleanUser : '❌ [EMPTY]'}`);
  console.log(`- SMTP_PASS: ${cleanPass ? `[SET: ${cleanPass.length} chars]` : '❌ [EMPTY]'}`);

  if (!cleanUser || !cleanPass) {
    console.error('\n❌ ERROR: SMTP_USER or SMTP_PASS is missing in backend/.env!');
    console.error('Please make sure you have typed them into backend/.env AND SAVED the file (Ctrl + S).\n');
    process.exit(1);
  }

  const isGmail = rawHost.includes('gmail') || cleanUser.endsWith('@gmail.com');
  console.log(`- Mode:      ${isGmail ? 'Gmail Service (service: gmail)' : `Custom SMTP (${rawHost}:${rawPort})`}`);

  const transportOptions = isGmail
    ? {
        service: 'gmail',
        auth: {
          user: cleanUser,
          pass: cleanPass,
        },
      }
    : {
        host: rawHost,
        port: parseInt(rawPort, 10),
        secure: process.env.SMTP_SECURE === 'true' || rawPort === '465',
        auth: {
          user: cleanUser,
          pass: cleanPass,
        },
      };

  const transporter = nodemailer.createTransport(transportOptions);

  console.log('\n[1/2] Verifying SMTP connection and credentials with mail server...');
  try {
    await transporter.verify();
    console.log('✅ Connection SUCCESS! Gmail accepted your credentials.');
  } catch (verifyErr) {
    console.error('\n❌ SMTP VERIFICATION FAILED:');
    console.error(verifyErr.message);
    if (verifyErr.message.includes('535') || verifyErr.message.includes('Username and Password not accepted')) {
      console.error('\n👉 Cause: Google rejected the login credentials.');
      console.error('   1. Ensure 2-Step Verification is turned ON for your Google Account.');
      console.error('   2. You MUST use a 16-character "App Password", NOT your personal Google account password.');
      console.error('   3. Generate an App Password at: https://myaccount.google.com/apppasswords');
      console.error('   4. Paste the 16 characters into SMTP_PASS in backend/.env and save (Ctrl + S).\n');
    }
    process.exit(1);
  }

  const targetRecipient = process.argv[2] || cleanUser;
  console.log(`\n[2/2] Sending test email to: ${targetRecipient}...`);

  try {
    const info = await transporter.sendMail({
      from: `"IIIT Pune Smart Campus" <${cleanUser}>`,
      to: targetRecipient,
      replyTo: cleanUser,
      envelope: { from: cleanUser, to: targetRecipient },
      subject: '✅ HEIMDALL SMTP Test Email - Working Successfully',
      text: `HEIMDALL Mail Service Verified\n\nYour SMTP configuration in backend/.env is working properly!\nSender: ${cleanUser}\nRecipient: ${targetRecipient}\nTimestamp: ${new Date().toISOString()}\n\nParent invitations and approval emails are ready to dispatch.`,
      priority: 'high',
      headers: {
        'X-Priority': '1',
        'Importance': 'high',
        'X-Entity-Ref-ID': `heimdall-test-${Date.now()}`,
        'X-Auto-Response-Suppress': 'All, OOF, AutoReply',
      },
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #3b82f6; border-radius: 10px;">
          <h2 style="color: #2563eb; margin-top: 0;">HEIMDALL Mail Service Verified</h2>
          <p>Your SMTP configuration in <strong>backend/.env</strong> is working properly!</p>
          <div style="background: #f3f4f6; padding: 12px; border-radius: 6px; font-size: 14px;">
            <p style="margin: 4px 0;"><strong>Sender:</strong> ${cleanUser}</p>
            <p style="margin: 4px 0;"><strong>Recipient:</strong> ${targetRecipient}</p>
            <p style="margin: 4px 0;"><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          </div>
          <p style="color: #059669; font-weight: bold; margin-top: 15px;">Parent invitations and approval emails are ready to dispatch.</p>
        </div>
      `,
    });

    console.log('✅ TEST EMAIL DISPATCHED SUCCESSFULLY!');
    console.log(`- Message ID: ${info.messageId}`);
    console.log(`- Response:   ${info.response}`);
    console.log('\nNote: Check Inbox AND Spam / Junk folder. If in Spam, click "Report not spam" once to whitelist.\n');
  } catch (sendErr) {
    console.error('\n❌ FAILED TO DISPATCH EMAIL:', sendErr.message);
    process.exit(1);
  }
}

testSmtp();
