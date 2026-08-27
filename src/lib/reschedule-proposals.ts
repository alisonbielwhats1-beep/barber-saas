import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Tx } from "./prisma-tenant";
import {
  appointmentErrorStatus,
  inspectAppointmentAvailability,
  inspectAppointmentAvailabilityWithServiceSnapshots,
  lockAppointmentOperationalScope,
  rescheduleAppointment,
  type AppointmentMutationResult,
  type ServiceSnapshot,
} from "./appointment-service";
import { AppointmentError } from "./appointment-domain";
import {
  businessRecipients,
  recordAppointmentEvent,
  type AppointmentActor,
  type InternalNotificationRecipient,
} from "./appointment-events";
import { toLocalDateTime } from "./time";

const TARGET_SERVICE_LIMIT = 10;

type ProposalSnapshot = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};

function proposalSnapshot(value: unknown): ServiceSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const durationMin = typeof item.durationMin === "number" ? item.durationMin : null;
  const priceCents = typeof item.priceCents === "number" ? item.priceCents : null;
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    durationMin === null ||
    !Number.isInteger(durationMin) ||
    durationMin <= 0 ||
    priceCents === null ||
    !Number.isInteger(priceCents) ||
    priceCents < 0
  ) return null;
  return {
    id: item.id,
    name: item.name,
    durationMin,
    priceCents,
  };
}

function proposalSnapshots(value: unknown): ServiceSnapshot[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > TARGET_SERVICE_LIMIT) {
    throw new AppointmentError("SERVICE_INVALID");
  }
  const snapshots = value.map(proposalSnapshot);
  if (snapshots.some((snapshot) => snapshot === null)) {
    throw new AppointmentError("SERVICE_INVALID");
  }
  const result = snapshots as ServiceSnapshot[];
  if (new Set(result.map((snapshot) => snapshot.id)).size !== result.length) {
    throw new AppointmentError("SERVICE_INVALID");
  }
  return result;
}

function targetPayload(input: {
  proposalId: string;
  appointmentId: string;
  currentStartAt: Date;
  targetStartAt: Date;
  targetEndAt: Date;
  timezone: string;
  professionalId: string;
  professionalName: string;
  services: ServiceSnapshot[];
  actor: AppointmentActor;
  reason?: string | null;
  notes?: string | null;
}) {
  return {
    proposalId: input.proposalId,
    appointmentId: input.appointmentId,
    eventType: "RESCHEDULE_REQUESTED",
    previousStartAt: input.currentStartAt.toISOString(),
    startAt: input.targetStartAt.toISOString(),
    endAt: input.targetEndAt.toISOString(),
    timezone: input.timezone,
    professionalId: input.professionalId,
    professionalName: input.professionalName,
    services: input.services,
    reason: input.reason?.trim() || null,
    notes: input.notes ?? null,
    actor: {
      type: input.actor.type,
      id: input.actor.id ?? null,
      name: input.actor.name,
    },
  } satisfies Prisma.InputJsonValue;
}

function rejectPayload(input: {
  proposalId: string;
  appointmentId: string;
  currentStartAt: Date;
  targetStartAt: Date;
  targetEndAt: Date;
  timezone: string;
  professionalId: string;
  services: ServiceSnapshot[];
  actor: AppointmentActor;
  reason?: string | null;
}) {
  return {
    ...targetPayload({
      ...input,
      professionalName: "",
      reason: input.reason,
    }),
    eventType: "RESCHEDULE_REJECTED",
    responseReason: input.reason?.trim() || null,
  } satisfies Prisma.InputJsonValue;
}

export type StaffRescheduleResult =
  | (AppointmentMutationResult & { requiresAcceptance: false })
  | { requiresAcceptance: true; proposalId: string; duplicate: boolean };

/**
 * Para clientes com conta, uma alteração iniciada pela equipe vira uma
 * solicitação pendente. Visitantes continuam no fluxo direto, pois não têm
 * sessão para responder; a equipe pode contatá-los pelo atalho de telefone ou
 * WhatsApp da agenda.
 */
