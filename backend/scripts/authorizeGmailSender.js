/**
 * HEIMDALL — Gmail API Sender Account Authorization Tool
 *
 * This interactive CLI utility performs the one-time OAuth2 authorization flow
 * for the designated HEIMDALL sender Gmail account.
 *
 * Usage:
 *   node scripts/authorizeGmailSender.js
 *   OR with a specific redirect URI already registered in Google Console:
 *   node scripts/authorizeGmailSender.js --redirect http://localhost:5001/api/auth/google/callback
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const http = require('http');
const url = require('url');
const readline = require('readline');

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// Helper to parse CLI arguments
const getCliArg = (flag) => {
  const index = process.argv.indexOf(flag);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

async function main() {
  console.log('\n================================================================');
  console.log('   HEIMDALL — GMAIL API DESIGNATED SENDER AUTHORIZATION TOOL    ');
  console.log('================================================================\n');

  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

  if (!clientId || !clientSecret) {
    console.error('❌ ERROR: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in backend/.env!');
    console.error('Please configure your Google Cloud OAuth credentials before running this tool.\n');
    process.exit(1);
  }

  const cliRedirect = getCliArg('--redirect') || getCliArg('-r');
  const port = parseInt(process.env.AUTH_PORT || '5001', 10);

  // If user provided a specific redirect URI via CLI or env, use it; otherwise default
  let redirectUri = cliRedirect || process.env.GMAIL_REDIRECT_URI || `http://localhost:${port}/api/auth/gmail/callback`;

  console.log('OAuth Credentials:');
  console.log(`- Client ID:    ${clientId.slice(0, 18)}...${clientId.slice(-10)}`);
  console.log(`- Target Scope: ${SCOPE} (Minimal sending permission)`);
  console.log(`- Redirect URI: ${redirectUri}\n`);

  console.log('────────────────────────────────────────────────────────────────');
  console.log('💡 NOTE ON ERROR 400: redirect_uri_mismatch');
  console.log('Google requires the redirect URI to EXACTLY match one of the URIs');
  console.log('listed in Google Cloud Console -> APIs & Services -> Credentials ->');
  console.log('OAuth 2.0 Client IDs -> "Authorized redirect URIs".\n');
  console.log('If you have not added http://localhost:5001/api/auth/gmail/callback yet:');
  console.log('1. Go to: https://console.cloud.google.com/apis/credentials?project=heimdall-511804');
  console.log('2. Click your OAuth 2.0 Client ID.');
  console.log('3. Under "Authorized redirect URIs", add:');
  console.log(`   ${redirectUri}`);
  console.log('   (OR use an existing URI like http://localhost:5001/api/auth/google/callback)');
  console.log('4. Click SAVE.\n');
  console.log('────────────────────────────────────────────────────────────────\n');

  // Build the Google OAuth 2.0 authorization URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline'); // CRITICAL: required to receive refresh_token
  authUrl.searchParams.set('prompt', 'consent');      // CRITICAL: ensures refresh_token is re-issued
  authUrl.searchParams.set('state', 'heimdall_sender_setup');

  console.log('👉 STEP 1: Open this link in your browser:');
  console.log(authUrl.toString());
  console.log('\n👉 STEP 2: Sign in with the DESIGNATED HEIMDALL SENDER GMAIL ACCOUNT.');
  console.log('   Click "Continue" and "Allow" when prompted.\n');

  let server;
  let codeResolved = false;

  const exchangeCodeForTokens = async (code, usedRedirectUri) => {
    console.log('\n[Exchanging authorization code for tokens with Google...]');

    const tokenParams = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: usedRedirectUri || redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      console.error('\n❌ Token exchange failed:');
      console.error(tokenData.error_description || tokenData.error || tokenRes.statusText);
      return null;
    }

    const refreshToken = tokenData.refresh_token;
    const accessToken = tokenData.access_token;

    if (!refreshToken) {
      console.warn('\n⚠️  WARNING: Google did not return a refresh token.');
      console.warn('   This happens if authorization was already granted previously.');
      console.warn('   To fix: visit https://myaccount.google.com/permissions, revoke access for Heimdall, and run this script again.\n');
      return null;
    }

    let senderEmail = 'Unknown';
    try {
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        senderEmail = profileData.emailAddress;
      }
    } catch (_) {}

    console.log('\n================================================================');
    console.log('🎉 GMAIL API AUTHORIZATION SUCCESSFUL!');
    console.log('================================================================\n');
    console.log(`✅ Sender Account:   ${senderEmail}`);
    console.log(`✅ Refresh Token:    ${refreshToken}\n`);
    console.log('Copy and paste the following into your backend/.env and Render environment variables:\n');
    console.log(`GMAIL_SENDER_ADDRESS=${senderEmail}`);
    console.log(`GMAIL_REFRESH_TOKEN=${refreshToken}`);
    console.log('GMAIL_SENDER_NAME="HEIMDALL Hostel Management"\n');
    console.log('================================================================\n');

    return { senderEmail, refreshToken };
  };

  try {
    server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);

      // Match ANY path that receives the Google OAuth code callback
      if (parsedUrl.query && (parsedUrl.query.code || parsedUrl.query.error)) {
        const { code, error } = parsedUrl.query;

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authorization Failed</h1><p>${error}</p>`);
          console.error(`\n❌ Authorization was rejected: ${error}`);
          return;
        }

        if (code) {
          codeResolved = true;
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>HEIMDALL - Authorization Successful</title></head>
              <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 40px;">
                <h1 style="color: #38bdf8;">🏛️ HEIMDALL</h1>
                <h2>Gmail Sender Authorization Received!</h2>
                <p style="color: #4ade80; font-size: 18px;">You can now close this tab and return to your terminal.</p>
              </body>
            </html>
          `);

          const result = await exchangeCodeForTokens(code, redirectUri);
          server.close();
          if (rl) rl.close();
          process.exit(result ? 0 : 1);
        }
      }
    });

    server.listen(port, () => {
      console.log(`🎧 Listening locally on port ${port} for automatic callback...`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`⚠️  Port ${port} is currently in use.`);
        console.warn('   No problem: after Google redirects, paste the redirected URL or code below:\n');
      }
    });
  } catch (srvErr) {
    console.warn('Note: Could not start local HTTP listener. Manual code paste is ready.');
  }

  // CLI manual paste fallback
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Paste the redirected URL (or authorization "code" parameter) here once you approve:\n> ', async (input) => {
    if (codeResolved) return;

    let code = input.trim();
    if (code.includes('code=')) {
      const match = code.match(/code=([^&]+)/);
      if (match) code = decodeURIComponent(match[1]);
    }

    if (!code) {
      console.error('❌ No authorization code provided.');
      if (server) server.close();
      rl.close();
      process.exit(1);
    }

    const result = await exchangeCodeForTokens(code, redirectUri);
    if (server) server.close();
    rl.close();
    process.exit(result ? 0 : 1);
  });
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
