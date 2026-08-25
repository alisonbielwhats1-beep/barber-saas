import { randomUUID } from "node:crypto";
import type { AppointmentActorType } from "@prisma/client";
import type { Tx } from "./prisma-tenant";
import { businessRecipients, recordAppointmentEvent } from "./appointment-events";
import { clientIdentityData } from "./client-identity";
import { inferGenderFromName } from "./name-gender";

const WAITLIST_NOTE = "Confirmado automaticamente pela lista de espera.";

export type ReleasedAppointmentSlot = {
  serviceId: string;
  professionalId: string;
  startAt: Date;
  endAt: Date;
  priceCents: number;
  timezone: string;
  services: Array<{
    serviceId: string;
    serviceName: string;
    durationMin: number;
    priceCents: number;
  }>;
};

export type WaitlistErrorCode =
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "GUEST_DATA_REQUIRED"
  | "FORBIDDEN"
  | "ALREADY_FULFILLED"
  | "SERVICE_INVALID"
  | "PRO_SERVICE_MISMATCH";

export class WaitlistError extends Error {
  constructor(public readonly code: WaitlistErrorCode) {
    super(code);
    this.name = "WaitlistError";
  }
}

export function isWaitlistError(error: unknown): error is WaitlistError {
  return error instanceof WaitlistError;
}

async function lockWaitlist(tx: Tx, appointmentId: string) {
  await tx.$queryRaw`
    SELECT 1::integer AS "locked"
    FROM pg_advisory_xact_lock(
      hashtextextended(${`waitlist:${appointmentId}`}, 0)
    )
  `;
}

