"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  isApprovedSalonSlug,
  withSalonBySlug,
} from "@/lib/prisma-tenant";
import { isValidPhoneBR, normalizePhone } from "@/lib/phone";
import { setClientSession, clearClientSession } from "@/lib/client-auth";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const salonSlugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const CLIENT_RETURN_PATHS = new Set([
  "agendar",
  "minhas",
  "notificacoes",
  "produtos",
]);

/** Normaliza e limita o retorno a telas conhecidas do próprio salão. */
function safeReturnTo(salonSlug: string, returnTo?: string | null): string {
  const fallback = `/book/${salonSlug}/minhas`;
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(returnTo, "https://salon.invalid");
    const prefix = `/book/${salonSlug}/`;
    if (!parsed.pathname.startsWith(prefix)) return fallback;

    const page = parsed.pathname.slice(prefix.length);
    if (!CLIENT_RETURN_PATHS.has(page)) return fallback;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}

const DUMMY_CLIENT_PASSWORD_HASH =
  "$2a$10$EpwUuprmRRoDuqmTMprHZO/QYoydyJx0wblP26vSqDEMK1BhV/K1K";

function passwordBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

const passwordSchema = z
  .string()
  .min(6)
  .max(72)
  .refine((value) => passwordBytes(value) <= 72);

const loginSchema = z
  .object({
    salonSlug: salonSlugSchema,
    email: z.string().trim().toLowerCase().email().max(254),
    // bcrypt considera no máximo 72 bytes. Validar antes do limiter evita
    // chaves enormes e garante que nenhum payload inválido chegue ao lookup.
    password: passwordSchema,
    returnTo: z.string().max(2_048).optional().nullable(),
  })
  .strict();

const registrationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z
      .string()
      .trim()
      .max(32)
      .refine((value) => value.length === 0 || isValidPhoneBR(value))
      .transform((value) => value.length === 0 ? null : normalizePhone(value)),
    email: z.string().trim().toLowerCase().email().max(254),
    // bcrypt ignora silenciosamente bytes depois do 72º; rejeitamos em vez
    // de aceitar duas senhas visivelmente diferentes como equivalentes.
    password: passwordSchema,
  })
  .strict();

const REGISTRATION_ERROR =
  "Não foi possível criar a conta com os dados informados.";

type RegistrationResult =
  | { clientId: string; salonId: string }
  | null;

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function loginClient(
  salonSlug: string,
  email: string,
  password: string,
  returnTo?: string | null,
): Promise<{ error: string }> {
  const parsed = loginSchema.safeParse({
    salonSlug,
    email,
    password,
    returnTo,
  });
  if (!parsed.success) return { error: "E-mail ou senha incorretos" };
  const {
    salonSlug: normalizedSlug,
    email: normalizedEmail,
    password: validatedPassword,
    returnTo: validatedReturnTo,
  } = parsed.data;
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const [globalIpLimit, salonIpLimit, accountLimit] = await Promise.all([
    checkRateLimit({
      namespace: "client-login-global-ip",
      identifier: ip,
      limit: 30,
      windowSeconds: 15 * 60,
      failClosed: true,
    }),
    checkRateLimit({
      namespace: "client-login-ip",
      identifier: `${ip}:${normalizedSlug}`,
      limit: 30,
      windowSeconds: 15 * 60,
      failClosed: true,
    }),
    checkRateLimit({
      namespace: "client-login-account",
      identifier: `${normalizedSlug}:${normalizedEmail}`,
      limit: 8,
      windowSeconds: 15 * 60,
      failClosed: true,
    }),
  ]);
  if (!globalIpLimit.allowed || !salonIpLimit.allowed || !accountLimit.allowed) {
    if (
      globalIpLimit.source === "unavailable" ||
      salonIpLimit.source === "unavailable" ||
      accountLimit.source === "unavailable"
    ) {
      return { error: "Serviço de segurança temporariamente indisponível." };
    }
    return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }

  let found: { salonId: string; client: {
    id: string;
    name: string;
    email: string | null;
    passwordHash: string | null;
  } | null } | null;
  try {
    found = await withSalonBySlug(normalizedSlug, (tx, salonId) =>
      tx.clientProfile.findFirst({
        where: { salonId, email: normalizedEmail },
        select: { id: true, name: true, email: true, passwordHash: true },
      }).then((client) => ({ salonId, client })),
    );
  } catch {
    return { error: "Não foi possível entrar agora. Tente novamente." };
  }
  if (!found) {
    await bcrypt.compare(validatedPassword, DUMMY_CLIENT_PASSWORD_HASH);
    return { error: "Salão não encontrado" };
  }
  const { salonId, client } = found;

  const valid = await bcrypt.compare(
    validatedPassword,
    client?.passwordHash ?? DUMMY_CLIENT_PASSWORD_HASH,
  );
  if (!client?.passwordHash || !valid) {
    return { error: "E-mail ou senha incorretos" };
  }

  await setClientSession({
    clientId: client.id,
    salonId,
    name: client.name,
    email: client.email!,
  });

  redirect(safeReturnTo(normalizedSlug, validatedReturnTo));
}

