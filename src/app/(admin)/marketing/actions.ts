"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import {
  MARKETING_SETTINGS_ACTION,
  MAX_LAPSED_CLIENT_DAYS,
  MIN_LAPSED_CLIENT_DAYS,
} from "@/lib/marketing-settings";
import { withTenant } from "@/lib/prisma-tenant";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { assertPlanFeature } from "@/lib/plan-entitlements";

const interactionInput = z.object({
  campaignKey: z.string().trim().min(2).max(50),
  clientId: z.string().min(1),
  status: z.enum(["OPENED", "COPIED"]),
});

const settingsInput = z.object({
  lapsedClientDays: z.number().int().min(MIN_LAPSED_CLIENT_DAYS).max(MAX_LAPSED_CLIENT_DAYS),
  googleReviewUrl: z.string().trim().max(500).refine(
    (value) => value === "" || (z.string().url().safeParse(value).success && value.startsWith("https://")),
    "Informe um link HTTPS válido",
  ),
});

export async function recordCampaignInteraction(input: z.infer<typeof interactionInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = interactionInput.parse(input);
  await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: ctx.salonId },
      select: { plan: true },
    });
    assertPlanFeature(salon?.plan, "MARKETING");
    const client = await tx.clientProfile.findFirst({ where: { id: data.clientId, salonId: ctx.salonId }, select: { id: true, name: true } });
    if (!client) throw new Error("Cliente não encontrado");
    const actor = await tx.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
    await writeAuditLog(tx, {
      salonId: ctx.salonId,
      userId: ctx.userId,
      actorName: actor?.name ?? "Usuário",
      action: "MARKETING_INTERACTION",
      entityType: "ClientProfile",
      entityId: client.id,
      metadata: { campaignKey: data.campaignKey, clientId: client.id, clientName: client.name, status: data.status },
    });
  });
  revalidatePath("/marketing");
  return { success: true as const };
}

export async function updateMarketingSettings(input: z.infer<typeof settingsInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  const parsed = settingsInput.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Configuração inválida" };
  }

  await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: ctx.salonId },
      select: { plan: true },
    });
    assertPlanFeature(salon?.plan, "MARKETING");
    const actor = await tx.user.findUnique({
      where: { id: ctx.userId },
      select: { name: true },
    });
    await writeAuditLog(tx, {
      salonId: ctx.salonId,
      userId: ctx.userId,
      actorName: actor?.name ?? "Dono do estabelecimento",
      action: MARKETING_SETTINGS_ACTION,
      entityType: "Salon",
      entityId: ctx.salonId,
      metadata: {
        lapsedClientDays: parsed.data.lapsedClientDays,
        googleReviewUrl: parsed.data.googleReviewUrl || null,
      },
    });
  });

  revalidatePath("/marketing");
  revalidatePath("/clientes");
  revalidatePath("/dashboard");
  return { success: true as const };
}
