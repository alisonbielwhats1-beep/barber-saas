import { createHash, randomUUID } from "node:crypto";
import { addMinutes } from "date-fns";
import type {
  AppointmentOrigin,
  AppointmentStatus,
  Prisma,
} from "@prisma/client";
import type { Tx } from "./prisma-tenant";
import { bufferedWindow, checkBookingWindow } from "./scheduling";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  AppointmentError,
  assertStatusTransition,
  checkClientChangePolicy,
  isActiveAppointmentStatus,
  isReschedulableAppointmentStatus,
  type AppointmentErrorCode,
} from "./appointment-domain";
import {
  InvalidTimeZoneError,
  InvalidWallClockError,
  dateKeyInTimeZone,
  localDateTimeToUtc,
  wallClockMinutesInTimeZone,
  weekdayInTimeZone,
} from "./time";
import {
  businessRecipients,
  recordAppointmentEvent,
  type AppointmentActor,
  type InternalNotificationRecipient,
} from "./appointment-events";
import { writeAuditLog } from "./audit";
import { fulfillWaitlistOnCancel } from "./waitlist";

type ServiceSnapshot = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};

type SalonSchedulingSettings = {
  timezone: string;
  minBookingLeadMinutes: number;
  maxBookingLeadDays: number;
  bufferMinutes: number;
  cancelPolicyHours: number;
};

export type AvailabilityViolation =
  | "TOO_SOON"
  | "TOO_FAR"
  | "OUTSIDE_WORKING_HOURS"
  | "PROFESSIONAL_UNAVAILABLE"
  | "SALON_CLOSED"
  | "SLOT_TAKEN";

type AppointmentIdentity =
  | { clientId: string; guest?: never }
  | { clientId?: never; guest: { name: string; phone: string | null } };

type CreateAppointmentInput = AppointmentIdentity & {
  salonId: string;
  professionalId: string;
  serviceIds: string[];
  startLocal: string;
  notes?: string | null;
  origin: AppointmentOrigin;
  actor: AppointmentActor;
  idempotencyKey: string;
  enforceBookingWindow: boolean;
  overrideReason?: string | null;
  canOverride?: boolean;
  seriesId?: string | null;
  idempotencyContext?: unknown;
  now?: Date;
};

export type AppointmentMutationResult = {
  appointment: {
    id: string;
    startAt: Date;
    endAt: Date;
    version: number;
    clientId: string;
    professionalId: string;
  };
  duplicate: boolean;
};

export type RescheduleAppointmentInput = {
  salonId: string;
  appointmentId: string;
  professionalId: string;
  /** Ausente significa preservar todos os snapshots de serviço atuais. */
  serviceIds?: string[];
  startLocal: string;
  notes?: string | null;
  actor: AppointmentActor;
  idempotencyKey: string;
  expectedVersion?: number;
  expectedClientId?: string;
  permittedProfessionalId?: string;
  enforceClientPolicy: boolean;
  overrideReason?: string | null;
  canOverride?: boolean;
  now?: Date;
};

export type CancelAppointmentInput = {
  salonId: string;
  appointmentId: string;
  actor: AppointmentActor;
  idempotencyKey: string;
  reason?: string | null;
  expectedVersion?: number;
  expectedClientId?: string;
  permittedProfessionalId?: string;
  enforceClientPolicy: boolean;
  now?: Date;
};

const ACTIVE_STATUSES = [...ACTIVE_APPOINTMENT_STATUSES];

function appointmentFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function lockMutationKeys(tx: Tx, keys: string[]): Promise<void> {
  const ordered = [...new Set(keys)].sort();
  for (const key of ordered) {
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${`appointment:${key}`}, 0))
    `;
  }
}

function normalizeServiceIds(serviceIds: string[]): string[] {
  const normalized = [...new Set(serviceIds.filter(Boolean))];
  if (normalized.length === 0 || normalized.length > 10) {
    throw new AppointmentError("SERVICE_INVALID");
  }
  return normalized;
}

async function loadSalon(tx: Tx, salonId: string): Promise<SalonSchedulingSettings> {
  const salon = await tx.salon.findUnique({
    where: { id: salonId },
    select: {
      timezone: true,
      minBookingLeadMinutes: true,
      maxBookingLeadDays: true,
      bufferMinutes: true,
      cancelPolicyHours: true,
    },
  });
  if (!salon) throw new AppointmentError("NOT_FOUND");
  return salon;
}

async function loadServiceSnapshots(
  tx: Tx,
  salonId: string,
  professionalId: string,
  rawServiceIds: string[],
): Promise<ServiceSnapshot[]> {
  const serviceIds = normalizeServiceIds(rawServiceIds);
  const services = await tx.service.findMany({
    where: { salonId, id: { in: serviceIds }, active: true },
    select: { id: true, name: true, durationMin: true, priceCents: true },
  });
  if (services.length !== serviceIds.length) {
    throw new AppointmentError("SERVICE_INVALID");
  }

  const links = await tx.professionalService.findMany({
    where: {
      serviceId: { in: serviceIds },
      professional: { id: professionalId, salonId, active: true },
    },
    select: { serviceId: true },
  });
  if (links.length !== serviceIds.length) {
    throw new AppointmentError("PRO_SERVICE_MISMATCH");
  }

  const byId = new Map(services.map((service) => [service.id, service]));
  return serviceIds.map((id) => byId.get(id)!);
}

async function assertHistoricalServicesCanMove(
  tx: Tx,
  input: {
    salonId: string;
    currentProfessionalId: string;
    targetProfessionalId: string;
    serviceIds: string[];
  },
): Promise<void> {
  const professional = await tx.professional.findFirst({
    where: {
      id: input.targetProfessionalId,
      salonId: input.salonId,
      active: true,
    },
    select: { id: true },
  });
  if (!professional) throw new AppointmentError("PRO_SERVICE_MISMATCH");

  // Um serviço pode ter sido desativado ou desvinculado depois da venda. Se
  // o profissional original continua ativo, a remarcação deve honrar o
  // snapshot contratado em vez de recalcular ou invalidar o histórico.
  if (input.targetProfessionalId === input.currentProfessionalId) return;

  const links = await tx.professionalService.findMany({
    where: {
      professionalId: input.targetProfessionalId,
      serviceId: { in: input.serviceIds },
    },
    select: { serviceId: true },
  });
  if (links.length !== input.serviceIds.length) {
    throw new AppointmentError("PRO_SERVICE_MISMATCH");
  }
}

function toAppointmentError(error: unknown): never {
  if (error instanceof AppointmentError) throw error;
  if (error instanceof InvalidTimeZoneError) {
    throw new AppointmentError("INVALID_TIMEZONE", error.message);
  }
  if (error instanceof InvalidWallClockError) {
    throw new AppointmentError("INVALID_LOCAL_TIME", error.message);
  }
  throw error;
}

async function availabilityViolation(
  tx: Tx,
  input: {
    salonId: string;
    professionalId: string;
    startAt: Date;
    endAt: Date;
    salon: SalonSchedulingSettings;
    excludeAppointmentId?: string;
    enforceBookingWindow: boolean;
    now?: Date;
  },
): Promise<AvailabilityViolation | null> {
  if (input.enforceBookingWindow) {
    const bookingWindow = checkBookingWindow(
      input.startAt,
      input.salon,
      input.now,
    );
    if (bookingWindow) return bookingWindow;
  }

  const startDate = dateKeyInTimeZone(input.startAt, input.salon.timezone);
  const endDate = dateKeyInTimeZone(
    new Date(input.endAt.getTime() - 1),
    input.salon.timezone,
  );
  if (startDate !== endDate) return "OUTSIDE_WORKING_HOURS";

  const weekday = weekdayInTimeZone(input.startAt, input.salon.timezone);
  const startMinutes = wallClockMinutesInTimeZone(input.startAt, input.salon.timezone);
  const endMinutes = wallClockMinutesInTimeZone(input.endAt, input.salon.timezone);
  const workingHours = await tx.workingHours.findMany({
    where: { salonId: input.salonId, professionalId: input.professionalId, weekday },
    select: { startMinutes: true, endMinutes: true },
  });
  const insideWorkingHours = workingHours.some(
    (working) =>
      startMinutes >= working.startMinutes && endMinutes <= working.endMinutes,
  );
  if (!insideWorkingHours) return "OUTSIDE_WORKING_HOURS";

  const closure = await tx.salonClosure.findFirst({
    where: {
      salonId: input.salonId,
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
    },
    select: { id: true },
  });
  if (closure) return "SALON_CLOSED";

  const timeOff = await tx.timeOff.findFirst({
    where: {
      professionalId: input.professionalId,
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
    },
    select: { id: true },
  });
  if (timeOff) return "PROFESSIONAL_UNAVAILABLE";

  const buffered = bufferedWindow(
    input.startAt,
    input.endAt,
    input.salon.bufferMinutes,
  );
  const conflict = await tx.appointment.findFirst({
    where: {
      salonId: input.salonId,
      professionalId: input.professionalId,
      ...(input.excludeAppointmentId
        ? { id: { not: input.excludeAppointmentId } }
        : {}),
      status: { in: ACTIVE_STATUSES },
      startAt: { lt: buffered.to },
      endAt: { gt: buffered.from },
    },
    select: { id: true },
  });
  return conflict ? "SLOT_TAKEN" : null;
}

export async function inspectAppointmentAvailability(
  tx: Tx,
  input: {
    salonId: string;
    professionalId: string;
    serviceIds: string[];
    startLocal: string;
    excludeAppointmentId?: string;
    enforceBookingWindow: boolean;
    now?: Date;
  },
): Promise<{
  violation: AvailabilityViolation | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  services: ServiceSnapshot[];
}> {
  try {
    const services = await loadServiceSnapshots(
      tx,
      input.salonId,
      input.professionalId,
      input.serviceIds,
    );
    return inspectAvailabilityUsingServices(tx, input, services);
  } catch (error) {
    return toAppointmentError(error);
  }
}

async function inspectAvailabilityUsingServices(
  tx: Tx,
  input: {
    salonId: string;
    professionalId: string;
    startLocal: string;
    excludeAppointmentId?: string;
    enforceBookingWindow: boolean;
    now?: Date;
  },
  services: ServiceSnapshot[],
): Promise<{
  violation: AvailabilityViolation | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  services: ServiceSnapshot[];
}> {
  try {
    const salon = await loadSalon(tx, input.salonId);
    const startAt = localDateTimeToUtc(input.startLocal, salon.timezone);
    const durationMin = services.reduce((sum, service) => sum + service.durationMin, 0);
    const endAt = addMinutes(startAt, durationMin);
    const violation = await availabilityViolation(tx, {
      ...input,
      salon,
      startAt,
      endAt,
    });
    return { violation, startAt, endAt, timezone: salon.timezone, services };
  } catch (error) {
    return toAppointmentError(error);
  }
}

function requireOverrideReason(input: {
  violation: AvailabilityViolation | null;
  canOverride?: boolean;
  overrideReason?: string | null;
}): { overridden: boolean; reason: string | null } {
  if (!input.violation) return { overridden: false, reason: null };
  // "Encaixe" significa aceitar sobreposição deliberada. Fechamento,
  // ausência do profissional e horário de trabalho continuam inegociáveis.
  if (input.violation !== "SLOT_TAKEN") {
    throw new AppointmentError(input.violation);
  }
  const reason = input.overrideReason?.trim() ?? "";
  if (!input.canOverride) throw new AppointmentError(input.violation);
  if (reason.length < 3) throw new AppointmentError("REASON_REQUIRED");
  return { overridden: true, reason };
}

async function recipientsForEvent(
  tx: Tx,
  input: {
    salonId: string;
    clientId: string;
    professionalId: string;
    actor: AppointmentActor;
  },
): Promise<InternalNotificationRecipient[]> {
  if (input.actor.type === "CLIENT" || input.actor.type === "GUEST") {
    const business = await businessRecipients(
      tx,
      input.salonId,
      input.professionalId,
      input.actor.type === "CLIENT" ? input.actor.id : null,
    );
    return input.actor.type === "CLIENT"
      ? [{ type: "CLIENT", id: input.clientId }, ...business]
      : business;
  }
  const business = await businessRecipients(
    tx,
    input.salonId,
    input.professionalId,
    input.actor.id,
  );
  return [{ type: "CLIENT", id: input.clientId }, ...business];
}

function eventPayload(input: {
  appointmentId: string;
  eventType: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  professionalId: string;
  services: ServiceSnapshot[];
  actor: AppointmentActor;
  previousStartAt?: Date;
}) {
  return {
    appointmentId: input.appointmentId,
    eventType: input.eventType,
    startAt: input.startAt.toISOString(),
    endAt: input.endAt.toISOString(),
    previousStartAt: input.previousStartAt?.toISOString() ?? null,
    timezone: input.timezone,
    professionalId: input.professionalId,
    services: input.services.map((service) => ({
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
    })),
    actor: {
      type: input.actor.type,
      id: input.actor.id ?? null,
      name: input.actor.name,
    },
  } satisfies Prisma.InputJsonValue;
}

export async function createAppointment(
  tx: Tx,
  input: CreateAppointmentInput,
): Promise<AppointmentMutationResult> {
  const serviceIds = normalizeServiceIds(input.serviceIds);
  const fingerprint = appointmentFingerprint({
    salonId: input.salonId,
    professionalId: input.professionalId,
    serviceIds,
    startLocal: input.startLocal,
    clientId: input.clientId ?? null,
    guest: input.guest ?? null,
    origin: input.origin,
    notes: input.notes ?? null,
    overrideReason: input.overrideReason?.trim() ?? null,
    actor: { type: input.actor.type, id: input.actor.id ?? null },
    context: input.idempotencyContext ?? null,
  });

  await lockMutationKeys(tx, [
    `idempotency:${input.salonId}:${input.idempotencyKey}`,
    `professional:${input.professionalId}`,
  ]);

  const existing = await tx.appointment.findUnique({
    where: {
      salonId_idempotencyKey: {
        salonId: input.salonId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      version: true,
      clientId: true,
      professionalId: true,
      idempotencyFingerprint: true,
    },
  });
  if (existing) {
    if (existing.idempotencyFingerprint !== fingerprint) {
      throw new AppointmentError("IDEMPOTENCY_MISMATCH");
    }
    return { appointment: existing, duplicate: true };
  }

  const inspected = await inspectAppointmentAvailability(tx, {
    salonId: input.salonId,
    professionalId: input.professionalId,
    serviceIds,
    startLocal: input.startLocal,
    enforceBookingWindow: input.enforceBookingWindow,
    now: input.now,
  });
  const override = requireOverrideReason({
    violation: inspected.violation,
    canOverride: input.canOverride,
    overrideReason: input.overrideReason,
  });

  let clientId = input.clientId;
  if (!clientId) {
    if (!("guest" in input) || !input.guest) {
      throw new AppointmentError("FORBIDDEN");
    }
    const guest = await tx.clientProfile.create({
      data: {
        salonId: input.salonId,
        name: input.guest.name,
        phone: input.guest.phone,
      },
      select: { id: true },
    });
    clientId = guest.id;
  } else {
    const owned = await tx.clientProfile.findFirst({
      where: { id: clientId, salonId: input.salonId },
      select: { id: true },
    });
    if (!owned) throw new AppointmentError("FORBIDDEN");
  }

  const priceCents = inspected.services.reduce(
    (sum, service) => sum + service.priceCents,
    0,
  );
  const appointment = await tx.appointment.create({
    data: {
      salonId: input.salonId,
      clientId,
      professionalId: input.professionalId,
      serviceId: inspected.services[0]!.id,
      startAt: inspected.startAt,
      endAt: inspected.endAt,
      priceCents,
      status: "CONFIRMED",
      timezone: inspected.timezone,
      origin: input.origin,
      idempotencyKey: input.idempotencyKey,
      idempotencyFingerprint: fingerprint,
      notes: input.notes ?? null,
      isOverbooked: inspected.violation === "SLOT_TAKEN" && override.overridden,
      seriesId: input.seriesId ?? null,
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      version: true,
      clientId: true,
      professionalId: true,
    },
  });

  await tx.appointmentService.createMany({
    data: inspected.services.map((service, position) => ({
      appointmentId: appointment.id,
      salonId: input.salonId,
      serviceId: service.id,
      position,
      serviceName: service.name,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
    })),
  });

  const correlationId = randomUUID();
  const recipients = await recipientsForEvent(tx, {
    salonId: input.salonId,
    clientId,
    professionalId: input.professionalId,
    actor: input.actor,
  });
  const payload = eventPayload({
    appointmentId: appointment.id,
    eventType: "CREATED",
    startAt: inspected.startAt,
    endAt: inspected.endAt,
    timezone: inspected.timezone,
    professionalId: input.professionalId,
    services: inspected.services,
    actor: input.actor,
  });
  await recordAppointmentEvent(tx, {
    salonId: input.salonId,
    appointmentId: appointment.id,
    eventType: "CREATED",
    actor: input.actor,
    correlationId,
    idempotencyKey: `${input.idempotencyKey}:created`,
    requestFingerprint: fingerprint,
    reason: override.reason,
    newValue: payload,
    recipients,
    template: "appointment.created",
    payload,
  });

  if (override.overridden) {
    await writeAuditLog(tx, {
      salonId: input.salonId,
      userId: input.actor.id ?? null,
      actorName: input.actor.name,
      action: "APPOINTMENT_OVERRIDE_CREATE",
      entityType: "Appointment",
      entityId: appointment.id,
      reason: override.reason,
      metadata: {
        violation: inspected.violation,
        professionalId: input.professionalId,
        startAt: inspected.startAt.toISOString(),
      },
    });
  }

  return { appointment, duplicate: false };
}

async function loadMutableAppointment(tx: Tx, salonId: string, appointmentId: string) {
  return tx.appointment.findFirst({
    where: { id: appointmentId, salonId },
    select: {
      id: true,
      salonId: true,
      clientId: true,
      professionalId: true,
      serviceId: true,
      startAt: true,
      endAt: true,
      status: true,
      timezone: true,
      priceCents: true,
      notes: true,
      version: true,
      products: { select: { productId: true, quantity: true } },
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
}

function assertMutationOwnership(
  appointment: { clientId: string; professionalId: string },
  input: { expectedClientId?: string; permittedProfessionalId?: string },
) {
  if (input.expectedClientId && appointment.clientId !== input.expectedClientId) {
    throw new AppointmentError("FORBIDDEN");
  }
  if (
    input.permittedProfessionalId &&
    appointment.professionalId !== input.permittedProfessionalId
  ) {
    throw new AppointmentError("FORBIDDEN");
  }
}

function assertVersion(current: number, expected?: number) {
  if (expected !== undefined && current !== expected) {
    throw new AppointmentError("VERSION_CONFLICT");
  }
}

function previousServices(
  appointment: Awaited<ReturnType<typeof loadMutableAppointment>> & {},
): ServiceSnapshot[] {
  if (appointment.serviceItems.length > 0) {
    return appointment.serviceItems.map((item) => ({
      id: item.serviceId,
      name: item.serviceName,
      durationMin: item.durationMin,
      priceCents: item.priceCents,
    }));
  }
  return [appointment.service];
}

export async function rescheduleAppointment(
  tx: Tx,
  input: RescheduleAppointmentInput,
): Promise<AppointmentMutationResult> {
  // Defesa em profundidade: quando a chamada está limitada ao profissional
  // autenticado, tanto o atendimento atual quanto o destino precisam ser
  // dele. Validar apenas a origem permitiria transferir o atendimento para
  // outro profissional por uma chamada forjada à Server Action.
  if (
    input.permittedProfessionalId &&
    input.professionalId !== input.permittedProfessionalId
  ) {
    throw new AppointmentError("FORBIDDEN");
  }
  const eventKey = `${input.idempotencyKey}:rescheduled`;
  const firstRead = await loadMutableAppointment(tx, input.salonId, input.appointmentId);
  if (!firstRead) throw new AppointmentError("NOT_FOUND");
  await lockMutationKeys(tx, [
    `appointment:${input.appointmentId}`,
    `professional:${firstRead.professionalId}`,
    `professional:${input.professionalId}`,
  ]);

  const appointment = await loadMutableAppointment(tx, input.salonId, input.appointmentId);
  if (!appointment) throw new AppointmentError("NOT_FOUND");
  assertMutationOwnership(appointment, input);
  const serviceIds = input.serviceIds
    ? normalizeServiceIds(input.serviceIds)
    : previousServices(appointment).map((service) => service.id);
  const fingerprint = appointmentFingerprint({
    appointmentId: input.appointmentId,
    professionalId: input.professionalId,
    serviceIds,
    startLocal: input.startLocal,
    notes: input.notes ?? null,
    overrideReason: input.overrideReason?.trim() ?? null,
    actor: { type: input.actor.type, id: input.actor.id ?? null },
    expectedVersion: input.expectedVersion ?? null,
  });

  const previousEvent = await tx.appointmentEvent.findUnique({
    where: {
      appointmentId_idempotencyKey: {
        appointmentId: appointment.id,
        idempotencyKey: eventKey,
      },
    },
    select: { id: true, requestFingerprint: true },
  });
  if (previousEvent) {
    if (previousEvent.requestFingerprint !== fingerprint) {
      throw new AppointmentError("IDEMPOTENCY_MISMATCH");
    }
    return { appointment, duplicate: true };
  }
  assertVersion(appointment.version, input.expectedVersion);
  if (!isActiveAppointmentStatus(appointment.status)) {
    throw new AppointmentError("ALREADY_CLOSED");
  }
  const now = input.now ?? new Date();
  if (
    !isReschedulableAppointmentStatus(appointment.status) ||
    appointment.startAt.getTime() <= now.getTime()
  ) {
    throw new AppointmentError("ALREADY_STARTED");
  }

  const salon = await loadSalon(tx, input.salonId);
  if (input.enforceClientPolicy) {
    const policy = checkClientChangePolicy({
      status: appointment.status,
      startAt: appointment.startAt,
      cancelPolicyHours: salon.cancelPolicyHours,
      now: input.now,
    });
    if (!policy.allowed) throw new AppointmentError(policy.code);
  }

  const previousServiceSnapshots = previousServices(appointment);
  const preservesExistingServices =
    previousServiceSnapshots.length === serviceIds.length &&
    previousServiceSnapshots.every((service) => serviceIds.includes(service.id));
  let schedulingSnapshots: ServiceSnapshot[];
  if (preservesExistingServices) {
    await assertHistoricalServicesCanMove(tx, {
      salonId: input.salonId,
      currentProfessionalId: appointment.professionalId,
      targetProfessionalId: input.professionalId,
      serviceIds,
    });
    schedulingSnapshots = previousServiceSnapshots;
  } else {
    schedulingSnapshots = await loadServiceSnapshots(
      tx,
      input.salonId,
      input.professionalId,
      serviceIds,
    );
  }
  const inspected = await inspectAvailabilityUsingServices(tx, {
    salonId: input.salonId,
    professionalId: input.professionalId,
    startLocal: input.startLocal,
    excludeAppointmentId: appointment.id,
    enforceBookingWindow: input.enforceClientPolicy,
    now: input.now,
  }, schedulingSnapshots);
  const override = requireOverrideReason({
    violation: inspected.violation,
    canOverride: input.canOverride,
    overrideReason: input.overrideReason,
  });
  const newPrice = inspected.services.reduce(
    (sum, service) => sum + service.priceCents,
    0,
  );

  const updated = await tx.appointment.updateMany({
    where: {
      id: appointment.id,
      salonId: input.salonId,
      version: appointment.version,
      status: { in: ACTIVE_STATUSES },
    },
    data: {
      serviceId: inspected.services[0]!.id,
      professionalId: input.professionalId,
      startAt: inspected.startAt,
      endAt: inspected.endAt,
      priceCents: newPrice,
      timezone: inspected.timezone,
      status: "CONFIRMED",
      reminderSentAt: null,
      notes: input.notes === undefined ? appointment.notes : input.notes,
      version: { increment: 1 },
      isOverbooked: inspected.violation === "SLOT_TAKEN" && override.overridden,
    },
  });
  if (updated.count !== 1) throw new AppointmentError("VERSION_CONFLICT");

  await tx.appointmentService.deleteMany({
    where: { appointmentId: appointment.id, salonId: input.salonId },
  });
  await tx.appointmentService.createMany({
    data: inspected.services.map((service, position) => ({
      appointmentId: appointment.id,
      salonId: input.salonId,
      serviceId: service.id,
      position,
      serviceName: service.name,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
    })),
  });

  const recipients = await recipientsForEvent(tx, {
    salonId: input.salonId,
    clientId: appointment.clientId,
    professionalId: input.professionalId,
    actor: input.actor,
  });
  const oldServices = previousServiceSnapshots;
  const previousValue = eventPayload({
    appointmentId: appointment.id,
    eventType: "RESCHEDULED",
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    timezone: appointment.timezone,
    professionalId: appointment.professionalId,
    services: oldServices,
    actor: input.actor,
  });
  const payload = eventPayload({
    appointmentId: appointment.id,
    eventType: "RESCHEDULED",
    startAt: inspected.startAt,
    endAt: inspected.endAt,
    previousStartAt: appointment.startAt,
    timezone: inspected.timezone,
    professionalId: input.professionalId,
    services: inspected.services,
    actor: input.actor,
  });
  await recordAppointmentEvent(tx, {
    salonId: input.salonId,
    appointmentId: appointment.id,
    eventType: "RESCHEDULED",
    actor: input.actor,
    correlationId: randomUUID(),
    idempotencyKey: eventKey,
    requestFingerprint: fingerprint,
    reason: override.reason,
    previousValue,
    newValue: payload,
    recipients,
    template: "appointment.rescheduled",
    payload,
  });

  if (override.overridden) {
    await writeAuditLog(tx, {
      salonId: input.salonId,
      userId: input.actor.id ?? null,
      actorName: input.actor.name,
      action: "APPOINTMENT_OVERRIDE_RESCHEDULE",
      entityType: "Appointment",
      entityId: appointment.id,
      reason: override.reason,
      metadata: { violation: inspected.violation },
    });
  }

  return {
    appointment: {
      id: appointment.id,
      startAt: inspected.startAt,
      endAt: inspected.endAt,
      version: appointment.version + 1,
      clientId: appointment.clientId,
      professionalId: input.professionalId,
    },
    duplicate: false,
  };
}

export async function cancelAppointmentReliably(
  tx: Tx,
  input: CancelAppointmentInput,
): Promise<AppointmentMutationResult> {
  const fingerprint = appointmentFingerprint({
    appointmentId: input.appointmentId,
    reason: input.reason?.trim() ?? null,
    actor: { type: input.actor.type, id: input.actor.id ?? null },
    expectedVersion: input.expectedVersion ?? null,
  });
  const firstRead = await loadMutableAppointment(tx, input.salonId, input.appointmentId);
  if (!firstRead) throw new AppointmentError("NOT_FOUND");
  await lockMutationKeys(tx, [
    `appointment:${input.appointmentId}`,
    `professional:${firstRead.professionalId}`,
  ]);

  const appointment = await loadMutableAppointment(tx, input.salonId, input.appointmentId);
  if (!appointment) throw new AppointmentError("NOT_FOUND");
  assertMutationOwnership(appointment, input);

  const eventKey = `${input.idempotencyKey}:cancelled`;
  const previousEvent = await tx.appointmentEvent.findUnique({
    where: {
      appointmentId_idempotencyKey: {
        appointmentId: appointment.id,
        idempotencyKey: eventKey,
      },
    },
    select: { id: true, requestFingerprint: true },
  });
  if (previousEvent) {
    if (previousEvent.requestFingerprint !== fingerprint) {
      throw new AppointmentError("IDEMPOTENCY_MISMATCH");
    }
    return { appointment, duplicate: true };
  }
  assertVersion(appointment.version, input.expectedVersion);
  if (!isActiveAppointmentStatus(appointment.status)) {
    throw new AppointmentError("ALREADY_CLOSED");
  }

  const now = input.now ?? new Date();
  if (appointment.startAt.getTime() <= now.getTime()) {
    throw new AppointmentError("ALREADY_STARTED");
  }

  const reason = input.reason?.trim() ?? "";
  if (input.actor.type === "STAFF" && reason.length < 3) {
    throw new AppointmentError("REASON_REQUIRED");
  }
  const salon = await loadSalon(tx, input.salonId);
  if (input.enforceClientPolicy) {
    const policy = checkClientChangePolicy({
      status: appointment.status,
      startAt: appointment.startAt,
      cancelPolicyHours: salon.cancelPolicyHours,
      now: input.now,
    });
    if (!policy.allowed) throw new AppointmentError(policy.code);
  }

  const updated = await tx.appointment.updateMany({
    where: {
      id: appointment.id,
      salonId: input.salonId,
      version: appointment.version,
      status: { in: ACTIVE_STATUSES },
    },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      cancelledReason: reason || null,
      cancelledByType: input.actor.type,
      cancelledById: input.actor.id ?? null,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new AppointmentError("VERSION_CONFLICT");

  // Produtos são reservados no agendamento atual. O lock + mudança de status
  // condicionada garante que o estoque seja devolvido exatamente uma vez.
  for (const product of appointment.products) {
    await tx.product.updateMany({
      where: { id: product.productId, salonId: input.salonId },
      data: { stock: { increment: product.quantity } },
    });
  }

  const services = previousServices(appointment);
  const recipients = await recipientsForEvent(tx, {
    salonId: input.salonId,
    clientId: appointment.clientId,
    professionalId: appointment.professionalId,
    actor: input.actor,
  });
  const previousValue = eventPayload({
    appointmentId: appointment.id,
    eventType: "CANCELLED",
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    timezone: appointment.timezone,
    professionalId: appointment.professionalId,
    services,
    actor: input.actor,
  });
  const payload = {
    ...previousValue,
    status: "CANCELLED",
    reason: reason || null,
  } satisfies Prisma.InputJsonValue;
  await recordAppointmentEvent(tx, {
    salonId: input.salonId,
    appointmentId: appointment.id,
    eventType: "CANCELLED",
    actor: input.actor,
    correlationId: randomUUID(),
    idempotencyKey: eventKey,
    requestFingerprint: fingerprint,
    reason: reason || null,
    previousValue,
    newValue: payload,
    recipients,
    template: "appointment.cancelled",
    payload,
  });

  // Cancelamento do estabelecimento costuma significar que o horário não
  // deve ser ocupado (ausência, fechamento etc.). A fila só preenche
  // automaticamente uma desistência do cliente e apenas se o intervalo ainda
  // passar por todas as regras de disponibilidade.
  if (input.actor.type === "CLIENT" || input.actor.type === "GUEST") {
    const releasedSlotViolation = await availabilityViolation(tx, {
      salonId: input.salonId,
      professionalId: appointment.professionalId,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      salon,
      excludeAppointmentId: appointment.id,
      enforceBookingWindow: false,
      now: input.now,
    });
    if (!releasedSlotViolation) {
      await fulfillWaitlistOnCancel(tx, appointment.id, input.salonId);
    }
  }

  return {
    appointment: {
      id: appointment.id,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      version: appointment.version + 1,
      clientId: appointment.clientId,
      professionalId: appointment.professionalId,
    },
    duplicate: false,
  };
}

export async function updateAppointmentStatusReliably(
  tx: Tx,
  input: {
    salonId: string;
    appointmentId: string;
    status: AppointmentStatus;
    actor: AppointmentActor;
    idempotencyKey: string;
    reason?: string | null;
    expectedVersion?: number;
    permittedProfessionalId?: string;
    idempotencyContext?: unknown;
    now?: Date;
  },
): Promise<AppointmentMutationResult> {
  if (input.status === "CANCELLED") {
    return cancelAppointmentReliably(tx, {
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      actor: input.actor,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      expectedVersion: input.expectedVersion,
      permittedProfessionalId: input.permittedProfessionalId,
      enforceClientPolicy: false,
      now: input.now,
    });
  }

  const firstRead = await loadMutableAppointment(tx, input.salonId, input.appointmentId);
  if (!firstRead) throw new AppointmentError("NOT_FOUND");
  await lockMutationKeys(tx, [
    `appointment:${input.appointmentId}`,
    `professional:${firstRead.professionalId}`,
  ]);
  const appointment = await loadMutableAppointment(tx, input.salonId, input.appointmentId);
  if (!appointment) throw new AppointmentError("NOT_FOUND");
  assertMutationOwnership(appointment, {
    permittedProfessionalId: input.permittedProfessionalId,
  });

  const eventKey = `${input.idempotencyKey}:status:${input.status}`;
  const fingerprint = appointmentFingerprint({
    appointmentId: input.appointmentId,
    status: input.status,
    reason: input.reason?.trim() ?? null,
    actor: { type: input.actor.type, id: input.actor.id ?? null },
    expectedVersion: input.expectedVersion ?? null,
    context: input.idempotencyContext ?? null,
  });
  const previousEvent = await tx.appointmentEvent.findUnique({
    where: {
      appointmentId_idempotencyKey: {
        appointmentId: appointment.id,
        idempotencyKey: eventKey,
      },
    },
    select: { id: true, requestFingerprint: true },
  });
  if (previousEvent) {
    if (previousEvent.requestFingerprint !== fingerprint) {
      throw new AppointmentError("IDEMPOTENCY_MISMATCH");
    }
    return { appointment, duplicate: true };
  }
  assertVersion(appointment.version, input.expectedVersion);
  if (appointment.status === input.status) {
    if (!isActiveAppointmentStatus(appointment.status)) {
      throw new AppointmentError("ALREADY_CLOSED");
    }
    return { appointment, duplicate: true };
  }
  assertStatusTransition(appointment.status, input.status);
  if (input.status === "NO_SHOW" && appointment.startAt > (input.now ?? new Date())) {
    throw new AppointmentError("ALREADY_STARTED", "Não é possível marcar falta antes do horário.");
  }

  const updated = await tx.appointment.updateMany({
    where: {
      id: appointment.id,
      salonId: input.salonId,
      version: appointment.version,
      status: appointment.status,
    },
    data: { status: input.status, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new AppointmentError("VERSION_CONFLICT");

  const services = previousServices(appointment);
  const recipients = await recipientsForEvent(tx, {
    salonId: input.salonId,
    clientId: appointment.clientId,
    professionalId: appointment.professionalId,
    actor: input.actor,
  });
  const payload = {
    appointmentId: appointment.id,
    eventType: "STATUS_CHANGED",
    previousStatus: appointment.status,
    status: input.status,
    startAt: appointment.startAt.toISOString(),
    timezone: appointment.timezone,
    services: services.map((service) => service.name),
    actor: input.actor,
  } satisfies Prisma.InputJsonValue;
  await recordAppointmentEvent(tx, {
    salonId: input.salonId,
    appointmentId: appointment.id,
    eventType: "STATUS_CHANGED",
    actor: input.actor,
    correlationId: randomUUID(),
    idempotencyKey: eventKey,
    requestFingerprint: fingerprint,
    reason: input.reason ?? null,
    previousValue: { status: appointment.status },
    newValue: payload,
    recipients,
    template: "appointment.status_changed",
    payload,
  });

  return {
    appointment: {
      id: appointment.id,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      version: appointment.version + 1,
      clientId: appointment.clientId,
      professionalId: appointment.professionalId,
    },
    duplicate: false,
  };
}

export function appointmentErrorStatus(code: AppointmentErrorCode): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "FORBIDDEN") return 403;
  if (
    code === "SERVICE_INVALID" ||
    code === "PRO_SERVICE_MISMATCH" ||
    code === "INVALID_LOCAL_TIME" ||
    code === "INVALID_TIMEZONE" ||
    code === "REASON_REQUIRED"
  ) {
    return 400;
  }
  return 409;
}
