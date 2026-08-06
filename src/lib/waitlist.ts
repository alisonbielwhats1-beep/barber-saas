import type { Tx } from "./prisma-tenant";
import { randomUUID } from "node:crypto";
import { businessRecipients, recordAppointmentEvent } from "./appointment-events";

const WAITLIST_NOTE = "Confirmado automaticamente pela lista de espera.";

/**
 * Chamada pelo motor central depois de uma desistência do cliente e de
 * revalidar o intervalo (mesma transação). Se houver alguém esperando por
 * ESSE agendamento específico, cria automaticamente um novo Appointment pro
 * primeiro da fila e marca a entrada como cumprida.
 *
 * A confirmação grava evento e notificação interna idempotentes para cliente,
 * responsável e profissional, sem contratar canal pago.
 *
 * Lock por advisory lock (mesmo padrão de invitations.ts) pra dois
 * cancelamentos/retries concorrentes do mesmo agendamento não preencherem a
 * fila duas vezes.
 */
export async function fulfillWaitlistOnCancel(
  tx: Tx,
  appointmentId: string,
  salonId: string,
): Promise<{ appointmentId: string; clientId: string } | null> {
  await tx.$queryRaw`
    SELECT 1::integer AS "locked"
    FROM pg_advisory_xact_lock(
      hashtextextended(${`waitlist:${appointmentId}`}, 0)
    )
  `;

  const entry = await tx.waitlistEntry.findFirst({
    where: {
      appointmentId,
      salonId,
      fulfilledAt: null,
      OR: [
        { clientId: { not: null }, client: { is: { salonId } } },
        {
          clientId: null,
          guestName: { not: null },
          guestPhone: { not: null },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, clientId: true, guestName: true, guestPhone: true },
  });
  if (!entry) return null;

  const original = await tx.appointment.findFirst({
    where: { id: appointmentId, salonId },
    select: {
      serviceId: true,
      professionalId: true,
      startAt: true,
      endAt: true,
      priceCents: true,
      timezone: true,
      serviceItems: {
        orderBy: { position: "asc" },
        select: {
          serviceId: true,
          serviceName: true,
          durationMin: true,
          priceCents: true,
        },
      },
      service: {
        select: { id: true, name: true, durationMin: true, priceCents: true },
      },
    },
  });
  if (!original) return null;

  let clientId = entry.clientId;
  if (!clientId) {
    if (!entry.guestName) return null; // dado incompleto — não deveria acontecer
    const guest = await tx.clientProfile.create({
      data: { salonId, name: entry.guestName, phone: entry.guestPhone },
      select: { id: true },
    });
    clientId = guest.id;
  }

  const services = original.serviceItems.length > 0
    ? original.serviceItems
    : [{
        serviceId: original.service.id,
        serviceName: original.service.name,
        durationMin: original.service.durationMin,
        priceCents: original.service.priceCents,
      }];
  const idempotencyKey = `waitlist:${entry.id}`;
  const created = await tx.appointment.create({
    data: {
      salonId,
      clientId,
      serviceId: services[0]!.serviceId,
      professionalId: original.professionalId,
      startAt: original.startAt,
      endAt: original.endAt,
      priceCents: original.priceCents,
      status: "CONFIRMED",
      timezone: original.timezone,
      origin: "WAITLIST",
      idempotencyKey,
      idempotencyFingerprint: idempotencyKey,
      notes: WAITLIST_NOTE,
    },
    select: { id: true, clientId: true },
  });
  await tx.appointmentService.createMany({
    data: services.map((service, position) => ({
      appointmentId: created.id,
      salonId,
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
      position,
    })),
  });
  await tx.waitlistEntry.updateMany({
    where: { id: entry.id, salonId, fulfilledAt: null },
    data: { fulfilledAt: new Date(), fulfilledAppointmentId: created.id },
  });

  const business = await businessRecipients(tx, salonId, original.professionalId);
  const payload = {
    appointmentId: created.id,
    previousAppointmentId: appointmentId,
    eventType: "WAITLIST_FULFILLED",
    startAt: original.startAt.toISOString(),
    endAt: original.endAt.toISOString(),
    timezone: original.timezone,
    services: services.map((service) => service.serviceName),
  };
  await recordAppointmentEvent(tx, {
    salonId,
    appointmentId: created.id,
    eventType: "WAITLIST_FULFILLED",
    actor: { type: "SYSTEM", name: "Lista de espera" },
    correlationId: randomUUID(),
    idempotencyKey: `${idempotencyKey}:fulfilled`,
    requestFingerprint: idempotencyKey,
    newValue: payload,
    recipients: [{ type: "CLIENT", id: clientId }, ...business],
    template: "appointment.waitlist_fulfilled",
    payload,
  });
  return { appointmentId: created.id, clientId: created.clientId };
}
