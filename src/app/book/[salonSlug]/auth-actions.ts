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
import { clientIdentityData, findPotentialClientMatches } from "@/lib/client-identity";
import { inferGenderFromName } from "@/lib/name-gender";
import { writeAuditLog } from "@/lib/audit";
import { bcryptPasswordSchema } from "@/lib/password";

const salonSlugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const DUMMY_CLIENT_PASSWORD_HASH =
  "$2a$10$EpwUuprmRRoDuqmTMprHZO/QYoydyJx0wblP26vSqDEMK1BhV/K1K";

const passwordSchema = bcryptPasswordSchema(
  6,
  "A senha precisa ter pelo menos 6 caracteres.",
);

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
    confirmPassword: passwordSchema,
  })
  .strict()
  .refine((input) => input.password === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem.",
  });

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
        where: { salonId, email: normalizedEmail, mergedIntoId: null },
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

  // A experiência do cliente sempre recomeça na home do estabelecimento.
  // O retorno antigo continua validado acima apenas para compatibilidade com
  // formulários já abertos durante uma atualização.
  void validatedReturnTo;
  redirect(`/book/${normalizedSlug}`);
}

export async function registerClient(
  salonSlug: string,
  data: {
    name: string;
    phone: string;
    email: string;
    password: string;
    confirmPassword?: string;
  },
  returnTo?: string | null,
): Promise<{ error: string }> {
  const parsedSlug = salonSlugSchema.safeParse(salonSlug);
  if (!parsedSlug.success) return { error: REGISTRATION_ERROR };
  const normalizedSlug = parsedSlug.data;

  const parsed = registrationSchema.safeParse(data);
  if (!parsed.success) {
    const mismatch = parsed.error.issues.find(
      (issue) =>
        issue.path[0] === "confirmPassword" &&
        issue.message === "As senhas não coincidem.",
    );
    return { error: mismatch?.message ?? REGISTRATION_ERROR };
  }
  const registration = parsed.data;
  const identity = clientIdentityData(registration);

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
      const matches = await findPotentialClientMatches(tx, salonId, identity);
      const emailMatch = matches.find((candidate) => candidate.email?.toLowerCase() === identity.email);
      if (emailMatch?.passwordHash) {
        throw new Error("CLIENT_ACCOUNT_EXISTS");
      }
      if (emailMatch) {
        throw new Error("CLIENT_EMAIL_ALREADY_USED_BY_GUEST");
      }
      const client = await tx.clientProfile.create({
        data: {
          salonId,
          name: registration.name,
          phone: identity.phone,
          phoneNormalized: identity.phoneNormalized,
          email: identity.email,
          passwordHash,
          gender: inferGenderFromName(registration.name),
        },
        select: { id: true },
      });
      if (matches.length > 0) {
        await writeAuditLog(tx, {
          salonId,
          userId: null,
          actorName: registration.name,
          action: "CLIENT_POSSIBLE_DUPLICATE",
          entityType: "ClientProfile",
          entityId: client.id,
          reason: "Cadastro público com correspondência de telefone; revisão humana necessária",
          metadata: {
            candidateIds: matches.map((candidate) => candidate.id),
            candidateNames: matches.map((candidate) => candidate.name),
          },
        });
      }
      return { clientId: client.id, salonId };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CLIENT_ACCOUNT_EXISTS") {
      return { error: "Este e-mail já possui uma conta. Entre com ela ou fale com o suporte do estabelecimento." };
    }
    if (error instanceof Error && error.message === "CLIENT_EMAIL_ALREADY_USED_BY_GUEST") {
      return { error: "Este e-mail já está em uma reserva sem conta. Peça ao salão para vincular seu histórico com segurança." };
    }
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

  void returnTo;
  redirect(`/book/${normalizedSlug}`);
}

export async function logoutClient(salonSlug: string): Promise<void> {
  await clearClientSession();
  redirect(`/book/${salonSlug}`);
}