export async function requestStaffReschedule(
  tx: Tx,
  input: {
    salonId: string;
    appointmentId: string;
    professionalId: string;
    serviceIds: string[];
    startLocal: string;
    notes?: string | null;
    actor: AppointmentActor;
    idempotencyKey: string;
    expectedVersion?: number;
    permittedProfessionalId?: string;
    reason?: string | null;
  },
): Promise<StaffRescheduleResult> {
  await lockAppointmentOperationalScope(tx, {
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    targetProfessionalIds: [input.professionalId],
  });
  const appointment = await tx.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      startAt: true,
      endAt: true,
      version: true,
      timezone: true,
      notes: true,
      service: { select: { id: true, name: true, durationMin: true, priceCents: true } },
      serviceItems: {
        orderBy: { position: "asc" },
        select: { serviceId: true, serviceName: true, durationMin: true, priceCents: true },
      },
      client: {
        select: {
          passwordHash: true,
          user: { select: { passwordHash: true } },
        },
      },
    },
  });
  if (!appointment) throw new AppointmentError("NOT_FOUND");
  if (
    input.permittedProfessionalId &&
    (appointment.professionalId !== input.permittedProfessionalId ||
      input.professionalId !== input.permittedProfessionalId)
  ) {
    throw new AppointmentError("FORBIDDEN");
  }

  const isSameSlot =
    appointment.professionalId === input.professionalId &&
    toLocalDateTime(appointment.startAt, appointment.timezone) === input.startLocal;
  // Salva o caso comum de editar somente observações sem abrir uma aprovação
  // de horário que não tem nenhuma mudança para o cliente analisar.
  const hasClientAccount = Boolean(
    appointment.client.passwordHash || appointment.client.user?.passwordHash,
  );
  if (!hasClientAccount || isSameSlot) {
    const direct = await rescheduleAppointment(tx, {
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      professionalId: input.professionalId,
      serviceIds: input.serviceIds,
      startLocal: input.startLocal,
      notes: input.notes,
      actor: input.actor,
      idempotencyKey: input.idempotencyKey,
      expectedVersion: input.expectedVersion,
      permittedProfessionalId: input.permittedProfessionalId,
      enforceClientPolicy: false,
    });
    return { ...direct, requiresAcceptance: false };
  }

  const fingerprint = JSON.stringify({
    appointmentId: input.appointmentId,
    professionalId: input.professionalId,
    serviceIds: input.serviceIds,
    startLocal: input.startLocal,
    notes: input.notes ?? null,
    reason: input.reason?.trim() ?? null,
    expectedVersion: input.expectedVersion ?? null,
  });
  const existing = await tx.rescheduleProposal.findFirst({
    where: { salonId: input.salonId, idempotencyKey: input.idempotencyKey },
    select: { id: true, requestFingerprint: true, status: true },
  });
  if (existing) {
    if (existing.requestFingerprint !== fingerprint) {
      throw new AppointmentError("IDEMPOTENCY_MISMATCH");
    }
    if (existing.status === "PENDING") {
      return { requiresAcceptance: true, proposalId: existing.id, duplicate: true };
    }
    return { requiresAcceptance: true, proposalId: existing.id, duplicate: true };
  }
  if (input.expectedVersion !== undefined && appointment.version !== input.expectedVersion) {
    throw new AppointmentError("VERSION_CONFLICT");
  }

  const historicalServices = appointment.serviceItems.length > 0
    ? appointment.serviceItems.map((service) => ({
        id: service.serviceId,
        name: service.serviceName,
        durationMin: service.durationMin,
        priceCents: service.priceCents,
      }))
    : [appointment.service];
  const requestedServiceIds = [...new Set(input.serviceIds)];
  const preservesHistoricalServices =
    historicalServices.length === requestedServiceIds.length &&
    historicalServices.every((service) => requestedServiceIds.includes(service.id));
  let inspected;
  try {
    inspected = await inspectAppointmentAvailability(tx, {
      salonId: input.salonId,
      professionalId: input.professionalId,
      serviceIds: input.serviceIds,
      startLocal: input.startLocal,
      excludeAppointmentId: appointment.id,
      enforceBookingWindow: false,
    });
  } catch (error) {
    if (
      !preservesHistoricalServices ||
      !(error instanceof AppointmentError) ||
      !["SERVICE_INVALID", "PRO_SERVICE_MISMATCH"].includes(error.code)
    ) {
      throw error;
    }
    inspected = await inspectAppointmentAvailabilityWithServiceSnapshots(tx, {
      salonId: input.salonId,
      professionalId: input.professionalId,
      currentProfessionalId: appointment.professionalId,
      serviceSnapshots: historicalServices,
      startLocal: input.startLocal,
      excludeAppointmentId: appointment.id,
      enforceBookingWindow: false,
    });
  }
  if (inspected.violation) throw new AppointmentError(inspected.violation);

  const professional = await tx.professional.findFirst({
    where: { id: input.professionalId, salonId: input.salonId },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!professional) throw new AppointmentError("PROFESSIONAL_UNAVAILABLE");
  const targetServices: ProposalSnapshot[] = inspected.services.map((service) => ({
    id: service.id,
    name: service.name,
    durationMin: service.durationMin,
    priceCents: service.priceCents,
  }));
  const targetPriceCents = targetServices.reduce((sum, service) => sum + service.priceCents, 0);
  const reason = input.reason?.trim() || "Alteração solicitada pelo estabelecimento";

  await tx.rescheduleProposal.updateMany({
    where: { salonId: input.salonId, appointmentId: appointment.id, status: "PENDING" },
    data: {
      status: "CANCELLED",
      responseReason: "Substituída por uma solicitação mais recente.",
      respondedAt: new Date(),
    },
  });
  const proposal = await tx.rescheduleProposal.create({
    data: {
      salonId: input.salonId,
      appointmentId: appointment.id,
      requestedById: input.actor.id ?? null,
      targetProfessionalId: input.professionalId,
      sourceVersion: appointment.version,
      targetStartAt: inspected.startAt,
      targetEndAt: inspected.endAt,
      targetTimezone: inspected.timezone,
      targetPriceCents,
      targetServices: targetServices as Prisma.InputJsonValue,
      targetNotes: input.notes === undefined ? appointment.notes : input.notes,
      reason,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
    },
    select: { id: true },
  });
  const payload = targetPayload({
    proposalId: proposal.id,
    appointmentId: appointment.id,
    currentStartAt: appointment.startAt,
    targetStartAt: inspected.startAt,
    targetEndAt: inspected.endAt,
    timezone: inspected.timezone,
    professionalId: input.professionalId,
    professionalName: professional.user.name,
    services: inspected.services,
    actor: input.actor,
    reason,
    notes: input.notes === undefined ? appointment.notes : input.notes,
  });
  const recipients: InternalNotificationRecipient[] = [
    { type: "CLIENT", id: appointment.clientId },
  ];
  await recordAppointmentEvent(tx, {
    salonId: input.salonId,
    appointmentId: appointment.id,
    eventType: "RESCHEDULE_REQUESTED",
    actor: input.actor,
    correlationId: randomUUID(),
    idempotencyKey: `reschedule-proposal:${proposal.id}:requested`,
    requestFingerprint: fingerprint,
    reason,
    newValue: payload,
    recipients,
    template: "appointment.reschedule_requested",
    payload,
  });
  return { requiresAcceptance: true, proposalId: proposal.id, duplicate: false };
}

