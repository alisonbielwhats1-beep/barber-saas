"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { isDateKey, zonedDateTimeToUtc } from "@/lib/time";
import { lockOperationalResources } from "@/lib/inventory-lock";
import { writeAuditLog } from "@/lib/audit";

const openingSchema = z.object({
  id: z.string().uuid(), professionalId: z.string().min(1), dateKey: z.string().refine(isDateKey),
  startMinutes: z.number().int().min(0).max(1439), endMinutes: z.number().int().min(1).max(1439),
  reason: z.string().trim().min(3).max(200),
}).refine(d => d.endMinutes > d.startMinutes);

export async function addOpening(input: z.infer<typeof openingSchema>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const parsed = openingSchema.safeParse(input);
  if (!parsed.success) return { error: "Informe profissional, data, intervalo válido e motivo." };
  try {
    await withTenant(ctx, async tx => {
      const data = parsed.data;
      const professional = await tx.professional.findFirst({ where: { id: data.professionalId, salonId: ctx.salonId, active: true }, select: { id: true } });
      if (!professional) throw new Error("Profissional inválido.");
      await lockOperationalResources(tx, { professionalIds: [professional.id] });
      const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { timezone: true } });
      for (const minute of [data.startMinutes, data.endMinutes]) zonedDateTimeToUtc(data.dateKey, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, salon.timezone);
      const previous = await tx.professionalOpening.findFirst({ where: { id: data.id, salonId: ctx.salonId } });
      if (previous) {
        if (previous.professionalId !== data.professionalId || previous.dateKey !== data.dateKey || previous.startMinutes !== data.startMinutes || previous.endMinutes !== data.endMinutes || previous.reason !== data.reason) throw new Error("Pedido alterado. Reabra o formulário.");
        return;
      }
      await tx.professionalOpening.create({ data: { ...data, salonId: ctx.salonId } });
      await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "PROFESSIONAL_OPENING_ADDED", entityType: "ProfessionalOpening", entityId: data.id, reason: data.reason, metadata: data });
    });
    revalidatePath("/agenda"); revalidatePath("/dashboard");
    return { success: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Não foi possível liberar o expediente." }; }
}

export async function removeOpening(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async tx => {
    const opening = await tx.professionalOpening.findFirst({ where: { id, salonId: ctx.salonId } });
    if (!opening) return;
    await lockOperationalResources(tx, { professionalIds: [opening.professionalId] });
    await tx.professionalOpening.deleteMany({ where: { id, salonId: ctx.salonId } });
    await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "PROFESSIONAL_OPENING_REMOVED", entityType: "ProfessionalOpening", entityId: id, reason: opening.reason, metadata: { ...opening, createdAt: opening.createdAt.toISOString() } });
  });
  revalidatePath("/agenda"); revalidatePath("/dashboard");
}
