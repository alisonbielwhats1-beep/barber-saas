import { describe, expect, it } from 'vitest';
import { isSecretaryCodespaceTarget, secretaryMicrophoneAllowed, SECRETARY_CODESPACE, SECRETARY_STAGING_TARGET } from '../secretary-staging-target.mjs';

const target = {
  APP_ENV: 'staging', CODESPACE_NAME: SECRETARY_CODESPACE,
  SALON_SECRETARY_STAGING_TARGET: SECRETARY_STAGING_TARGET,
  DATABASE_URL: 'postgresql://app_runtime:synthetic@127.0.0.1:5432/everflair_billing_staging',
  DIRECT_URL: 'postgresql://app_runtime:synthetic@127.0.0.1:5432/everflair_billing_staging',
  NEXTAUTH_URL: `https://${SECRETARY_CODESPACE}-3001.app.github.dev`,
  NEXTAUTH_URL_INTERNAL: 'http://127.0.0.1:3001',
  UPSTASH_REDIS_REST_URL: 'http://redis-http:80', UPSTASH_REDIS_REST_TOKEN: 'synthetic',
  MERCADOPAGO_BILLING_ENABLED: 'false', MERCADOPAGO_HQ_SYNC_ENABLED: 'false',
  PLATFORM_BILLING_ENABLED: 'false', EMAIL_INVITES_ENABLED: 'false',
  PLATFORM_SIGNUP_NOTIFICATIONS_ENABLED: 'false', SALON_SECRETARY_JEV_ROUTER_ENABLED: 'false',
};
describe('audited Codespace configuration admission (offline)', () => {
  it('accepts the exact isolated target, leaving rollout and DB checks separate', () => {
    expect(isSecretaryCodespaceTarget(target)).toBe(true);
    expect(secretaryMicrophoneAllowed(target)).toBe(false);
    expect(secretaryMicrophoneAllowed({ ...target, SALON_SECRETARY_VOICE_ENABLED: 'true' })).toBe(true);
  });
  it.each([
    ['APP_ENV', 'production'], ['VERCEL_ENV', 'production'], ['CODESPACE_NAME', 'other'],
    ['SALON_SECRETARY_STAGING_TARGET', ''], ['NEXTAUTH_URL', 'https://everflair.com.br'],
    ['NEXTAUTH_URL_INTERNAL', 'http://127.0.0.1:3000'],
    ['UPSTASH_REDIS_REST_URL', 'https://production.upstash.io'],
    ['UPSTASH_REDIS_REST_URL', 'http://redis-http:80/?redirect=remote'],
    ['UPSTASH_REDIS_REST_TOKEN', ''], ['KV_REST_API_URL', 'https://shared.invalid'],
    ['KV_REST_API_TOKEN', 'shared'], ['REDIS_URL', 'redis://shared.invalid'],
    ['KV_URL', 'redis://shared.invalid'], ['SUPABASE_URL', 'https://shared.supabase.co'],
    ['RESEND_API_KEY', 'external'], ['OPENAI_API_KEY', 'hq-key'],
    ['MERCADOPAGO_ACCESS_TOKEN', 'external'], ['AUTH_PROVIDER', 'supabase'],
    ['SECRETARY_FRONT_E2E_SCRIPT', 'mock.json'], ['MERCADOPAGO_BILLING_ENABLED', 'true'],
    ['SALON_SECRETARY_JEV_ROUTER_ENABLED', 'true'], ['EMAIL_INVITES_ENABLED', undefined],
  ])('fails closed before smoke for %s=%s', (key, value) => {
    const env = { ...target, [key]: value, SALON_SECRETARY_VOICE_ENABLED: 'true' };
    expect(isSecretaryCodespaceTarget(env)).toBe(false);
    expect(secretaryMicrophoneAllowed(env)).toBe(false);
  });
  it.each([
    'postgresql://app_runtime:synthetic@db.remote.invalid:5432/everflair_billing_staging',
    'postgresql://postgres:synthetic@127.0.0.1:5432/everflair_billing_staging',
    'postgresql://app_runtime:synthetic@127.0.0.1:5432/everflair_demo',
    'postgresql://app_runtime:synthetic@127.0.0.1:55441/everflair_billing_staging',
    'postgresql://app_runtime:synthetic@127.0.0.1:5432/everflair_billing_staging?host=remote',
    'https://app_runtime:synthetic@127.0.0.1:5432/everflair_billing_staging',
  ])('rejects substituted database targets in either connection: %s', url => {
    expect(isSecretaryCodespaceTarget({ ...target, DATABASE_URL: url })).toBe(false);
    expect(isSecretaryCodespaceTarget({ ...target, DIRECT_URL: url })).toBe(false);
    expect(isSecretaryCodespaceTarget({ ...target, DATABASE_URL: url, DIRECT_URL: url })).toBe(false);
  });
  it('preserves local microphone behavior and denies unknown/production environments', () => {
    for (const APP_ENV of ['test', 'development']) expect(secretaryMicrophoneAllowed({ APP_ENV, SALON_SECRETARY_VOICE_ENABLED: 'true' })).toBe(true);
    for (const APP_ENV of ['production', 'staging', '']) expect(secretaryMicrophoneAllowed({ APP_ENV, SALON_SECRETARY_VOICE_ENABLED: 'true' })).toBe(false);
  });
});
