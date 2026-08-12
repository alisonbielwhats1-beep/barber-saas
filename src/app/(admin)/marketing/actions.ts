"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { withTenant } from "@/lib/prisma-tenant";
import { assertRole, getTenantContext } from "@/lib/tenant";

const interactionInput = z.object({
  campaignKey: z.string().trim().min(2).max(50),
  clientId: z.string().min(1),
  status: z.enum(["OPENED", "COPIED"]),
});

export async function recordCampaignInteraction(input: z.infer<typeof interactionInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = interactionInput.parse(input);
  await withTenant(ctx, async (tx) => {
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
