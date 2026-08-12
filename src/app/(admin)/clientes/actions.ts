"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getClientHistory } from "@/lib/crm";
import { serializeClientCareProfile } from "@/lib/client-care-profile";
import { writeAuditLog } from "@/lib/audit";
import { calculateLoyaltyBalance, parseClientCsv } from "@/lib/operational-flows";

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
  phone: z.string().optional().nullable(),
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

  await withTenant(ctx, (tx) =>
    tx.clientProfile.create({
      data: {
        salonId: ctx.salonId,
        name: data.name,
        phone: data.phone ?? null,
        email: data.email || null,
        birthday: data.birthday ? new Date(data.birthday) : null,
        gender: data.gender ?? null,
        notes: serializeClientCareProfile({
          notes: data.notes ?? "",
          allergies: data.allergies ?? "",
          preferences: data.preferences ?? "",
          consentGiven: data.consentGiven,
        }),
      },
    }),
  );
  revalidatePath("/clientes");
}

export async function updateClient(id: string, input: ClientInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = clientInput.parse(input);

  await withTenant(ctx, (tx) =>
    tx.clientProfile.updateMany({
      where: { id, salonId: ctx.salonId },
      data: {
        name: data.name,
        phone: data.phone ?? null,
        email: data.email || null,
        birthday: data.birthday ? new Date(data.birthday) : null,
        gender: data.gender ?? null,
        notes: serializeClientCareProfile({
          notes: data.notes ?? "",
          allergies: data.allergies ?? "",
          preferences: data.preferences ?? "",
          consentGiven: data.consentGiven,
        }),
      },
    }),
  );
  revalidatePath("/clientes");
}

export async function deleteClient(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, (tx) =>
    tx.clientProfile.deleteMany({ where: { id, salonId: ctx.salonId } }),
  );
  revalidatePath("/clientes");
}

export async function importClientsCsv(csv: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const source = z.string().min(1).max(1_000_000).parse(csv);
  const parsed = parseClientCsv(source);
  if (parsed.rows.length > 500) return { error: "Importe no máximo 500 clientes por vez" };

  const result = await withTenant(ctx, async (tx) => {
    const existing = await tx.clientProfile.findMany({ where: { salonId: ctx.salonId }, select: { email: true, phone: true } });
    const emails = new Set(existing.flatMap((client) => client.email ? [client.email.toLowerCase()] : []));
    const phones = new Set(existing.flatMap((client) => client.phone ? [client.phone.replace(/\D/g, "")] : []));
    const rows = parsed.rows.filter((row) => {
      if (row.email && emails.has(row.email)) return false;
      if (row.phone && phones.has(row.phone)) return false;
      if (row.email) emails.add(row.email);
      if (row.phone) phones.add(row.phone);
      return true;
    });
    if (rows.length > 0) {
      await tx.clientProfile.createMany({ data: rows.map((row) => ({
        salonId: ctx.salonId,
        name: row.name,
        phone: row.phone,
        email: row.email,
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
