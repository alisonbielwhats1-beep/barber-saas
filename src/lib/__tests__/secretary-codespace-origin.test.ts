import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { adaptCodespaceOrigin } = require('../../../scripts/secretary-codespace-origin.cjs');
const host = 'glorious-enigma-jjv6v4rvrv49f544r-3001.app.github.dev';
const headers = {
  host: 'localhost:3001', origin: 'https://localhost:3001',
  referer: `https://${host}/dashboard`, 'x-forwarded-host': host,
  'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
};

describe('private Codespaces origin adapter; offline transport only', () => {
  it.each(['http://localhost:3001', 'https://localhost:3001'])('restores observed same-origin proxy requests: %s', origin => {
    const request = { headers: { ...headers, origin } };
    expect(adaptCodespaceOrigin(request)).toBe('NORMALIZED');
    expect(request.headers.origin).toBe(`https://${host}`);
  });
  it.each([
    ['sec-fetch-site', 'cross-site'], ['sec-fetch-site', 'same-site'], ['sec-fetch-site', undefined],
    ['referer', 'https://foreign.invalid/'], ['referer', `https://${host}.foreign.invalid/`],
    ['referer', undefined], ['referer', `https://actor@${host}/`],
    ['host', 'localhost:3000'], ['x-forwarded-host', 'foreign.invalid'],
    ['x-forwarded-host', `${host}, foreign.invalid`], ['x-forwarded-host', undefined],
    ['x-forwarded-proto', 'http'], ['sec-fetch-mode', 'no-cors'],
  ])('rejects rewritten origin with untrusted %s', (key, value) => {
    const request = { headers: { ...headers, [key]: value } };
    expect(adaptCodespaceOrigin(request)).toBe('REJECTED');
    expect(request.headers.origin).toBe('https://localhost:3001');
  });
  it.each(['https://foreign.invalid', `https://${host}`, 'null', undefined])('preserves other origins for normal Next CSRF checks: %s', origin => {
    const request = { headers: { ...headers, origin } };
    expect(adaptCodespaceOrigin(request)).toBe('UNCHANGED');
    expect(request.headers.origin).toBe(origin);
  });
});
