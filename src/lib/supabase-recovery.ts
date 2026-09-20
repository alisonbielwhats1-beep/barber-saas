import "server-only";
import { cookies } from "next/headers";
import { encode, decode } from "next-auth/jwt";
import { createHash } from "node:crypto";
import { createAuthClient, providerSession, validateProviderSession, type ProviderSession } from "./supabase-auth";
import { recoveryRedirect, recoveryPath, isProviderTokenHash } from "./supabase-auth-config";
import { prisma } from "./prisma";
import { withSalonBySlug } from "./prisma-tenant";
import { clientCookieIsSecure } from "./client-cookie";

export const INVALID_RECOVERY = "Este link é inválido, expirou ou já foi utilizado. Solicite um novo e-mail.";
const COOKIE = "everflair_recovery";
type RecoverySession = ProviderSession & { context: string; tokenDigest: string };

function secret() {
  if (!process.env.NEXTAUTH_SECRET) throw new Error("AUTH_SECRET_MISSING");
  return process.env.NEXTAUTH_SECRET;
}

async function saveRecovery(session: RecoverySession) {
  const store = await cookies();
  const value = await encode({ token: session, secret: secret(), maxAge: 600 });
  store.set(COOKIE, value, { httpOnly: true, secure: clientCookieIsSecure(), sameSite: "strict", path: "/", maxAge: 600 });
}

async function readRecovery(salonSlug?: string): Promise<RecoverySession | null> {
  try {
    const raw = (await cookies()).get(COOKIE)?.value;
    const value = await decode({ token: raw, secret: secret() });
    if (!value || value.context !== recoveryPath(salonSlug) || typeof value.identityId !== "string" ||
        typeof value.version !== "number" || typeof value.tokenDigest !== "string" ||
        typeof value.access_token !== "string" || typeof value.refresh_token !== "string") return null;
    return value as RecoverySession;
  } catch { return null; }
}

export async function hasRecoverySession(salonSlug?: string) {
  const stored = await readRecovery(salonSlug);
  return !!stored && !!(await validateProviderSession(stored));
}

/** The provider response is never used to disclose whether an address has an account. */
export async function requestSupabaseRecovery(email: string, salonSlug?: string) {
  const client = createAuthClient();
  // No account lookup: known/unknown addresses take the same application path.
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: recoveryRedirect(salonSlug) });
  // Account-specific throttles and SMTP delivery failures must not enumerate users.
  if (error) console.warn("auth_recovery_request_failed", { category: "provider" });
}

export async function updateSupabasePassword(input: { token: string; password: string; salonSlug?: string }) {
  let stored = await readRecovery(input.salonSlug);
  if (stored && input.token && stored.tokenDigest !== recoveryRateKey(input.token)) stored = null;
  if (!stored) {
    if (!isProviderTokenHash(input.token)) return { ok: false, error: INVALID_RECOVERY } as const;
    const client = createAuthClient();
    const { data, error } = await client.auth.verifyOtp({ token_hash: input.token, type: "recovery" });
    if (error || !data.session) return { ok: false, error: INVALID_RECOVERY } as const;
    const session = await providerSession(data.session);
    stored = { ...session, context: recoveryPath(input.salonSlug), tokenDigest: recoveryRateKey(input.token) };
    // Save before updating: retry and refresh survive a transient updateUser failure.
    await saveRecovery(stored);
  }
  const validated = await validateProviderSession(stored);
  if (!validated) return { ok: false, error: INVALID_RECOVERY } as const;
  // Identity mapping, not email or user-editable metadata, grants access to the app.
  const permitted = input.salonSlug
    ? await withSalonBySlug(input.salonSlug, (tx, salonId) => tx.clientProfile.findFirst({
        where: { salonId, authIdentityId: stored!.identityId, mergedIntoId: null }, select: { id: true } }))
    : await prisma.user.findFirst({ where: { authIdentityId: stored.identityId }, select: { id: true } });
  if (!permitted) return { ok: false, error: INVALID_RECOVERY } as const;
  await saveRecovery({ ...validated.session, context: stored.context, tokenDigest: stored.tokenDigest });
  const client = createAuthClient();
  const { error: sessionError } = await client.auth.setSession(validated.session);
  if (sessionError) return { ok: false, error: INVALID_RECOVERY } as const;

  // Commit revocation before the external credential change. A database failure
  // must never leave old application sessions usable after a password update.
  const consumed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AuthIdentity" WHERE id = ${stored!.identityId}::uuid FOR UPDATE`;
    const current = await tx.authIdentity.findUnique({ where: { id: stored!.identityId } });
    if (!current || current.sessionVersion !== stored!.version) return false;
    await tx.authIdentity.update({ where: { id: current.id }, data: { sessionVersion: { increment: 1 } } });
    return true;
  });
  if (!consumed) return { ok: false, error: INVALID_RECOVERY } as const;
  const { error } = await client.auth.updateUser({ password: input.password });
  if (error) {
    // Only a definite provider refusal may resume. A transport exception fails
    // closed and requires a new recovery link because the outcome is uncertain.
    await saveRecovery({ ...validated.session, version: stored.version + 1, context: stored.context, tokenDigest: stored.tokenDigest });
    return { ok: false, error: error.status === 429
      ? "Muitas tentativas. Aguarde alguns minutos e tente novamente."
      : ["weak_password", "same_password"].includes(error.code ?? "")
        ? "Escolha uma senha diferente da atual, com pelo menos 10 caracteres, letras e números."
        : "Não foi possível atualizar a senha agora. Tente novamente." } as const;
  }
  (await cookies()).delete(COOKIE);
  await client.auth.signOut({ scope: "global" });
  return { ok: true } as const;
}

export function recoveryRateKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
