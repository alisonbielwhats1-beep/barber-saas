import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { clientCookieIsSecure } from "./client-cookie";
import { encode, decode } from "next-auth/jwt";
import { supabaseAuthEnabled } from "./supabase-auth-config";
import { validateProviderSession, type ProviderSession } from "./supabase-auth";
import { withSalon } from "./prisma-tenant";

// Sem fallback: um segredo padrão público tornaria toda sessão de cliente forjável.
function requireSecret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET não definida — obrigatória para sessões de cliente.");
  return new TextEncoder().encode(s);
}
const SECRET = requireSecret();
const COOKIE = "client_token";
const MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export type ClientSession = {
  clientId: string;
  salonId: string;
  name: string;
  email: string;
  sessionVersion?: number;
  providerSession?: ProviderSession;
};

export async function signClientToken(payload: ClientSession): Promise<string> {
  if (supabaseAuthEnabled() && payload.providerSession) {
    return encode({ token: payload, secret: process.env.NEXTAUTH_SECRET!, maxAge: MAX_AGE });
  }
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(SECRET);
}

export async function verifyClientToken(token: string): Promise<ClientSession | null> {
  try {
    if (supabaseAuthEnabled() && token.split(".").length === 5) {
      const payload = await decode({ token, secret: process.env.NEXTAUTH_SECRET! });
      if (!payload || typeof payload.clientId !== "string" || typeof payload.salonId !== "string" ||
          typeof payload.name !== "string" || typeof payload.email !== "string" || !payload.providerSession) return null;
      const verified = await validateProviderSession(payload.providerSession as ProviderSession);
      if (!verified) return null;
      // Never return provider credentials to domain callers or Client Components.
      return { clientId: payload.clientId, salonId: payload.salonId, name: payload.name, email: payload.email,
        sessionVersion: payload.sessionVersion as number | undefined };
    }
    const { payload } = await jwtVerify(token, SECRET);
    if (
      typeof payload.clientId !== "string" ||
      typeof payload.salonId !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.email !== "string" ||
      (payload.sessionVersion !== undefined && typeof payload.sessionVersion !== "number")
    ) return null;
    if (supabaseAuthEnabled()) {
      const profile = await withSalon(payload.salonId, tx => tx.clientProfile.findFirst({
        where: { id: payload.clientId as string, salonId: payload.salonId as string, mergedIntoId: null },
        select: { authIdentityId: true, sessionVersion: true },
      }));
      if (!profile || profile.authIdentityId || profile.sessionVersion !== (payload.sessionVersion ?? 0)) return null;
    }
    return payload as unknown as ClientSession;
  } catch {
    return null;
  }
}

export async function getClientSession(): Promise<ClientSession | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return verifyClientToken(token);
}

export async function setClientSession(payload: ClientSession): Promise<void> {
  const token = await signClientToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: clientCookieIsSecure(),
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function clearClientSession(): Promise<void> {
  const cookieStore = await cookies();
  if (supabaseAuthEnabled()) {
    try {
      const payload = await decode({ token: cookieStore.get(COOKIE)?.value, secret: process.env.NEXTAUTH_SECRET! });
      if (payload?.providerSession) {
        const { createAuthClient } = await import("./supabase-auth");
        const client = createAuthClient();
        const { error } = await client.auth.setSession(payload.providerSession as ProviderSession);
        if (!error) await client.auth.signOut({ scope: "local" });
      }
    } catch { /* Local cookie removal still logs this browser out. */ }
  }
  cookieStore.delete(COOKIE);
}
