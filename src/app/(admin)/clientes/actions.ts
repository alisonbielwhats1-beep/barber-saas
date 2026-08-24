"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getClientHistory } from "@/lib/crm";
import { serializeClientCareProfile } from "@/lib/client-care-profile";
import { writeAuditLog } from "@/lib/audit";
import { calculateLoyaltyBalance, parseClientCsv } from "@/lib/operational-flows";
import { isValidPhoneBR } from "@/lib/phone";
import {
  clientIdentityData,
  findPotentialClientMatches,
} from "@/lib/client-identity";

export async function fetchClientHistory(clientId: string) {
  const ctx = await getTenantContext();
  return withTenant(ctx, async (tx) => {
    const professional = ctx.role === "PROFESSIONAL"
      ? await tx.professional.findFirst({
          where: { salonId: ctx.salonId, userId: ctx.userId, active: true },
          select: { id: true },
        })
      : null;
    if (ctx.role === "PROFESSIONAL" && !professional) return [];
    return getClientHistory(tx, ctx.salonId, clientId, professional?.id);
  });
}

const clientInput = z.object({
  name: z.string().min(2),
  phone: z.string().trim().max(32).refine((value) => value.length === 0 || isValidPhoneBR(value), "WhatsApp inválido").optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  birthday: z.string().optional().nullable(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  allergies: z.string().max(1000).optional().nullable(),
  preferences: z.string().max(1000).optional().nullable(),
  consentGiven: z.boolean().default(false),
});

export type ClientInput = z.infer<typeof clientInput>;

export async function createClient(input: ClientInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = clientInput.parse(input);
  const identity = clientIdentityData(data);

  await withTenant(ctx, async (tx) => {
    const matches = await findPotentialClientMatches(tx, ctx.salonId, identity);
    if (matches.length > 0) {
      throw new Error(
        `Já existe um cadastro compatível (${matches[0]!.name}). Abra o cadastro existente ou use a mesclagem para preservar o histórico.`,
      );
    }
    await tx.clientProfile.create({
      data: {
        salonId: ctx.salonId,
        name: data.name,
        phone: identity.phone,
        phoneNormalized: identity.phoneNormalized,
        email: identity.email,
        birthday: data.birthday ? new Date(data.birthday) : null,
        gender: data.gender ?? null,
        notes: serializeClientCareProfile({
          notes: data.notes ?? "",
          allergies: data.allergies ?? "",
          preferences: data.preferences ?? "",
          consentGiven: data.consentGiven,
        }),
      },
    });
  });
  revalidatePath("/clientes");
}

export async function updateClient(id: string, input: ClientInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = clientInput.parse(input);
  const identity = clientIdentityData(data);

  await withTenant(ctx, async (tx) => {
    const matches = await findPotentialClientMatches(tx, ctx.salonId, identity, id);
    if (matches.length > 0) {
      throw new Error(
        `Os dados informados já aparecem em outro cadastro (${matches[0]!.name}). Revise ou mescle os perfis antes de salvar.`,
      );
    }
    await tx.clientProfile.updateMany({
      where: { id, salonId: ctx.salonId, mergedIntoId: null },
      data: {
        name: data.name,
        phone: identity.phone,
        phoneNormalized: identity.phoneNormalized,
        email: identity.email,
        birthday: data.birthday ? new Date(data.birthday) : null,
        gender: data.gender ?? null,
        notes: serializeClientCareProfile({
          notes: data.notes ?? "",
          allergies: data.allergies ?? "",
          preferences: data.preferences ?? "",
          consentGiven: data.consentGiven,
        }),
      },
    });
  });
  revalidatePath("/clientes");
}

export async function deleteClient(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async (tx) => {
    const client = await tx.clientProfile.findFirst({
      where: { id, salonId: ctx.salonId, mergedIntoId: null },
      select: {
        id: true,
        _count: { select: { appointments: true, packages: true, subscriptions: true, waitlistEntries: true } },
      },
    });
    if (!client) return;
    if (Object.values(client._count).some((count) => count > 0)) {
      throw new Error("Clientes com histórico não podem ser excluídos. Use a mesclagem ou mantenha o cadastro.");
    }
    await tx.clientProfile.deleteMany({ where: { id: client.id, salonId: ctx.salonId, mergedIntoId: null } });
  });
  revalidatePath("/clientes");
}

