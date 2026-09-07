"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { inspectAppointmentAvailabilityWithServiceSnapshots } from "@/lib/appointment-service";
import { requestStaffReschedule } from "@/lib/reschedule-proposals";
import { addCalendarDays, toLocalDateTime } from "@/lib/time";

const edit = z.object({ appointmentId: z.string().min(1), shiftDays: z.number().int().min(-365).max(365), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), reason: z.string().trim().min(3).max(200) });
export async function previewSeriesEdit(input: z.infer<typeof edit>) {
  const ctx = await getTenantContext(); assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = edit.parse(input);
  return withTenant(ctx, async tx => {
    const source = await tx.appointment.findFirst({ where: { salonId: ctx.salonId, id: data.appointmentId }, select: { seriesId: true, startAt: true } });
    if (!source?.seriesId) throw new Error("Este atendimento não pertence a uma série.");
    const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { timezone: true } });
    const items = await tx.appointment.findMany({ where: { salonId: ctx.salonId, seriesId: source.seriesId, startAt: { gte: source.startAt, gt: new Date() }, status: { in: ["PENDING", "CONFIRMED"] } }, include: { serviceItems: { orderBy: { position: "asc" } }, service: { select: { name: true } }, client: { select: { name: true } }, resourceBookings: { where: { retired: false }, select: { resourceId: true } } }, orderBy: { startAt: "asc" }, take: 53 });
    if (items.length > 52) throw new Error("Revise a série em grupos de até 52 ocorrências.");
    const result = [];
    for (const item of items) {
      const startLocal = `${addCalendarDays(toLocalDateTime(item.startAt, salon.timezone).slice(0, 10), data.shiftDays)}T${data.time}`;
      let conflict: string | null = null;
      try {
        const serviceSnapshots = item.serviceItems.length ? item.serviceItems.map(s => ({ id: s.serviceId, name: s.serviceName, durationMin: s.durationMin, priceCents: s.priceCents, processingMin: s.processingMin, finishingMin: s.finishingMin })) : [{ id: item.serviceId, name: item.service.name, durationMin: Math.round((+item.endAt - +item.startAt) / 60000), priceCents: item.priceCents }];
        const inspection = await inspectAppointmentAvailabilityWithServiceSnapshots(tx, { salonId: ctx.salonId, professionalId: item.professionalId, currentProfessionalId: item.professionalId, serviceSnapshots, startLocal, excludeAppointmentId: item.id, enforceBookingWindow: false });
        if (inspection.startAt <= new Date()) conflict = "Horário passado";
        else if (inspection.violation) conflict = "Indisponível: conflito, bloqueio ou fora do expediente";
        else if (item.resourceBookings.length && await tx.resourceBooking.findFirst({ where: { salonId: ctx.salonId, resourceId: { in: item.resourceBookings.map(r => r.resourceId) }, active: true, appointmentId: { not: item.id }, startAt: { lt: inspection.endAt }, endAt: { gt: inspection.startAt } }, select: { appointmentId: true } })) conflict = "Sala ou equipamento já reservado";
      } catch { conflict = "Não foi possível validar este horário"; }
      result.push({ id: item.id, version: item.version, name: item.client.name, before: toLocalDateTime(item.startAt, salon.timezone), startLocal, conflict });
    }
    return result;
  });
}

const apply = z.object({ reason: z.string().trim().min(3).max(200), items: z.array(z.object({ id: z.string().min(1), version: z.number().int().positive(), startLocal: z.string().length(16), requestId: z.string().uuid() })).min(1).max(52) });
export async function applySeriesEdit(input: z.infer<typeof apply>) {
  const ctx = await getTenantContext(); assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = apply.parse(input);
  const results: { id: string; message: string; success: boolean }[] = [];
  for (const item of data.items) {
    try {
      const result = await withTenant(ctx, async tx => {
        const appointment = await tx.appointment.findFirst({ where: { id: item.id, salonId: ctx.salonId, seriesId: { not: null }, startAt: { gt: new Date() }, status: { in: ["PENDING", "CONFIRMED"] } }, include: { serviceItems: { orderBy: { position: "asc" } } } });
        if (!appointment) throw new Error("Ocorrência alterada ou já iniciada");
        return requestStaffReschedule(tx, { salonId: ctx.salonId, appointmentId: appointment.id, professionalId: appointment.professionalId, serviceIds: appointment.serviceItems.length ? appointment.serviceItems.map(s => s.serviceId) : [appointment.serviceId], startLocal: item.startLocal, expectedVersion: item.version, idempotencyKey: item.requestId, reason: data.reason, actor: { type: "STAFF", id: ctx.userId, name: "Equipe" } });
      });
      results.push({ id: item.id, success: true, message: result.requiresAcceptance ? "Proposta enviada para aceite no aplicativo" : "Reagendado" });
    } catch { results.push({ id: item.id, success: false, message: "Mantido: horário indisponível ou ocorrência alterada. Revise individualmente." }); }
  }
  revalidatePath("/agenda"); revalidatePath("/hoje"); revalidatePath("/book", "layout");
  return results;
}
