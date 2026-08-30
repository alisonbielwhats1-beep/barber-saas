import type { Prisma } from "@prisma/client";
import type { Tx } from "./prisma-tenant";
import { isValidPhoneBR, normalizePhone } from "./phone";

export type ClientIdentityInput = {
  phone?: string | null;
  email?: string | null;
};

export type NormalizedClientIdentity = {
  phone: string | null;
  phoneNormalized: string | null;
  email: string | null;
};

/**
 * Mantém a identidade do cliente consistente em todos os pontos de entrada.
 * O telefone normalizado é nacional, sem DDI 55, igual ao contrato público
 * existente. A função não decide se dois perfis devem ser unidos.
 */
export function normalizeClientIdentity(
  input: ClientIdentityInput,
): NormalizedClientIdentity {
  const rawPhone = input.phone?.trim() ?? "";
  const validPhone = rawPhone.length > 0 && isValidPhoneBR(rawPhone);
  const phone = validPhone ? normalizePhone(rawPhone) : rawPhone || null;
  const email = input.email?.trim().toLowerCase() || null;

  return {
    phone,
    phoneNormalized: validPhone ? phone : null,
    email,
  };
}

export function maskPhone(phone: string | null): string | null {
  const normalized = normalizeClientIdentity({ phone }).phoneNormalized;
  if (!normalized) return null;
  return `(${normalized.slice(0, 2)}) *****-${normalized.slice(-4)}`;
}

export function clientIdentityKeys(
  input: ClientIdentityInput & { phoneNormalized?: string | null },
): string[] {
  const identity = normalizeClientIdentity(input);
  const keys = new Set<string>();
  if (identity.email) keys.add(`email:${identity.email}`);
  const phone = input.phoneNormalized || identity.phoneNormalized;
  if (phone) keys.add(`phone:${phone}`);
  return [...keys];
}

export function clientIdentityData(
  input: ClientIdentityInput,
): Pick<NormalizedClientIdentity, "phone" | "phoneNormalized" | "email"> {
  return normalizeClientIdentity(input);
}

export type PotentialClientMatch = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  passwordHash: string | null;
  phoneNormalized: string | null;
  mergedIntoId: string | null;
  createdAt: Date;
};

/**
 * Busca candidatos dentro do tenant sem afirmar que são a mesma pessoa.
 * Telefone compartilhado, reciclado ou digitado incorretamente exige revisão
 * humana; por isso o resultado é sempre "possível correspondência".
 */
export async function findPotentialClientMatches(
  tx: Tx,
  salonId: string,
  input: ClientIdentityInput,
  excludeId?: string,
): Promise<PotentialClientMatch[]> {
  const identity = normalizeClientIdentity(input);
  const or: Prisma.ClientProfileWhereInput[] = [];

  if (identity.email) or.push({ email: { equals: identity.email, mode: "insensitive" } });
  if (identity.phoneNormalized) {
    or.push({ phoneNormalized: identity.phoneNormalized });
    // Compatibilidade com registros criados antes do backfill da migration.
    or.push({ phone: identity.phoneNormalized });
    or.push({ phone: `55${identity.phoneNormalized}` });
  }
  if (or.length === 0) return [];

  return tx.clientProfile.findMany({
    where: {
      salonId,
      mergedIntoId: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: or,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      passwordHash: true,
      phoneNormalized: true,
      mergedIntoId: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export function matchReasons(
  source: ClientIdentityInput & { phoneNormalized?: string | null },
  candidate: ClientIdentityInput & { phoneNormalized?: string | null },
): Array<"email" | "phone"> {
  const sourceIdentity = normalizeClientIdentity(source);
  const candidateIdentity = normalizeClientIdentity(candidate);
  const reasons: Array<"email" | "phone"> = [];
  if (sourceIdentity.email && sourceIdentity.email === candidateIdentity.email) reasons.push("email");
  const sourcePhone = source.phoneNormalized || sourceIdentity.phoneNormalized;
  const candidatePhone = candidate.phoneNormalized || candidateIdentity.phoneNormalized;
  if (sourcePhone && sourcePhone === candidatePhone) reasons.push("phone");
  return reasons;
}

export type ResolvedClientProfile = {
  id: string;
  name: string;
  email: string | null;
  sessionVersion: number;
};

export async function resolveClientProfile(
  tx: Tx,
  salonId: string,
  clientId: string,
): Promise<ResolvedClientProfile | null> {
  let currentId = clientId;
  for (let depth = 0; depth < 8; depth += 1) {
    const profile = await tx.clientProfile.findFirst({
      where: { id: currentId, salonId },
      select: { id: true, mergedIntoId: true, name: true, email: true, sessionVersion: true },
    });
    if (!profile) return null;
    if (!profile.mergedIntoId) {
      return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        sessionVersion: profile.sessionVersion,
      };
    }
    currentId = profile.mergedIntoId;
  }
  throw new Error("Cadeia de mesclagem de cliente excedeu o limite de segurança.");
}

export async function resolveClientProfileId(
  tx: Tx,
  salonId: string,
  clientId: string,
): Promise<string | null> {
  const profile = await resolveClientProfile(tx, salonId, clientId);
  return profile?.id ?? null;
}