async function waitlistPosition(tx: Tx, input: {
  salonId: string;
  appointmentId: string;
  entryId: string;
}): Promise<number> {
  const entries = await tx.waitlistEntry.findMany({
    where: {
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      fulfilledAt: null,
      cancelledAt: null,
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const index = entries.findIndex((entry) => entry.id === input.entryId);
  if (index < 0) throw new WaitlistError("NOT_FOUND");
  return index + 1;
}

/**
 * Entrada idempotente e serializada na fila. O lock protege o check + insert;
 * os indices parciais da migration 009 repetem a garantia no banco.
 */
export async function joinWaitlist(
  tx: Tx,
  input: {
    salonId: string;
    appointmentId: string;
    professionalId: string;
    serviceIds: string[];
    clientId?: string | null;
    guestName?: string | null;
    guestPhone?: string | null;
  },
): Promise<{
  entryId: string;
  position: number;
  duplicate: boolean;
  serviceNames: string[];
  professionalId: string;
  startAt: Date;
  timezone: string;
}> {
  await lockWaitlist(tx, input.appointmentId);

  const appointment = await tx.appointment.findFirst({
    where: {
      id: input.appointmentId,
      salonId: input.salonId,
      professionalId: input.professionalId,
      status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      startAt: { gt: new Date() },
      professional: { active: true },
    },
    select: { id: true, startAt: true, timezone: true },
  });
  if (!appointment) throw new WaitlistError("NOT_FOUND");

  const serviceIds = [...new Set(input.serviceIds)];
  if (serviceIds.length === 0 || serviceIds.length > 10) {
    throw new WaitlistError("SERVICE_INVALID");
  }
  const requestedServices = await tx.service.findMany({
    where: {
      id: { in: serviceIds },
      salonId: input.salonId,
      active: true,
      professionals: { some: { professionalId: input.professionalId } },
    },
    select: { id: true, name: true, durationMin: true, priceCents: true },
  });
  if (requestedServices.length !== serviceIds.length) {
    const existingServices = await tx.service.count({
      where: { id: { in: serviceIds }, salonId: input.salonId, active: true },
    });
    throw new WaitlistError(
      existingServices === serviceIds.length ? "PRO_SERVICE_MISMATCH" : "SERVICE_INVALID",
    );
  }
  const servicesById = new Map(requestedServices.map((service) => [service.id, service]));
  const serviceSnapshots = serviceIds.map((serviceId) => {
    const service = servicesById.get(serviceId)!;
    return {
      serviceId: service.id,
      serviceName: service.name,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
    };
  });
  const durationMin = serviceSnapshots.reduce((total, service) => total + service.durationMin, 0);
  const priceCents = serviceSnapshots.reduce((total, service) => total + service.priceCents, 0);
  const endAt = new Date(appointment.startAt.getTime() + durationMin * 60_000);

  const clientId = input.clientId ?? null;
  if (clientId) {
    const client = await tx.clientProfile.findFirst({
      where: { id: clientId, salonId: input.salonId },
      select: { id: true },
    });
    if (!client) throw new WaitlistError("AUTH_REQUIRED");
  } else if (!input.guestName || !input.guestPhone) {
    throw new WaitlistError("GUEST_DATA_REQUIRED");
  }

  const existing = await tx.waitlistEntry.findFirst({
    where: {
      salonId: input.salonId,
      appointmentId: appointment.id,
      fulfilledAt: null,
      cancelledAt: null,
      ...(clientId
        ? { clientId }
        : { clientId: null, guestPhone: input.guestPhone! }),
    },
    select: {
      id: true,
      professionalId: true,
      startAt: true,
      timezone: true,
      serviceSnapshots: true,
    },
  });
  const entry = existing ?? await tx.waitlistEntry.create({
    data: {
      salonId: input.salonId,
      appointmentId: appointment.id,
      clientId,
      guestName: clientId ? null : input.guestName,
      guestPhone: clientId ? null : input.guestPhone,
      professionalId: input.professionalId,
      startAt: appointment.startAt,
      endAt,
      timezone: appointment.timezone,
      serviceSnapshots,
      priceCents,
    },
    select: {
      id: true,
      professionalId: true,
      startAt: true,
      timezone: true,
      serviceSnapshots: true,
    },
  });
  const persistedServices = serviceSnapshotsFromJson(entry.serviceSnapshots) ?? serviceSnapshots;

  return {
    entryId: entry.id,
    position: await waitlistPosition(tx, {
      salonId: input.salonId,
      appointmentId: appointment.id,
      entryId: entry.id,
    }),
    duplicate: Boolean(existing),
    serviceNames: persistedServices.map((service) => service.serviceName),
    professionalId: entry.professionalId,
    startAt: entry.startAt,
    timezone: entry.timezone,
  };
}

/** Cancela uma unica entrada sem alterar o agendamento confirmado. */
export async function cancelWaitlistEntry(
  tx: Tx,
  input: {
    salonId: string;
    entryId: string;
    actorType: AppointmentActorType;
    actorId?: string | null;
    expectedClientId?: string;
    reason?: string | null;
  },
): Promise<{ appointmentId: string; duplicate: boolean }> {
  const firstRead = await tx.waitlistEntry.findFirst({
    where: { id: input.entryId, salonId: input.salonId },
    select: { appointmentId: true },
  });
  if (!firstRead) throw new WaitlistError("NOT_FOUND");
  await lockWaitlist(tx, firstRead.appointmentId);

  const entry = await tx.waitlistEntry.findFirst({
    where: { id: input.entryId, salonId: input.salonId },
    select: {
      appointmentId: true,
      clientId: true,
      fulfilledAt: true,
      cancelledAt: true,
    },
  });
  if (!entry) throw new WaitlistError("NOT_FOUND");
  if (input.expectedClientId && entry.clientId !== input.expectedClientId) {
    throw new WaitlistError("FORBIDDEN");
  }
  if (entry.fulfilledAt) throw new WaitlistError("ALREADY_FULFILLED");
  if (entry.cancelledAt) {
    return { appointmentId: entry.appointmentId, duplicate: true };
  }

  const updated = await tx.waitlistEntry.updateMany({
    where: {
      id: input.entryId,
      salonId: input.salonId,
      fulfilledAt: null,
      cancelledAt: null,
    },
    data: {
      cancelledAt: new Date(),
      cancelledByType: input.actorType,
      cancelledById: input.actorId ?? null,
      cancelledReason: input.reason?.trim() || null,
    },
  });
  if (updated.count !== 1) throw new WaitlistError("ALREADY_FULFILLED");
  return { appointmentId: entry.appointmentId, duplicate: false };
}

/**
 * Encerra a fila inteira quando o próprio estabelecimento cancela o horário.
 * Nada é promovido e nenhuma entrada continua aparecendo como espera ativa.
 */
export async function cancelActiveWaitlistForAppointment(
  tx: Tx,
  input: {
    salonId: string;
    appointmentId: string;
    actorId?: string | null;
    reason: string;
    cancelledAt?: Date;
  },
): Promise<number> {
  await lockWaitlist(tx, input.appointmentId);
  const updated = await tx.waitlistEntry.updateMany({
    where: {
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      fulfilledAt: null,
      cancelledAt: null,
    },
    data: {
      cancelledAt: input.cancelledAt ?? new Date(),
      cancelledByType: "STAFF",
      cancelledById: input.actorId ?? null,
      cancelledReason: input.reason.trim() || "Agendamento cancelado pelo estabelecimento",
    },
  });
  return updated.count;
}

function serviceSnapshotsFromJson(value: unknown): ReleasedAppointmentSlot["services"] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const services = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.serviceId !== "string" ||
      typeof candidate.serviceName !== "string" ||
      !Number.isInteger(candidate.durationMin) ||
      (candidate.durationMin as number) <= 0 ||
      !Number.isInteger(candidate.priceCents) ||
      (candidate.priceCents as number) < 0
    ) {
      return null;
    }
    return {
      serviceId: candidate.serviceId,
      serviceName: candidate.serviceName,
      durationMin: candidate.durationMin as number,
      priceCents: candidate.priceCents as number,
    };
  });
  return services.every((service) => service !== null)
    ? services as ReleasedAppointmentSlot["services"]
    : null;
}

