import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET ?? "fallback-dev-secret");
const COOKIE = "client_token";
const MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export type ClientSession = {
  clientId: string;
  salonId: string;
  name: string;
  email: string;
};

export async function signClientToken(payload: ClientSession): Promise<string> {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(SECRET);
}

export async function verifyClientToken(token: string): Promise<ClientSession | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.clientId !== "string") return null;
    return payload as unknown as ClientSession;
  } catch {
    return null;
  }
}

export async function getClientSession(): Promise<ClientSession | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  return verifyClientToken(token);
}

export async function setClientSession(payload: ClientSession): Promise<void> {
  const token = await signClientToken(payload);
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export function clearClientSession(): void {
  cookies().delete(COOKIE);
}