export async function registerClient(
  salonSlug: string,
  data: { name: string; phone: string; email: string; password: string },
  returnTo?: string | null,
): Promise<{ error: string }> {
  const parsedSlug = salonSlugSchema.safeParse(salonSlug);
  if (!parsedSlug.success) return { error: REGISTRATION_ERROR };
  const normalizedSlug = parsedSlug.data;

  const parsed = registrationSchema.safeParse(data);
  if (!parsed.success) return { error: REGISTRATION_ERROR };
  const registration = parsed.data;

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const [globalLimit, salonLimit] = await Promise.all([
    checkRateLimit({
      namespace: "client-register-global",
      identifier: ip,
      limit: 20,
      windowSeconds: 60 * 60,
      failClosed: true,
    }),
    checkRateLimit({
      namespace: "client-register",
      identifier: `${ip}:${normalizedSlug}`,
      limit: 5,
      windowSeconds: 60 * 60,
      failClosed: true,
    }),
  ]);
  if (!globalLimit.allowed || !salonLimit.allowed) {
    if (
      globalLimit.source === "unavailable" ||
      salonLimit.source === "unavailable"
    ) {
      return { error: "Serviço de segurança temporariamente indisponível." };
    }
    return { error: "Muitas tentativas. Aguarde antes de criar outra conta." };
  }

  // Evita bcrypt para um tenant inexistente/inativo. O helper transacional
  // abaixo revalida e bloqueia a linha antes de qualquer INSERT.
  try {
    if (!(await isApprovedSalonSlug(normalizedSlug))) {
      return { error: "Salão não encontrado" };
    }
  } catch {
    return { error: "Não foi possível criar a conta agora. Tente novamente." };
  }

  // Hash fora da transação: bcrypt é CPU-bound e não depende de nada lido do
  // banco — não faz sentido segurar a conexão presa nesse tempo.
  const passwordHash = await bcrypt.hash(registration.password, 10);

  let result: RegistrationResult;
  try {
    result = await withSalonBySlug(normalizedSlug, async (tx, salonId) => {
      const client = await tx.clientProfile.create({
        data: {
          salonId,
          name: registration.name,
          phone: registration.phone,
          email: registration.email,
          passwordHash,
        },
        select: { id: true },
      });
      return { clientId: client.id, salonId };
    });
  } catch (error) {
    if (isUniqueConflict(error)) return { error: REGISTRATION_ERROR };
    return { error: "Não foi possível criar a conta agora. Tente novamente." };
  }
  if (!result) return { error: "Salão não encontrado" };

  await setClientSession({
    clientId: result.clientId,
    salonId: result.salonId,
    name: registration.name,
    email: registration.email,
  });

  redirect(safeReturnTo(normalizedSlug, returnTo));
}

export async function logoutClient(salonSlug: string): Promise<void> {
  await clearClientSession();
  redirect(`/book/${salonSlug}`);
}