export async function importClientsCsv(csv: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const source = z.string().min(1).max(1_000_000).parse(csv);
  const parsed = parseClientCsv(source);
  if (parsed.rows.length > 500) return { error: "Importe no máximo 500 clientes por vez" };

  const result = await withTenant(ctx, async (tx) => {
    const existing = await tx.clientProfile.findMany({ where: { salonId: ctx.salonId, mergedIntoId: null }, select: { email: true, phone: true, phoneNormalized: true } });
    const emails = new Set(existing.flatMap((client) => client.email ? [client.email.toLowerCase()] : []));
    const phones = new Set(existing.flatMap((client) => {
      const identity = clientIdentityData({ phone: client.phone });
      return [client.phoneNormalized, identity.phoneNormalized].filter((phone): phone is string => Boolean(phone));
    }));
    const rows = parsed.rows.filter((row) => {
      const identity = clientIdentityData(row);
      if (identity.email && emails.has(identity.email)) return false;
      if (identity.phoneNormalized && phones.has(identity.phoneNormalized)) return false;
      if (identity.email) emails.add(identity.email);
      if (identity.phoneNormalized) phones.add(identity.phoneNormalized);
      return true;
    });
    if (rows.length > 0) {
      await tx.clientProfile.createMany({ data: rows.map((row) => ({
        ...clientIdentityData(row),
        salonId: ctx.salonId,
        name: row.name,
        birthday: row.birthday ? new Date(`${row.birthday}T12:00:00.000Z`) : null,
      })) });
    }
    const actor = await tx.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
    await writeAuditLog(tx, {
      salonId: ctx.salonId, userId: ctx.userId, actorName: actor?.name ?? "Usuário",
      action: "CLIENTS_IMPORTED", entityType: "ClientProfile", entityId: "batch",
      metadata: { imported: rows.length, skipped: parsed.rows.length - rows.length, invalid: parsed.errors.length },
    });
    return { imported: rows.length, skipped: parsed.rows.length - rows.length };
  });
  revalidatePath("/clientes");
  return { success: true as const, ...result, errors: parsed.errors };
}

const mergeInput = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
});

function mergeNotes(target: string | null, source: string | null): string | null {
  if (!target?.trim()) return source?.trim() || null;
  if (!source?.trim() || source.trim() === target.trim()) return target;
  return `${target.trim()}\n\n[Mesclado de outro cadastro]\n${source.trim()}`;
}

/**
 * Mescla dois perfis do mesmo salão sem apagar o perfil de origem.
 * O alvo é escolhido explicitamente pelo operador e todas as relações
 * históricas passam a apontar para ele dentro da mesma transação.
 */
