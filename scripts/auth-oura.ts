#!/usr/bin/env node
/**
 * One-time OAuth2 authentication for Oura API.
 *
 * Opens the browser to authorize, captures the callback,
 * exchanges code for tokens, and saves them encrypted.
 *
 * Usage: npm run auth:oura
 */

import 'dotenv/config';
import * as http from 'node:http';
import * as path from 'node:path';
import { OuraAuth, FileTokenStorage } from '../src/index.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const TOKEN_DIR = path.join(DATA_DIR, 'tokens');
const USER_ID = 'default-user';

async function main() {
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  const redirectUri = process.env.OURA_REDIRECT_URI;
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) {
    console.error('Missing required environment variables in .env:');
    console.error('  OURA_CLIENT_ID, OURA_CLIENT_SECRET, OURA_REDIRECT_URI, ENCRYPTION_KEY');
    process.exit(1);
  }

  const auth = new OuraAuth({ clientId, clientSecret, redirectUri });
  const tokenStorage = new FileTokenStorage(TOKEN_DIR, encryptionKey);

  // Check if tokens already exist
  const existing = await tokenStorage.exists(USER_ID);
  if (existing) {
    console.log('Tokens already exist. Delete data/tokens/default-user.token to re-authenticate.');
    process.exit(0);
  }

  // Parse port from redirect URI
  const redirectUrl = new URL(redirectUri);
  const port = parseInt(redirectUrl.port, 10) || 3000;
  const callbackPath = redirectUrl.pathname;

  // Generate auth URL
  const authUrl = auth.generateAuthUrl();

  console.log('\nOpen this URL in your browser to authorize:\n');
  console.log(authUrl);
  console.log('\nWaiting for callback...\n');

  // Try to open browser automatically
  try {
    const open = await import('open');
    await open.default(authUrl);
  } catch {
    // open package not installed - user can click the link manually
  }

  // Start local server to capture callback
  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${port}`);

      if (url.pathname !== callbackPath) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400);
        res.end(`Authorization failed: ${error}`);
        server.close();
        reject(new Error(`Authorization failed: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('No authorization code received');
        server.close();
        reject(new Error('No authorization code received'));
        return;
      }

      try {
        console.log('Authorization code received. Exchanging for tokens...');
        const tokens = await auth.exchangeCodeForToken(code);
        await tokenStorage.save(USER_ID, tokens);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Success!</h1><p>You can close this tab. Tokens have been saved.</p>');

        console.log('Tokens saved successfully!');
        console.log(`Stored at: ${TOKEN_DIR}/default-user.token`);
        server.close();
        resolve();
      } catch (err) {
        res.writeHead(500);
        res.end('Failed to exchange authorization code');
        server.close();
        reject(err);
      }
    });

    server.listen(port, () => {
      console.log(`Callback server listening on port ${port}`);
    });
  });
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
