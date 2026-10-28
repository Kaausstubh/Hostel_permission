/**
 * Automated Local Receiver & Token Exchanger
 * Runs on port 5001 to catch Google OAuth callback automatically,
 * exchange the code, and write GMAIL_REFRESH_TOKEN to .env.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const port = 5001;
const redirectUri = `http://localhost:${port}/api/auth/gmail/callback`;
const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

if (!clientId || !clientSecret) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
  process.exit(1);
}

// Generate the fresh auth URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.send');
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');
authUrl.searchParams.set('state', 'heimdall_direct');

console.log('AUTH_URL_START');
console.log(authUrl.toString());
console.log('AUTH_URL_END');

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.query && parsed.query.code) {
    const code = parsed.query.code;
    console.log('\n[Received authorization code from Google, exchanging for refresh token...]');

    try {
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

      const tokenData = await tokenRes.json();

      if (!tokenRes.ok || tokenData.error) {
        console.error('Token exchange error:', tokenData);
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h2>Token Exchange Failed</h2><p>${tokenData.error_description || tokenData.error}</p>`);
        return;
      }

      const refreshToken = tokenData.refresh_token;
      const accessToken = tokenData.access_token;

      let senderEmail = 'sudarshan111102@gmail.com';
      try {
        const profRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (profRes.ok) {
          const profData = await profRes.json();
          senderEmail = profData.emailAddress;
        }
      } catch (_) {}

      // Save to backend/.env
      const envPath = path.resolve(__dirname, '../.env');
      let envContent = fs.readFileSync(envPath, 'utf8');

      if (envContent.includes('GMAIL_REFRESH_TOKEN=')) {
        envContent = envContent.replace(/GMAIL_REFRESH_TOKEN=.*(\r?\n|$)/, `GMAIL_REFRESH_TOKEN=${refreshToken}\n`);
      } else {
        envContent += `\nGMAIL_REFRESH_TOKEN=${refreshToken}\n`;
      }

      if (envContent.includes('GMAIL_SENDER_ADDRESS=')) {
        envContent = envContent.replace(/GMAIL_SENDER_ADDRESS=.*(\r?\n|$)/, `GMAIL_SENDER_ADDRESS=${senderEmail}\n`);
      } else {
        envContent += `\nGMAIL_SENDER_ADDRESS=${senderEmail}\n`;
      }

      fs.writeFileSync(envPath, envContent, 'utf8');

      console.log('TOKEN_SAVED_SUCCESS');
      console.log(`GMAIL_SENDER_ADDRESS=${senderEmail}`);
      console.log(`GMAIL_REFRESH_TOKEN=${refreshToken}`);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>HEIMDALL - Setup Complete</title></head>
        <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 50px;">
          <h1 style="color: #38bdf8;">🏛️ HEIMDALL</h1>
          <h2 style="color: #4ade80;">✅ Gmail API Authorization Successful!</h2>
          <p style="font-size: 16px;">The refresh token for <strong>${senderEmail}</strong> has been saved directly to your backend/.env file.</p>
          <p style="color: #94a3b8;">You can now close this tab.</p>
        </body>
        </html>
      `);

      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 1000);

    } catch (err) {
      console.error('Server error during exchange:', err);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h2>Error</h2><p>${err.message}</p>`);
    }
  } else if (parsed.query && parsed.query.error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h2>Authorization Denied</h2><p>${parsed.query.error}</p>`);
    console.error('Authorization denied by user:', parsed.query.error);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`LISTENER_READY on port ${port}`);
});
