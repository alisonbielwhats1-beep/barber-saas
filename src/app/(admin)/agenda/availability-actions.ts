"use server";

import { z } from "zod";
import { createHash } from "node:crypto";
import { inputSchema, expandBlock, executeAvailabilityBlock } from "@/lib/availability-block-domain";
import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { availabilityOccurrences } from "@/lib/availability-recurrence";
import { lockOperationalResources } from "@/lib/inventory-lock";
import { writeAuditLog } from "@/lib/audit";
import { updateAppointmentStatusReliably } from "@/lib/appointment-service";

export async function previewAvailabilityBlock(input: z.infer<typeof inputSchema>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "PROFESSIONAL"]);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Confira profissionais, início, fim e o limite de 200 caracteres do motivo opcional." };
  const data = parsed.data;
  if ((data.count ?? 1) * new Set(data.professionalIds).size > 200) return { error: "Selecione até 200 bloqueios por pedido. Reduza profissionais ou ocorrências." };
  try {
    const review = await withTenant(ctx, async tx => {
      const ids = [...new Set(data.professionalIds)];
      const pros = await tx.professional.findMany({ where: { salonId: ctx.salonId, id: { in: ids }, active: true, ...(ctx.role === "PROFESSIONAL" ? { userId: ctx.userId } : {}) }, select: { id: true } });
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
  assertRole(ctx, ["OWNER", "MANAGER", "PROFESSIONAL"]);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Confira profissionais, início, fim e o limite de 200 caracteres do motivo opcional." };
  const data = parsed.data;
  if ((data.count ?? 1) * new Set(data.professionalIds).size > 200) return { error: "Selecione até 200 bloqueios por pedido. Reduza profissionais ou ocorrências." };
  try {
    const affected = await withTenant(ctx, async tx => {
      return executeAvailabilityBlock(tx,ctx,data);
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
  assertRole(ctx, ["OWNER", "MANAGER", "PROFESSIONAL"]);
  await withTenant(ctx, async tx => {
    const block = await tx.timeOff.findFirst({ where: { id, professional: { salonId: ctx.salonId, ...(ctx.role === "PROFESSIONAL" ? { userId: ctx.userId } : {}) } } });
    if (!block) return;
    await lockOperationalResources(tx, { professionalIds: [block.professionalId] });
    const current = await tx.timeOff.findFirst({ where: { id, professional: { salonId: ctx.salonId, ...(ctx.role === "PROFESSIONAL" ? { userId: ctx.userId } : {}) } } });
    if (!current) return;
    await tx.timeOff.deleteMany({ where: { id, professional: { salonId: ctx.salonId, ...(ctx.role === "PROFESSIONAL" ? { userId: ctx.userId } : {}) } } });
    await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "AVAILABILITY_REOPENED", entityType: "TimeOff", entityId: id, reason: current.reason, metadata: { startAt: current.startAt.toISOString(), endAt: current.endAt.toISOString(), professionalId: current.professionalId } });
  });
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/book", "layout");
}

const editBlockSchema = z.object({
  id: z.string().min(1).max(200), requestId: z.string().uuid(),
  expectedStartAt: z.string().datetime(), expectedEndAt: z.string().datetime(),
  expectedReason: z.string().max(200).nullable(),
  startLocal: z.string().length(16), endLocal: z.string().length(16),
  reason: z.string().trim().max(200),
});

/** Edits one occurrence, under the same professional lock as booking/reopening. */
export async function updateAvailabilityBlock(input: z.infer<typeof editBlockSchema>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "PROFESSIONAL"]);
  const parsed = editBlockSchema.safeParse(input);
  if (!parsed.success) return { error: "Confira o início, fim e motivo do bloqueio." };
  const data = parsed.data;
  try {
    const result = await withTenant(ctx, async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`availability-edit:${ctx.salonId}:${data.requestId}`}, 0))`;
      const block = await tx.timeOff.findFirst({ where: { id: data.id, professional: { salonId: ctx.salonId, ...(ctx.role === "PROFESSIONAL" ? { userId: ctx.userId } : {}) } } });
      if (!block) throw new Error("Bloqueio não encontrado. Atualize a agenda.");
      await lockOperationalResources(tx, { professionalIds: [block.professionalId] });
      const fingerprint = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      const previous = await tx.auditLog.findFirst({ where: { salonId: ctx.salonId, action: "AVAILABILITY_EDIT_REQUEST", entityId: data.requestId } });
      if (previous) {
        if (previous.reason !== fingerprint) throw new Error("O pedido mudou. Reabra o bloqueio para revisar.");
        return { success: true as const, duplicate: true };
      }
      const current = await tx.timeOff.findFirst({ where: { id: data.id, professional: { salonId: ctx.salonId, ...(ctx.role === "PROFESSIONAL" ? { userId: ctx.userId } : {}) } } });
      if (!current || current.startAt.toISOString() !== data.expectedStartAt || current.endAt.toISOString() !== data.expectedEndAt || current.reason !== data.expectedReason) {
        throw new Error("Este bloqueio foi alterado ou reaberto. Atualize a agenda antes de editar.");
      }
      const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { timezone: true } });
      const [{ startAt, endAt }] = availabilityOccurrences(data.startLocal, data.endLocal, salon.timezone);
      const updated = await tx.timeOff.updateMany({ where: { id: data.id, professional: { salonId: ctx.salonId, ...(ctx.role === "PROFESSIONAL" ? { userId: ctx.userId } : {}) }, startAt: current.startAt, endAt: current.endAt, reason: current.reason }, data: { startAt, endAt, reason: data.reason } });
      if (updated.count !== 1) throw new Error("Este bloqueio mudou. Atualize a agenda.");
      await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "AVAILABILITY_UPDATED", entityType: "TimeOff", entityId: data.id, reason: data.reason, metadata: { professionalId: current.professionalId, before: { startAt: current.startAt.toISOString(), endAt: current.endAt.toISOString(), reason: current.reason }, after: { startAt: startAt.toISOString(), endAt: endAt.toISOString(), reason: data.reason } } });
      await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "AVAILABILITY_EDIT_REQUEST", entityType: "TimeOff", entityId: data.requestId, reason: fingerprint });
      return { success: true as const, duplicate: false };
    });
    revalidatePath("/agenda"); revalidatePath("/dashboard"); revalidatePath("/book", "layout");
    return result;
  } catch (error) { return { error: error instanceof Error ? error.message : "Não foi possível alterar o bloqueio." }; }
}
