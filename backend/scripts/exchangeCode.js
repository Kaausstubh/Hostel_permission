/**
 * Helper to exchange authorization code for refresh token and save to .env
 * Usage: node scripts/exchangeCode.js "<full_redirect_url_or_code>"
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

async function exchange() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/exchangeCode.js "<full_redirect_url_or_code>"');
    process.exit(1);
  }

  let code = input.trim();
  if (code.includes('code=')) {
    const match = code.match(/code=([^&]+)/);
    if (match) code = decodeURIComponent(match[1]);
  }

  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:5001/api/auth/gmail/callback';

  console.log(`Exchanging code with Google using redirect URI: ${redirectUri}...`);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  const data = await tokenRes.json();
  if (!tokenRes.ok || data.error) {
    console.error('Exchange failed:', data.error_description || data.error);
    process.exit(1);
  }

  const refreshToken = data.refresh_token;
  if (!refreshToken) {
    console.error('No refresh token returned. Revoke access at https://myaccount.google.com/permissions and retry with prompt=consent.');
    process.exit(1);
  }

  console.log('✅ REFRESH TOKEN RECEIVED SUCCESSFULLY!');

  // Save to .env
  const envPath = path.resolve(__dirname, '../.env');
  let envContent = fs.readFileSync(envPath, 'utf8');

  if (envContent.includes('GMAIL_REFRESH_TOKEN=')) {
    envContent = envContent.replace(/GMAIL_REFRESH_TOKEN=.*(\r?\n|$)/, `GMAIL_REFRESH_TOKEN=${refreshToken}\n`);
  } else {
    envContent += `\nGMAIL_REFRESH_TOKEN=${refreshToken}\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(`Saved GMAIL_REFRESH_TOKEN to ${envPath}`);
}

exchange().catch(console.error);
