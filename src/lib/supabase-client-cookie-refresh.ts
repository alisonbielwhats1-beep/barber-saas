import { createClient } from "@supabase/supabase-js";
import { decode, encode, getToken, type JWT } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "./supabase-auth-config";
import { clientCookieIsSecure } from "./client-cookie";
import type { ProviderSession } from "./supabase-auth";

/** Refresh provider tokens where cookies are writable, before Server Components read them. */
export async function refreshClientCookie(request: NextRequest, owner = false,
  next: (request: NextRequest) => Promise<Response | null | undefined | void> = async refreshed => NextResponse.next({ request: { headers: refreshed.headers } })) {
  const secure = process.env.NEXTAUTH_URL?.startsWith("https:") ?? false;
  const cookieName = owner ? (secure ? "__Secure-next-auth.session-token" : "next-auth.session-token") : "client_token";
  const changes: Array<{ name: string; value: string; maxAge: number }> = [];
  try {
    const secret = process.env.NEXTAUTH_SECRET!;
    const payload: JWT | null = owner ? await getToken({ req: request, secret, secureCookie: secure })
      : await decode({ token: request.cookies.get(cookieName)?.value, secret });
    const stored = payload?.providerSession as ProviderSession | undefined;
    if (payload && stored && (!stored.expires_at || stored.expires_at < Date.now() / 1000 + 30)) {
      const { url, key } = authConfig();
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000), cache: "no-store" }) } });
      const { data, error } = await client.auth.refreshSession(stored);
      if (!error && data.session) {
        payload.providerSession = { ...stored, access_token: data.session.access_token,
          refresh_token: data.session.refresh_token, expires_at: data.session.expires_at };
        const encoded = await encode({ token: payload, secret, maxAge: 30 * 86400 });
        const chunks = Math.ceil(encoded.length / 3500);
        if (!owner && chunks > 1) throw new Error("CLIENT_SESSION_TOO_LARGE");
        for (const cookie of request.cookies.getAll()) {
          if (cookie.name === cookieName || cookie.name.startsWith(`${cookieName}.`)) {
            request.cookies.delete(cookie.name); changes.push({ name: cookie.name, value: "", maxAge: 0 });
          }
        }
        // NextAuth supports chunked cookies. The client envelope stays deliberately small.
        for (let index = 0; index < chunks; index++) {
          const name = owner && chunks > 1 ? `${cookieName}.${index}` : cookieName;
          const value = encoded.slice(index * 3500, (index + 1) * 3500);
          request.cookies.set(name, value); changes.push({ name, value, maxAge: 30 * 86400 });
        }
      }
    }
  } catch { /* Domain/session guards still fail closed. */ }
  const response = await next(request) ?? NextResponse.next({ request: { headers: request.headers } });
  for (const change of new Map(changes.map(change => [change.name, change])).values()) {
    // Preserve authMiddleware redirects and its headers.
    const cookies = new NextResponse().cookies;
    cookies.set(change.name, change.value, { httpOnly: true, secure: owner ? secure : clientCookieIsSecure(), sameSite: "lax", path: "/", maxAge: change.maxAge });
    response.headers.append("Set-Cookie", cookies.toString());
  }
  if (changes.length) response.headers.set("Cache-Control", "private, no-store");
  return response;
}