export type ProposalResponseResult = {
  status: "ACCEPTED" | "REJECTED" | "CANCELLED";
  duplicate: boolean;
  appointment: AppointmentMutationResult["appointment"];
};

/** Responde atomically à proposta e mantém o mesmo id do agendamento. */
export async function respondToRescheduleProposal(
  tx: Tx,
  input: {
    salonId: string;
    proposalId: string;
    clientId: string;
    decision: "ACCEPT" | "REJECT";
    reason?: string | null;
  },
): Promise<ProposalResponseResult> {
  const initial = await tx.rescheduleProposal.findFirst({
    where: { id: input.proposalId, salonId: input.salonId },
    select: { appointmentId: true },
  });
  if (!initial) throw new AppointmentError("NOT_FOUND");
  await lockAppointmentOperationalScope(tx, {
    salonId: input.salonId,
    appointmentId: initial.appointmentId,
  });

  const proposal = await tx.rescheduleProposal.findFirst({
    where: { id: input.proposalId, salonId: input.salonId },
    select: {
      id: true,
      appointmentId: true,
      status: true,
      sourceVersion: true,
      targetProfessionalId: true,
      targetStartAt: true,
      targetEndAt: true,
      targetTimezone: true,
      targetServices: true,
      targetNotes: true,
      reason: true,
      responseReason: true,
      appointment: {
        select: {
          id: true,
          salonId: true,
          clientId: true,
          professionalId: true,
          startAt: true,
          endAt: true,
          version: true,
          timezone: true,
          priceCents: true,
          service: { select: { id: true, name: true, durationMin: true, priceCents: true } },
          serviceItems: {
            orderBy: { position: "asc" },
            select: { serviceId: true, serviceName: true, durationMin: true, priceCents: true },
          },
        },
      },
    },
  });
  if (!proposal) throw new AppointmentError("NOT_FOUND");
  const appointment = proposal.appointment;
  if (appointment.clientId !== input.clientId) throw new AppointmentError("FORBIDDEN");

  const currentResult = {
    id: appointment.id,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    version: appointment.version,
    clientId: appointment.clientId,
    professionalId: appointment.professionalId,
  };
  if (proposal.status !== "PENDING") {
    return {
      status: proposal.status,
      duplicate: true,
      appointment: currentResult,
    };
  }

  const actor: AppointmentActor = {
    type: "CLIENT",
    id: input.clientId,
    name: "Cliente",
  };
  if (input.decision === "REJECT") {
    const responseReason = input.reason?.trim() || "Cliente recusou a alteração de horário.";
    const updated = await tx.rescheduleProposal.updateMany({
      where: { id: proposal.id, salonId: input.salonId, status: "PENDING" },
      data: { status: "REJECTED", responseReason, respondedAt: new Date() },
    });
    if (updated.count !== 1) {
      return { status: "REJECTED", duplicate: true, appointment: currentResult };
    }
    const oldServices = proposal.appointment.serviceItems.length > 0
      ? proposal.appointment.serviceItems.map((service) => ({
          id: service.serviceId,
          name: service.serviceName,
          durationMin: service.durationMin,
          priceCents: service.priceCents,
        }))
      : [proposal.appointment.service];
    const payload = rejectPayload({
      proposalId: proposal.id,
      appointmentId: proposal.appointmentId,
      currentStartAt: appointment.startAt,
      targetStartAt: proposal.targetStartAt,
      targetEndAt: proposal.targetEndAt,
      timezone: proposal.targetTimezone,
      professionalId: proposal.targetProfessionalId,
      services: oldServices,
      actor,
      reason: responseReason,
    });
    const business = await businessRecipients(
      tx,
      input.salonId,
      appointment.professionalId,
      input.clientId,
    );
    await recordAppointmentEvent(tx, {
      salonId: input.salonId,
      appointmentId: proposal.appointmentId,
      eventType: "RESCHEDULE_REJECTED",
      actor,
      correlationId: randomUUID(),
      idempotencyKey: `reschedule-proposal:${proposal.id}:rejected`,
      requestFingerprint: proposal.id,
      reason: responseReason,
      newValue: payload,
      recipients: business,
      template: "appointment.reschedule_rejected",
      payload,
    });
    return { status: "REJECTED", duplicate: false, appointment: currentResult };
  }

  const snapshots = proposalSnapshots(proposal.targetServices);
  const result = await rescheduleAppointment(tx, {
    salonId: input.salonId,
    appointmentId: proposal.appointmentId,
    professionalId: proposal.targetProfessionalId,
    startLocal: toLocalDateTime(proposal.targetStartAt, proposal.targetTimezone),
    actor,
    idempotencyKey: `reschedule-proposal:${proposal.id}:accepted`,
    expectedVersion: proposal.sourceVersion,
    expectedClientId: input.clientId,
    enforceClientPolicy: false,
    notes: proposal.targetNotes,
    serviceSnapshotsOverride: snapshots,
    proposalId: proposal.id,
  });
  await tx.rescheduleProposal.updateMany({
    where: { id: proposal.id, salonId: input.salonId, status: "PENDING" },
    data: {
      status: "ACCEPTED",
      responseReason: input.reason?.trim() || "Cliente aceitou a alteração de horário.",
      respondedAt: new Date(),
    },
  });
  return { status: "ACCEPTED", duplicate: result.duplicate, appointment: result.appointment };
}

export function proposalErrorStatus(code: Parameters<typeof appointmentErrorStatus>[0]): number {
  return appointmentErrorStatus(code);
}
