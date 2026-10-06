/** Configuration admission for the already audited Codespace, not a substitute
 * for the database/role/RLS preflight or authenticated tenant/user admission.
 * No arbitrary remote target, provider fallback or production credential aliases.
 */
export const SECRETARY_CODESPACE = 'glorious-enigma-jjv6v4rvrv49f544r';
export const SECRETARY_STAGING_TARGET = 'codespace-billing-20260925';

/** @param {Record<string, string | undefined>} env */
export function isSecretaryCodespaceTarget(env) {
  if (env.APP_ENV !== 'staging' || env.VERCEL_ENV === 'production' ||
      env.CODESPACE_NAME !== SECRETARY_CODESPACE ||
      env.SALON_SECRETARY_STAGING_TARGET !== SECRETARY_STAGING_TARGET) return false;
  const excluded = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN',
    'REDIS_URL', 'KV_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_AUTH_PUBLISHABLE_KEY', 'RESEND_API_KEY', 'OPENAI_API_KEY',
    'MERCADOPAGO_ACCESS_TOKEN', 'SECRETARY_FRONT_E2E_SCRIPT', 'AUTH_PROVIDER'];
  if (excluded.some(key => Boolean(env[key]?.trim()))) return false;
  if (['MERCADOPAGO_BILLING_ENABLED', 'MERCADOPAGO_HQ_SYNC_ENABLED',
    'PLATFORM_BILLING_ENABLED', 'EMAIL_INVITES_ENABLED',
    'PLATFORM_SIGNUP_NOTIFICATIONS_ENABLED', 'SALON_SECRETARY_JEV_ROUTER_ENABLED']
    .some(key => env[key] !== 'false')) return false;
  try {
    const database = new URL(env.DATABASE_URL ?? '');
    const direct = new URL(env.DIRECT_URL ?? '');
    if (database.href !== direct.href) return false;
    if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
        database.hostname !== '127.0.0.1' || database.port !== '5432' ||
        database.pathname !== '/everflair_billing_staging' ||
        database.username !== 'app_runtime' || !database.password ||
        database.search || database.hash) return false;
    const redis = new URL(env.UPSTASH_REDIS_REST_URL ?? '');
    if (redis.origin !== 'http://redis-http' || redis.pathname !== '/' ||
        redis.username || redis.password || redis.search || redis.hash ||
        !env.UPSTASH_REDIS_REST_TOKEN?.trim()) return false;
    const origin = new URL(env.NEXTAUTH_URL ?? '');
    return origin.href === `https://${SECRETARY_CODESPACE}-3001.app.github.dev/` &&
      env.NEXTAUTH_URL_INTERNAL === 'http://127.0.0.1:3001';
  } catch { return false; }
}

/** Microphone permission never grants operational confirmation or tenant access.
 * @param {Record<string, string | undefined>} env
 */
export function secretaryMicrophoneAllowed(env) {
  return env.SALON_SECRETARY_VOICE_ENABLED === 'true' && env.VERCEL_ENV !== 'production' &&
    (['development', 'test'].includes(env.APP_ENV ?? '') || isSecretaryCodespaceTarget(env));
}
