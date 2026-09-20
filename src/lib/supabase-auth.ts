import "server-only";
import { createClient, type Session } from "@supabase/supabase-js";
import { prisma } from "./prisma";
import { authConfig } from "./supabase-auth-config";

export type ProviderSession = {
  access_token: string;
  refresh_token: string;
  identityId: string;
  version: number;
  expires_at?: number;
};

/** Request-local client. Never share a user's Auth session through a singleton. */
export function createAuthClient() {
  const { url, key } = authConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000), cache: "no-store" }) },
  });
}

export async function providerSession(session: Session): Promise<ProviderSession> {
  const identity = await prisma.authIdentity.findUnique({ where: { id: session.user.id } });
  if (!identity) throw new Error("AUTH_IDENTITY_NOT_MIGRATED");
  return { access_token: session.access_token, refresh_token: session.refresh_token,
    identityId: identity.id, version: identity.sessionVersion, expires_at: session.expires_at };
}

export async function authenticatePassword(email: string, password: string) {
  const client = createAuthClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user?.email_confirmed_at) return null;
  const session = await providerSession(data.session);
  return { user: data.user, session };
}

/** getUser verifies with Auth; the identity version also revokes still-live access JWTs. */
export async function validateProviderSession(stored: ProviderSession) {
  try {
    const identity = await prisma.authIdentity.findUnique({ where: { id: stored.identityId } });
    if (!identity || identity.sessionVersion !== stored.version) return null;
    const client = createAuthClient();
    // Middleware renews application cookies before reads. Never rotate a refresh
    // token in a Server Component, where the replacement cookie cannot be saved.
    const verified = await client.auth.getUser(stored.access_token);
    if (verified.error || verified.data.user.id !== identity.id || !verified.data.user.email_confirmed_at) return null;
    return { user: verified.data.user, session: stored };
  } catch { return null; }
}

/** Existing Auth accounts require their password; signUp never overwrites credentials. */
export async function registerProviderAccount(email: string, password: string, redirectTo: string) {
  const client = createAuthClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (!signedIn.error && signedIn.data.session && signedIn.data.user.email_confirmed_at) {
    await prisma.authIdentity.upsert({ where: { id: signedIn.data.user.id },
      create: { id: signedIn.data.user.id }, update: {} });
    return { identityId: signedIn.data.user.id, confirmationRequired: false };
  }
  const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
  // Supabase can return an obfuscated user for an existing address. Never bind that ID.
  if (error || !data.user || !data.user.identities?.length) throw new Error("AUTH_REGISTRATION_FAILED");
  await prisma.authIdentity.upsert({ where: { id: data.user.id }, create: { id: data.user.id }, update: {} });
  return { identityId: data.user.id, confirmationRequired: !data.session };
}
