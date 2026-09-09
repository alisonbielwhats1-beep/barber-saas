"use server";

import { z } from "zod";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { availabilityOccurrences } from "@/lib/availability-recurrence";
import { lockOperationalResources } from "@/lib/inventory-lock";
import { writeAuditLog } from "@/lib/audit";
import { updateAppointmentStatusReliably } from "@/lib/appointment-service";

const inputSchema = z.object({
  id: z.string().uuid(),
  professionalIds: z.array(z.string().min(1)).min(1).max(100),
  startLocal: z.string().min(16).max(16),
  endLocal: z.string().min(16).max(16),
  reason: z.string().trim().min(3).max(200),
  everyWeeks: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]).optional(),
  count: z.number().int().min(1).max(52).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(v => Boolean(v.weekdays) === Boolean(v.untilDate), "Informe dias e data final juntos.");

function expandBlock(data: z.infer<typeof inputSchema>, timezone: string) {
  const intervals = availabilityOccurrences(data.startLocal, data.endLocal, timezone, data.everyWeeks, data.count, data.weekdays && data.untilDate ? { weekdays: data.weekdays, untilDate: data.untilDate } : undefined);
  if (intervals.length * new Set(data.professionalIds).size > 200) throw new Error("Selecione até 200 bloqueios por pedido. Reduza a data final ou os profissionais; para uma rotina fixa, use Pausa recorrente.");
  return intervals;
}

export async function previewAvailabilityBlock(input: z.infer<typeof inputSchema>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Preencha profissionais, início, fim e motivo." };
  const data = parsed.data;
  if ((data.count ?? 1) * new Set(data.professionalIds).size > 200) return { error: "Selecione até 200 bloqueios por pedido. Reduza profissionais ou ocorrências." };
  try {
    const review = await withTenant(ctx, async tx => {
      const ids = [...new Set(data.professionalIds)];
      const pros = await tx.professional.findMany({ where: { salonId: ctx.salonId, id: { in: ids }, active: true }, select: { id: true } });
      if (pros.length !== ids.length) throw new Error("Profissional inválido para este estabelecimento.");
      const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { timezone: true } });
      const intervals = expandBlock(data, salon.timezone);
      const affected = await tx.appointment.findMany({ where: { salonId: ctx.salonId, professionalId: { in: ids }, OR: intervals.map(({ startAt, endAt }) => ({ startAt: { lt: endAt }, endAt: { gt: startAt } })), status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] } }, select: { id: true, version: true, startAt: true, client: { select: { name: true } } }, orderBy: { startAt: "asc" } });
      return { affected, occurrences: intervals.length, first: intervals[0].startAt.toISOString(), last: intervals[intervals.length - 1].endAt.toISOString() };
    });
    return { ...review, affected: review.affected.map(a => ({ id: a.id, name: a.client.name, startAt: a.startAt.toISOString() })) };
  } catch (error) { return { error: error instanceof Error ? error.message : "Não foi possível revisar. Confira profissionais e o intervalo informado." }; }
}

export async function blockAvailability(input: z.infer<typeof inputSchema>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Selecione profissionais, início, fim e um motivo de pelo menos 3 caracteres." };
  const data = parsed.data;
  if ((data.count ?? 1) * new Set(data.professionalIds).size > 200) return { error: "Selecione até 200 bloqueios por pedido. Reduza profissionais ou ocorrências." };
  try {
    const affected = await withTenant(ctx, async tx => {
      const ids = [...new Set(data.professionalIds)].sort();
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`availability-request:${ctx.salonId}:${data.id}`}, 0))`;
      const fingerprint = createHash("sha256").update(JSON.stringify({ ...data, professionalIds: ids, everyWeeks: data.everyWeeks ?? 0, count: data.count ?? 1 })).digest("hex");
      const request = await tx.auditLog.findFirst({ where: { salonId: ctx.salonId, action: "AVAILABILITY_REQUEST", entityId: data.id }, select: { reason: true } });
      if (request && request.reason !== fingerprint) throw new Error("O pedido mudou. Feche e abra o formulário para tentar novamente.");
      const pros = await tx.professional.findMany({ where: { salonId: ctx.salonId, id: { in: ids }, active: true }, select: { id: true } });
      if (pros.length !== ids.length) throw new Error("Profissional inválido para este estabelecimento.");
      await lockOperationalResources(tx, { professionalIds: ids });
      const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { timezone: true } });
      const intervals = expandBlock(data, salon.timezone);
      // Stable ids make a retry harmless; a changed payload with the same id fails closed.
      for (const id of request ? [] : ids) {
       for (const [index, { startAt, endAt }] of intervals.entries()) {
        const blockId = `${data.id}:${id}${index ? `:${index}` : ""}`;
        const previous = await tx.timeOff.findFirst({ where: { id: blockId, professional: { salonId: ctx.salonId } } });
        if (previous) {
          if (+previous.startAt !== +startAt || +previous.endAt !== +endAt || previous.reason !== data.reason) throw new Error("O pedido mudou. Feche e abra o formulário para tentar novamente.");
          continue;
        }
        await tx.timeOff.create({ data: { id: blockId, professionalId: id, startAt, endAt, reason: data.reason } });
        await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "AVAILABILITY_BLOCKED", entityType: "TimeOff", entityId: blockId, reason: data.reason, metadata: { professionalId: id, startAt: startAt.toISOString(), endAt: endAt.toISOString() } });
       }
      }
      if (!request) await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "AVAILABILITY_REQUEST", entityType: "TimeOff", entityId: data.id, reason: fingerprint, metadata: { occurrences: intervals.length, professionalIds: ids } });
      return tx.appointment.findMany({ where: { salonId: ctx.salonId, professionalId: { in: ids }, OR: intervals.map(({ startAt, endAt }) => ({ startAt: { lt: endAt }, endAt: { gt: startAt } })), status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] } }, select: { id: true, version: true, startAt: true, client: { select: { name: true } } }, orderBy: { startAt: "asc" } });
    });
    revalidatePath("/agenda");
    revalidatePath("/dashboard");
    revalidatePath("/book", "layout");
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
  revalidatePath("/book", "layout");
}
