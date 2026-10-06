'use strict';

// Deployment-only adapter for the audited private Codespaces tunnel. This does
// not add allowedOrigins or bypass Next's CSRF/authentication/tenant checks.
const HOST = 'glorious-enigma-jjv6v4rvrv49f544r-3001.app.github.dev';
const PUBLIC_ORIGIN = `https://${HOST}`;
const LOCAL_ORIGINS = new Set(['http://localhost:3001', 'https://localhost:3001']);

function adaptCodespaceOrigin(request) {
  const headers = request.headers;
  if (!LOCAL_ORIGINS.has(headers.origin)) return 'UNCHANGED';
  // A browser cannot forge Sec-Fetch-Site. Reject missing/foreign metadata
  // instead of trusting the proxy's rewritten Origin on its own.
  let referer;
  try { referer = new URL(headers.referer); } catch { return 'REJECTED'; }
  if (headers.host !== 'localhost:3001' || headers['x-forwarded-host'] !== HOST ||
      headers['x-forwarded-proto'] !== 'https' || headers['sec-fetch-site'] !== 'same-origin' ||
      !['cors', 'navigate', 'same-origin'].includes(headers['sec-fetch-mode']) ||
      referer.origin !== PUBLIC_ORIGIN || referer.username || referer.password) return 'REJECTED';
  headers.origin = PUBLIC_ORIGIN;
  return 'NORMALIZED';
}

module.exports = { adaptCodespaceOrigin };
