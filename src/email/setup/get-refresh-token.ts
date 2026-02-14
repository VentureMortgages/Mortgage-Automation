/**
 * One-time setup script: Get OAuth2 refresh token for Gmail API.
 *
 * Run with: npx tsx src/email/setup/get-refresh-token.ts
 *
 * This opens a browser for Google OAuth consent. Sign in as dev@venturemortgages.com,
 * authorize the app, and the script prints the refresh token for .env.
 */

import 'dotenv/config';
import { OAuth2Client } from 'google-auth-library';
import * as http from 'node:http';
import open from 'open';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333';
const SCOPES = ['https://www.googleapis.com/auth/gmail.compose'];

async function main(): Promise<void> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
    process.exit(1);
  }

  const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  // Start a temporary local server to catch the redirect
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:3333`);
      const authCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization failed</h1><p>You can close this tab.</p>');
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (authCode) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization successful!</h1><p>You can close this tab and go back to the terminal.</p>');
        server.close();
        resolve(authCode);
        return;
      }

      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing code parameter');
    });

    server.listen(3333, () => {
      console.log('Opening browser for Google OAuth consent...');
      console.log('Sign in as dev@venturemortgages.com and authorize the app.\n');
      open(authUrl).catch(() => {
        console.log('Could not open browser automatically. Open this URL manually:');
        console.log(authUrl);
      });
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for authorization'));
    }, 120_000);
  });

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error('ERROR: No refresh token returned.');
    console.error('This usually means consent was not forced. Try again or revoke access at https://myaccount.google.com/permissions');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Add the following to your .env file:');
  console.log('='.repeat(60));
  console.log('');
  console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
  console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('');
  console.log('='.repeat(60));
  console.log('Done! Gmail API is now authorized for dev@venturemortgages.com');
  console.log('='.repeat(60));
}

main().catch((err: unknown) => {
  console.error('Script failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