/** Retorna o pedido do primeiro da fila para validação de disponibilidade. */
export async function nextWaitlistSlot(
  tx: Tx,
  appointmentId: string,
  salonId: string,
  legacyFallback?: ReleasedAppointmentSlot,
): Promise<ReleasedAppointmentSlot | null> {
  await lockWaitlist(tx, appointmentId);
  const entry = await tx.waitlistEntry.findFirst({
    where: {
      appointmentId,
      salonId,
      fulfilledAt: null,
      cancelledAt: null,
      OR: [
        { clientId: { not: null }, client: { is: { salonId } } },
        {
          clientId: null,
          guestName: { not: null },
          guestPhone: { not: null },
        },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      professionalId: true,
      startAt: true,
      endAt: true,
      timezone: true,
      serviceSnapshots: true,
      priceCents: true,
    },
  });
  if (!entry) return null;
  const services = serviceSnapshotsFromJson(entry.serviceSnapshots);
  if (
    !services ||
    !entry.professionalId ||
    !(entry.startAt instanceof Date) ||
    !(entry.endAt instanceof Date) ||
    entry.startAt >= entry.endAt ||
    !entry.timezone ||
    !Number.isInteger(entry.priceCents) ||
    entry.priceCents < 0
  ) {
    return legacyFallback ?? loadReleasedSlot(tx, appointmentId, salonId);
  }
  return {
    serviceId: services[0]!.serviceId,
    professionalId: entry.professionalId,
    startAt: entry.startAt,
    endAt: entry.endAt,
    priceCents: entry.priceCents,
    timezone: entry.timezone,
    services,
  };
}

async function loadReleasedSlot(
  tx: Tx,
  appointmentId: string,
  salonId: string,
): Promise<ReleasedAppointmentSlot | null> {
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
  return {
    serviceId: original.serviceId,
    professionalId: original.professionalId,
    startAt: original.startAt,
    endAt: original.endAt,
    priceCents: original.priceCents,
    timezone: original.timezone,
    services: original.serviceItems.length > 0
      ? original.serviceItems
      : [{
          serviceId: original.service.id,
          serviceName: original.service.name,
          durationMin: original.service.durationMin,
          priceCents: original.service.priceCents,
        }],
  };
}

/**
 * Promove atomicamente apenas o primeiro cliente e encadeia os demais na nova
 * reserva. Assim, se a pessoa promovida cancelar depois, o proximo continua
 * ligado ao mesmo slot e a ordem original e preservada.
 */
export async function fulfillWaitlistOnCancel(
  tx: Tx,
  appointmentId: string,
  salonId: string,
  releasedSlot?: ReleasedAppointmentSlot,
): Promise<{ appointmentId: string; clientId: string } | null> {
  await lockWaitlist(tx, appointmentId);

  const entry = await tx.waitlistEntry.findFirst({
    where: {
      appointmentId,
      salonId,
      fulfilledAt: null,
      cancelledAt: null,
      OR: [
        { clientId: { not: null }, client: { is: { salonId } } },
        {
          clientId: null,
          guestName: { not: null },
          guestPhone: { not: null },
        },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      clientId: true,
      guestName: true,
      guestPhone: true,
      professionalId: true,
      startAt: true,
      endAt: true,
      timezone: true,
      serviceSnapshots: true,
      priceCents: true,
    },
  });
  if (!entry) return null;

  const requestedServices = serviceSnapshotsFromJson(entry.serviceSnapshots);
  const original = releasedSlot ?? (requestedServices ? {
    serviceId: requestedServices[0]!.serviceId,
    professionalId: entry.professionalId,
    startAt: entry.startAt,
    endAt: entry.endAt,
    priceCents: entry.priceCents,
    timezone: entry.timezone,
    services: requestedServices,
  } : await loadReleasedSlot(tx, appointmentId, salonId));
  if (!original) return null;

  let clientId = entry.clientId;
  if (!clientId) {
    if (!entry.guestName) return null;
    const identity = clientIdentityData({ phone: entry.guestPhone });
    const guest = await tx.clientProfile.create({
      data: {
        salonId,
        name: entry.guestName,
        phone: identity.phone,
        phoneNormalized: identity.phoneNormalized,
        gender: inferGenderFromName(entry.guestName),
      },
      select: { id: true },
    });
    clientId = guest.id;
  }

  const idempotencyKey = `waitlist:${entry.id}`;
  const created = await tx.appointment.create({
    data: {
      salonId,
      clientId,
      serviceId: original.services[0]?.serviceId ?? original.serviceId,
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
    data: original.services.map((service, position) => ({
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
    where: {
      id: entry.id,
      salonId,
      appointmentId,
      fulfilledAt: null,
      cancelledAt: null,
    },
    data: { fulfilledAt: new Date(), fulfilledAppointmentId: created.id },
  });
  await tx.waitlistEntry.updateMany({
    where: {
      id: { not: entry.id },
      salonId,
      appointmentId,
      fulfilledAt: null,
      cancelledAt: null,
    },
    data: { appointmentId: created.id },
  });

  const business = await businessRecipients(tx, salonId, original.professionalId);
  const payload = {
    appointmentId: created.id,
    previousAppointmentId: appointmentId,
    eventType: "WAITLIST_FULFILLED",
    startAt: original.startAt.toISOString(),
    endAt: original.endAt.toISOString(),
    timezone: original.timezone,
    services: original.services.map((service) => service.serviceName),
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
