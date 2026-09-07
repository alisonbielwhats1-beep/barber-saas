import { z } from "zod";
import type { Tx } from "./prisma-tenant";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, wallClockMinutesInTimeZone } from "./time";
import { inspectAppointmentAvailability, createAppointment } from "./appointment-service";
import { lockOperationalResources } from "./inventory-lock";
import { writeAuditLog } from "./audit";

export const flexibleInput = z.object({ id: z.string().uuid(), professionalId: z.string().min(1), serviceIds: z.array(z.string().min(1)).min(1).max(10), fromDate: z.string().refine(isDateKey), toDate: z.string().refine(isDateKey), startMinutes: z.number().int().min(0).max(1439), endMinutes: z.number().int().min(1).max(1440) }).refine(d => d.fromDate <= d.toDate && d.toDate <= addCalendarDays(d.fromDate, 60) && d.startMinutes < d.endMinutes, "Informe um período válido de até 60 dias.");

export async function joinFlexibleWaitlist(tx: Tx, salonId: string, clientId: string, raw: z.infer<typeof flexibleInput>) {
  const data = flexibleInput.parse(raw); const services = [...new Set(data.serviceIds)].sort();
  const salon = await tx.salon.findUniqueOrThrow({ where: { id: salonId }, select: { timezone: true } });
  const today = dateKeyInTimeZone(new Date(), salon.timezone);
  if (data.fromDate < today || data.toDate > addCalendarDays(today, 60)) throw new Error("Escolha datas nos próximos 60 dias.");
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`flexible-client:${salonId}:${clientId}`},0))`;
  const previous = await tx.flexibleWaitlist.findFirst({ where: { id: data.id, salonId, clientId }, include: { services: true } });
  if (previous) {
    if (previous.professionalId !== data.professionalId || previous.fromDate !== data.fromDate || previous.toDate !== data.toDate || previous.startMinutes !== data.startMinutes || previous.endMinutes !== data.endMinutes || previous.services.map(s => s.serviceId).sort().join() !== services.join()) throw new Error("Solicitação alterada. Abra novamente o formulário.");
    return;
  }
  if (await tx.flexibleWaitlist.count({ where: { salonId, clientId, status: "WAITING", toDate: { gte: today } } }) >= 10) throw new Error("Você já tem dez pedidos ativos na fila.");
  const links = await tx.professionalService.count({ where: { serviceId: { in: services }, service: { salonId, active: true }, professional: { id: data.professionalId, salonId, active: true } } });
  if (links !== services.length) throw new Error("Profissional ou serviços indisponíveis.");
  await tx.flexibleWaitlist.create({ data: { id: data.id, salonId, clientId, professionalId: data.professionalId, fromDate: data.fromDate, toDate: data.toDate, startMinutes: data.startMinutes, endMinutes: data.endMinutes, services: { create: services.map(serviceId => ({ serviceId, salonId })) } } });
}

export async function promoteFlexible(tx: Tx, ctx: { salonId: string; userId: string }, id: string, startLocal: string) {
  const selected = await tx.flexibleWaitlist.findFirst({ where: { id, salonId: ctx.salonId }, include: { client: true } });
  if (!selected) throw new Error("Pedido não encontrado.");
  if (selected.status === "FULFILLED") return { appointmentId: selected.fulfilledAppointmentId };
  await lockOperationalResources(tx, { professionalIds: [selected.professionalId] });
  await tx.$queryRaw`SELECT id FROM "FlexibleWaitlist" WHERE id=${id} AND "salonId"=${ctx.salonId} FOR UPDATE`;
  const fresh = await tx.flexibleWaitlist.findFirstOrThrow({ where: { id, salonId: ctx.salonId } });
  if (fresh.status === "FULFILLED") return { appointmentId: fresh.fulfilledAppointmentId };
  if (fresh.status !== "WAITING") throw new Error("Este pedido foi retirado da fila.");
  const date = startLocal.slice(0, 10);
  const minute = Number(startLocal.slice(11, 13)) * 60 + Number(startLocal.slice(14));
  const candidates = await tx.flexibleWaitlist.findMany({ where: { salonId: ctx.salonId, professionalId: selected.professionalId, status: "WAITING", fromDate: { lte: date }, toDate: { gte: date }, startMinutes: { lte: minute }, endMinutes: { gt: minute } }, include: { services: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 201 });
  if (candidates.length > 200) throw new Error("Há mais de 200 pedidos compatíveis. Revise a fila antes de promover.");
  for (const candidate of candidates) {
    let fits = false;
    try {
      const inspected = await inspectAppointmentAvailability(tx, { salonId: ctx.salonId, professionalId: candidate.professionalId, serviceIds: candidate.services.map(s => s.serviceId), startLocal, enforceBookingWindow: true });
      fits = !inspected.violation && inspected.startAt > new Date() && dateKeyInTimeZone(new Date(+inspected.endAt - 1), inspected.timezone) === date && (dateKeyInTimeZone(inspected.endAt, inspected.timezone) !== date ? 1440 : wallClockMinutesInTimeZone(inspected.endAt, inspected.timezone)) <= candidate.endMinutes;
    } catch { fits = false; }
    if (!fits) continue;
    if (candidate.id !== id) throw new Error("Existe um pedido anterior compatível com este horário. Atenda primeiro a ordem da fila.");
    const result = await createAppointment(tx, { salonId: ctx.salonId, clientId: candidate.clientId, professionalId: candidate.professionalId, serviceIds: candidate.services.map(s => s.serviceId), startLocal, idempotencyKey: candidate.id, origin: "WAITLIST", enforceBookingWindow: true, enforcePlanLimits: true, actor: { type: "STAFF", id: ctx.userId, name: "Equipe" } });
    await tx.flexibleWaitlist.updateMany({ where: { id, salonId: ctx.salonId, status: "WAITING" }, data: { status: "FULFILLED", fulfilledAppointmentId: result.appointment.id } });
    await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "FLEXIBLE_WAITLIST_FULFILLED", entityType: "FlexibleWaitlist", entityId: id, metadata: { appointmentId: result.appointment.id } });
    return { appointmentId: result.appointment.id };
  }
  throw new Error("O horário não está disponível dentro das preferências deste pedido.");
}
