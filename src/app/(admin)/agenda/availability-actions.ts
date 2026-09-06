"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { localDateTimeToUtc } from "@/lib/time";
import { lockOperationalResources } from "@/lib/inventory-lock";
import { writeAuditLog } from "@/lib/audit";
import { updateAppointmentStatusReliably } from "@/lib/appointment-service";

const inputSchema = z.object({
  id: z.string().uuid(),
  professionalIds: z.array(z.string().min(1)).min(1).max(100),
  startLocal: z.string().min(16).max(16),
  endLocal: z.string().min(16).max(16),
  reason: z.string().trim().min(3).max(200),
});

export async function previewAvailabilityBlock(input: z.infer<typeof inputSchema>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Preencha profissionais, início, fim e motivo." };
  const data = parsed.data;
  try {
    const affected = await withTenant(ctx, async tx => {
      const ids = [...new Set(data.professionalIds)];
      const pros = await tx.professional.findMany({ where: { salonId: ctx.salonId, id: { in: ids }, active: true }, select: { id: true } });
      if (pros.length !== ids.length) throw new Error("Profissional inválido para este estabelecimento.");
      const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { timezone: true } });
      const startAt = localDateTimeToUtc(data.startLocal, salon.timezone);
      const endAt = localDateTimeToUtc(data.endLocal, salon.timezone);
      if (endAt <= startAt || +endAt - +startAt > 366 * 86400000) throw new Error("Informe um intervalo válido de até um ano.");
      return tx.appointment.findMany({ where: { salonId: ctx.salonId, professionalId: { in: ids }, startAt: { lt: endAt }, endAt: { gt: startAt }, status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] } }, select: { id: true, version: true, startAt: true, client: { select: { name: true } } }, orderBy: { startAt: "asc" } });
    });
    return { affected: affected.map(a => ({ id: a.id, name: a.client.name, startAt: a.startAt.toISOString() })) };
  } catch { return { error: "Não foi possível revisar. Confira profissionais e o intervalo informado." }; }
}

export async function blockAvailability(input: z.infer<typeof inputSchema>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Selecione profissionais, início, fim e um motivo de pelo menos 3 caracteres." };
  const data = parsed.data;
  try {
    const affected = await withTenant(ctx, async tx => {
      const ids = [...new Set(data.professionalIds)].sort();
      const pros = await tx.professional.findMany({ where: { salonId: ctx.salonId, id: { in: ids }, active: true }, select: { id: true } });
      if (pros.length !== ids.length) throw new Error("Profissional inválido para este estabelecimento.");
      await lockOperationalResources(tx, { professionalIds: ids });
      const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { timezone: true } });
      const startAt = localDateTimeToUtc(data.startLocal, salon.timezone);
      const endAt = localDateTimeToUtc(data.endLocal, salon.timezone);
      if (endAt <= startAt || endAt.getTime() - startAt.getTime() > 366 * 86400000) throw new Error("Informe um intervalo válido de até um ano.");
      // Stable ids make a retry harmless; a changed payload with the same id fails closed.
      for (const id of ids) {
        const blockId = `${data.id}:${id}`;
        const previous = await tx.timeOff.findFirst({ where: { id: blockId, professional: { salonId: ctx.salonId } } });
        if (previous) {
          if (+previous.startAt !== +startAt || +previous.endAt !== +endAt || previous.reason !== data.reason) throw new Error("O pedido mudou. Feche e abra o formulário para tentar novamente.");
          continue;
        }
        await tx.timeOff.create({ data: { id: blockId, professionalId: id, startAt, endAt, reason: data.reason } });
        await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "AVAILABILITY_BLOCKED", entityType: "TimeOff", entityId: blockId, reason: data.reason, metadata: { professionalId: id, startAt: startAt.toISOString(), endAt: endAt.toISOString() } });
      }
      return tx.appointment.findMany({ where: { salonId: ctx.salonId, professionalId: { in: ids }, startAt: { lt: endAt }, endAt: { gt: startAt }, status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] } }, select: { id: true, version: true, startAt: true, client: { select: { name: true } } }, orderBy: { startAt: "asc" } });
    });
    revalidatePath("/agenda");
    revalidatePath("/dashboard");
    return { success: true, affected: affected.map(a => ({ id: a.id, version: a.version, startAt: a.startAt.toISOString(), name: a.client.name })) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Não foi possível bloquear o período." };
  }
}

const cancellationInput = z.object({
  reason: z.string().trim().min(3).max(200),
  appointments: z.array(z.object({ id: z.string().min(1), version: z.number().int().positive(), requestId: z.string().uuid() })).min(1).max(100),
});

/** Each result is explicit: a concurrent edit cannot silently cancel another version. */
export async function cancelSelectedAppointments(input: z.infer<typeof cancellationInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = cancellationInput.parse(input);
  const results: { id: string; success: boolean; error?: string }[] = [];
  for (const appointment of data.appointments) {
    try {
      await withTenant(ctx, async tx => {
        const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
        await updateAppointmentStatusReliably(tx, { salonId: ctx.salonId, appointmentId: appointment.id, expectedVersion: appointment.version, idempotencyKey: appointment.requestId, status: "CANCELLED", reason: data.reason, actor: { type: "STAFF", id: ctx.userId, name: user?.name ?? "Equipe" } });
      });
      results.push({ id: appointment.id, success: true });
    } catch {
      results.push({ id: appointment.id, success: false, error: "Não cancelado: a reserva pode ter mudado ou já ter iniciado. Abra os detalhes para revisar." });
    }
  }
  revalidatePath("/agenda"); revalidatePath("/dashboard"); revalidatePath("/book", "layout");
  return results;
}

export async function removeAvailabilityBlock(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async tx => {
    const block = await tx.timeOff.findFirst({ where: { id, professional: { salonId: ctx.salonId } } });
    if (!block) return;
    await lockOperationalResources(tx, { professionalIds: [block.professionalId] });
    await tx.timeOff.deleteMany({ where: { id, professional: { salonId: ctx.salonId } } });
    await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "AVAILABILITY_REOPENED", entityType: "TimeOff", entityId: id, reason: block.reason, metadata: { startAt: block.startAt.toISOString(), endAt: block.endAt.toISOString(), professionalId: block.professionalId } });
  });
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
}