export async function mergeClients(sourceId: string, targetId: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const input = mergeInput.parse({ sourceId, targetId });
  if (input.sourceId === input.targetId) throw new Error("Escolha dois cadastros diferentes.");

  await withTenant(ctx, async (tx) => {
    const ordered = [input.sourceId, input.targetId].sort();
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(
        hashtextextended(${`client-merge:${ctx.salonId}:${ordered[0]}:${ordered[1]}`}, 0)
      )
    `;

    const profiles = await tx.clientProfile.findMany({
      where: { salonId: ctx.salonId, id: { in: [input.sourceId, input.targetId] } },
      select: {
        id: true,
        name: true,
        phone: true,
        phoneNormalized: true,
        email: true,
        passwordHash: true,
        userId: true,
        birthday: true,
        gender: true,
        notes: true,
        mergedIntoId: true,
        _count: { select: { appointments: true, packages: true, subscriptions: true } },
      },
    });
    const source = profiles.find((profile) => profile.id === input.sourceId);
    const target = profiles.find((profile) => profile.id === input.targetId);
    if (!source || !target) throw new Error("Cadastro não encontrado neste salão.");
    if (source.mergedIntoId || target.mergedIntoId) throw new Error("Um dos cadastros já foi mesclado.");
    if (source.passwordHash && target.passwordHash) {
      throw new Error("Os dois cadastros possuem conta. Para segurança, o suporte precisa confirmar qual acesso manter.");
    }

    const targetEmail = target.email ?? source.email;
    const targetPhone = target.phone ?? source.phone;
    const targetPhoneNormalized = target.phoneNormalized ?? source.phoneNormalized ?? clientIdentityData({ phone: targetPhone }).phoneNormalized;
    const targetPasswordHash = target.passwordHash ?? source.passwordHash;
    const targetUserId = target.userId ?? source.userId;

    await tx.appointment.updateMany({
      where: { salonId: ctx.salonId, clientId: source.id },
      data: { clientId: target.id },
    });
    await tx.packagePurchase.updateMany({
      where: { salonId: ctx.salonId, clientId: source.id },
      data: { clientId: target.id },
    });
    await tx.clientSubscription.updateMany({
      where: { salonId: ctx.salonId, clientId: source.id },
      data: { clientId: target.id },
    });
    await tx.waitlistEntry.updateMany({
      where: { salonId: ctx.salonId, clientId: source.id },
      data: { clientId: target.id, guestName: null, guestPhone: null },
    });
    await tx.clientProfile.update({
      where: { id: target.id },
      data: {
        phone: targetPhone,
        phoneNormalized: targetPhoneNormalized,
        email: targetEmail,
        passwordHash: targetPasswordHash,
        userId: targetUserId,
        birthday: target.birthday ?? source.birthday,
        gender: target.gender ?? source.gender,
        notes: mergeNotes(target.notes, source.notes),
      },
    });
    await tx.clientProfile.update({
      where: { id: source.id },
      data: {
        email: null,
        passwordHash: null,
        userId: null,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    const actor = await tx.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
    await writeAuditLog(tx, {
      salonId: ctx.salonId,
      userId: ctx.userId,
      actorName: actor?.name ?? "Usuário",
      action: "CLIENTS_MERGED",
      entityType: "ClientProfile",
      entityId: target.id,
      reason: "Mesclagem manual de cadastros",
      metadata: {
        sourceId: source.id,
        sourceName: source.name,
        targetId: target.id,
        targetName: target.name,
        appointments: source._count.appointments,
        packages: source._count.packages,
        subscriptions: source._count.subscriptions,
      },
    });
  });
  revalidatePath("/clientes");
  revalidatePath("/marketing");
  revalidatePath("/dashboard");
  return { success: true as const };
}

export async function redeemLoyaltyReward(clientId: string, rewardCost = 5, rewardLabel = "R$ 10 de desconto") {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = z.object({ clientId: z.string().min(1), rewardCost: z.number().int().min(1).max(100), rewardLabel: z.string().trim().min(3).max(100) }).parse({ clientId, rewardCost, rewardLabel });
  try {
    await withTenant(ctx, async (tx) => {
      const client = await tx.clientProfile.findFirst({ where: { id: data.clientId, salonId: ctx.salonId }, select: { id: true, name: true, _count: { select: { appointments: { where: { status: "COMPLETED" } } } } } });
      if (!client) throw new Error("Cliente não encontrado");
      const previous = await tx.auditLog.findMany({ where: { salonId: ctx.salonId, action: "LOYALTY_REDEEMED", entityType: "ClientProfile", entityId: client.id }, select: { metadata: true } });
      const redeemed = previous.reduce((sum, item) => { const metadata = item.metadata as Record<string, unknown> | null; return sum + (typeof metadata?.points === "number" ? metadata.points : 0); }, 0);
      const balance = calculateLoyaltyBalance({ completedVisits: client._count.appointments, redeemedPoints: redeemed, rewardCost: data.rewardCost });
      if (!balance.canRedeem) throw new Error(`Saldo insuficiente: ${balance.availablePoints} pontos disponíveis`);
      const actor = await tx.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
      await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: actor?.name ?? "Usuário", action: "LOYALTY_REDEEMED", entityType: "ClientProfile", entityId: client.id, reason: data.rewardLabel, metadata: { clientName: client.name, points: data.rewardCost, rewardLabel: data.rewardLabel, balanceAfter: balance.availablePoints - data.rewardCost } });
    });
    revalidatePath("/clientes");
    return { success: true as const };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Não foi possível resgatar a recompensa" };
  }
}
