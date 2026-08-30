"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { clearClientSession } from "@/lib/client-auth";
import { bcryptPasswordSchema } from "@/lib/password";
import {
  consumeAdminPasswordReset,
  consumeClientPasswordReset,
  hashPasswordResetToken,
  issueAdminPasswordReset,
  issueClientPasswordReset,
} from "@/lib/password-recovery";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const GENERIC_REQUEST_MESSAGE =
  "Se existir uma conta com este e-mail, você receberá um link válido por 1 hora.";
const INVALID_LINK_MESSAGE =
  "Este link é inválido, expirou ou já foi utilizado. Solicite um novo e-mail.";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const salonSlugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const tokenSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]+$/);
const passwordSchema = bcryptPasswordSchema(
  6,
  "A senha precisa ter pelo menos 6 caracteres.",
);

type RequestResult = { ok: true; message: string };
type ResetResult = { ok: true } | { ok: false; error: string };

async function waitForUniformResponse(startedAt: number): Promise<void> {
  const remaining = 800 - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

async function requestAllowed(namespace: string, account: string): Promise<boolean> {
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const [ipLimit, accountLimit] = await Promise.all([
    checkRateLimit({
      namespace: `${namespace}-ip`,
      identifier: ip,
      limit: 5,
      windowSeconds: 60 * 60,
      failClosed: true,
    }),
    checkRateLimit({
      namespace: `${namespace}-account`,
      identifier: account,
      limit: 3,
      windowSeconds: 60 * 60,
      failClosed: true,
    }),
  ]);
  return ipLimit.allowed && accountLimit.allowed;
}

export async function requestAdminPasswordReset(email: string): Promise<RequestResult> {
  const startedAt = Date.now();
  const parsed = emailSchema.safeParse(email);
  try {
    if (parsed.success && await requestAllowed("admin-password-reset", parsed.data)) {
      await issueAdminPasswordReset({ email: parsed.data });
    }
  } catch {
    // A resposta permanece genérica: conta e estado do provedor não são enumeráveis.
  }
  await waitForUniformResponse(startedAt);
  return { ok: true, message: GENERIC_REQUEST_MESSAGE };
}

export async function requestClientPasswordReset(
  salonSlug: string,
  email: string,
): Promise<RequestResult> {
  const startedAt = Date.now();
  const parsed = z.object({ salonSlug: salonSlugSchema, email: emailSchema }).safeParse({
    salonSlug,
    email,
  });
  try {
    if (
      parsed.success &&
      await requestAllowed(
        "client-password-reset",
        `${parsed.data.salonSlug}:${parsed.data.email}`,
      )
    ) {
      await issueClientPasswordReset(parsed.data);
    }
  } catch {
    // Falhas internas não revelam se o salão ou o e-mail existem.
  }
  await waitForUniformResponse(startedAt);
  return { ok: true, message: GENERIC_REQUEST_MESSAGE };
}

async function resetAllowed(namespace: string, token: string): Promise<boolean> {
  const requestHeaders = await headers();
  const [ipLimit, tokenLimit] = await Promise.all([
    checkRateLimit({
      namespace: `${namespace}-ip`,
      identifier: clientIp(requestHeaders),
      limit: 20,
      windowSeconds: 60 * 60,
      failClosed: true,
    }),
    checkRateLimit({
      namespace: `${namespace}-token`,
      identifier: hashPasswordResetToken(token),
      limit: 8,
      windowSeconds: 60 * 60,
      failClosed: true,
    }),
  ]);
  return ipLimit.allowed && tokenLimit.allowed;
}

function parseResetInput(input: {
  token: string;
  password: string;
  confirmPassword: string;
}) {
  return z
    .object({
      token: tokenSchema,
      password: passwordSchema,
      confirmPassword: passwordSchema,
    })
    .refine((value) => value.password === value.confirmPassword, {
      path: ["confirmPassword"],
      message: "As senhas não coincidem.",
    })
    .safeParse(input);
}

export async function resetAdminPassword(input: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<ResetResult> {
  const parsed = parseResetInput(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_LINK_MESSAGE };
  }
  if (!(await resetAllowed("admin-password-reset-consume", parsed.data.token))) {
    return { ok: false, error: "Muitas tentativas. Aguarde e solicite um novo link." };
  }
  try {
    const consumed = await consumeAdminPasswordReset(parsed.data);
    return consumed ? { ok: true } : { ok: false, error: INVALID_LINK_MESSAGE };
  } catch {
    return { ok: false, error: "Não foi possível alterar a senha agora. Tente novamente." };
  }
}

export async function resetClientPassword(
  salonSlug: string,
  input: { token: string; password: string; confirmPassword: string },
): Promise<ResetResult> {
  const parsedSlug = salonSlugSchema.safeParse(salonSlug);
  const parsed = parseResetInput(input);
  if (!parsedSlug.success || !parsed.success) {
    return {
      ok: false,
      error: parsed.success
        ? INVALID_LINK_MESSAGE
        : parsed.error.issues[0]?.message ?? INVALID_LINK_MESSAGE,
    };
  }
  if (!(await resetAllowed("client-password-reset-consume", parsed.data.token))) {
    return { ok: false, error: "Muitas tentativas. Aguarde e solicite um novo link." };
  }
  try {
    const consumed = await consumeClientPasswordReset({
      salonSlug: parsedSlug.data,
      token: parsed.data.token,
      password: parsed.data.password,
    });
    if (!consumed) return { ok: false, error: INVALID_LINK_MESSAGE };
    await clearClientSession();
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível alterar a senha agora. Tente novamente." };
  }
}
