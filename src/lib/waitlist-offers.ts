import { offerSnapshots, readOfferSnapshots } from "./offer-snapshot";
import { formatInTimeZone } from "date-fns-tz";
import type { Tx } from "./prisma-tenant";
import { lockOperationalResources } from "./inventory-lock";
import {
  createAppointment,
  inspectAppointmentAvailability,
} from "./appointment-service";

export async function respondToOffer(
  tx: Tx,
  salonId: string,
  clientId: string,
  id: string,
  accept: boolean,
) {
  const offer = await tx.waitlistOffer.findFirst({
    where: { id, salonId, waitlist: { clientId, salonId } },
  });
  if (!offer) throw new Error("Oferta não encontrada.");
  await lockOperationalResources(tx, {
    professionalIds: [offer.professionalId],
  });
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`offer-salon:${salonId}`},0))`;
  const fresh = await tx.waitlistOffer.findFirstOrThrow({
    where: { id, salonId },
    include: { waitlist: { include: { client: true } } },
  });
  if (fresh.status === "ACCEPTED")
    return { appointmentId: fresh.appointmentId };
  if (fresh.status !== "OFFERED")
    throw new Error("Esta oferta já foi encerrada.");
  if (fresh.expiresAt <= new Date() || fresh.startAt <= new Date()) {
    await tx.waitlistOffer.update({
      where: { id },
      data: { status: "EXPIRED" },
    });
    return { error: "O prazo acabou. A vaga foi liberada." };
  }
  if (!accept) {
    await tx.waitlistOffer.update({
      where: { id },
      data: { status: "DECLINED" },
    });
    return { declined: true };
  }
  if (fresh.waitlist.status !== "WAITING")
    throw new Error("Pedido retirado da fila.");
  // Libera apenas a própria oferta dentro da mesma transação/locks; rollback restaura a oferta se criar falhar.
  await tx.waitlistOffer.update({
    where: { id },
    data: { status: "ACCEPTED" },
  });
  const salon = await tx.salon.findUniqueOrThrow({
    where: { id: salonId },
    select: { timezone: true },
  });
  const startLocal = formatInTimeZone(
    fresh.startAt,
    salon.timezone,
    "yyyy-MM-dd'T'HH:mm",
  );
  const inspected = await inspectAppointmentAvailability(tx, {
    salonId,
    professionalId: fresh.professionalId,
    serviceIds: fresh.serviceIds,
    startLocal,
    enforceBookingWindow: true,
  });
  const resources = [
    ...new Set(
      inspected.services.flatMap((s) =>
        s.physicalResourceId ? [s.physicalResourceId] : [],
      ),
    ),
  ].sort();
  if (
    JSON.stringify(offerSnapshots(inspected.services)) !==
      JSON.stringify(readOfferSnapshots(fresh.serviceSnapshots)) ||
    inspected.violation ||
    +inspected.endAt !== +fresh.endAt ||
    inspected.services.reduce((n, s) => n + s.priceCents, 0) !==
      fresh.priceCents ||
    resources.join() !== [...fresh.resourceIds].sort().join()
  )
    throw new Error(
      "As condições mudaram. Peça ao estabelecimento uma nova oferta.",
    );
  const result = await createAppointment(tx, {
    salonId,
    clientId,
    professionalId: fresh.professionalId,
    serviceIds: fresh.serviceIds,
    startLocal,
    idempotencyKey: fresh.id,
    origin: "WAITLIST",
    enforceBookingWindow: true,
    enforcePlanLimits: true,
    actor: { type: "CLIENT", id: clientId, name: fresh.waitlist.client.name },
  });
  // O catálogo pode mudar entre a conferência e a criação. Validar os snapshots
  // realmente gravados antes de confirmar a transação mantém os termos aceitos.
  const bookedServices = await tx.appointmentService.findMany({
    where: { salonId, appointmentId: result.appointment.id },
    orderBy: { position: "asc" },
  });
  const bookedResources = await tx.resourceBooking.findMany({
    where: { salonId, appointmentId: result.appointment.id, active: true },
    select: { resourceId: true },
    orderBy: { resourceId: "asc" },
  });
  const bookedSnapshots = offerSnapshots(
    bookedServices.map((s) => ({ ...s, id: s.serviceId, name: s.serviceName })),
  );
  if (
    +result.appointment.endAt !== +fresh.endAt ||
    JSON.stringify(bookedSnapshots) !==
      JSON.stringify(readOfferSnapshots(fresh.serviceSnapshots)) ||
    bookedResources.map((r) => r.resourceId).join() !==
      [...fresh.resourceIds].sort().join()
  ) {
    throw new Error(
      "As condições mudaram. Peça ao estabelecimento uma nova oferta.",
    );
  }
  await tx.waitlistOffer.update({
    where: { id },
    data: { appointmentId: result.appointment.id },
  });
  await tx.flexibleWaitlist.updateMany({
    where: { id: fresh.waitlistId, salonId, status: "WAITING" },
    data: {
      status: "FULFILLED",
      fulfilledAppointmentId: result.appointment.id,
    },
  });
  return { appointmentId: result.appointment.id };
}
