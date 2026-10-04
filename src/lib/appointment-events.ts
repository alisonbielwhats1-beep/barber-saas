import type {
  AppointmentActorType,
  AppointmentEventType,
  Prisma,
} from "@prisma/client";
import type { Tx } from "./prisma-tenant";

export type AppointmentActor = {
  type: AppointmentActorType;
  id?: string | null;
  name: string;
};

export type InternalNotificationRecipient = {
  type: "CLIENT" | "USER";
  id: string;
};

export type AppointmentEventInput = {
  salonId: string;
  appointmentId: string;
  eventType: AppointmentEventType;
  actor: AppointmentActor;
  correlationId: string;
  idempotencyKey?: string | null;
  requestFingerprint?: string | null;
  reason?: string | null;
  previousValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  recipients?: InternalNotificationRecipient[];
  template: string;
  payload: Prisma.InputJsonValue;
};

export async function businessRecipients(
  tx: Tx,
  salonId: string,
  professionalId: string,
  excludeUserId?: string | null,
): Promise<InternalNotificationRecipient[]> {
  const memberships = await tx.membership.findMany({
    where: {
      salonId,
      role: { in: ["OWNER", "MANAGER", "RECEPTIONIST"] },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: { userId: true },
  });
  const professional = await tx.professional.findFirst({
    where: { id: professionalId, salonId },
    select: { userId: true },
  });

  const userIds = new Set(memberships.map((membership) => membership.userId));
  if (professional?.userId && professional.userId !== excludeUserId) {
    userIds.add(professional.userId);
  }
  return [...userIds].map((id) => ({ type: "USER" as const, id }));
}

export async function recordAppointmentEvent(
  tx: Tx,
  input: AppointmentEventInput,
): Promise<{ id: string; created: boolean }> {
  if (input.idempotencyKey) {
    // Serializa a mesma ação também para jobs concorrentes (por exemplo, duas
    // execuções do cron). Assim a consulta + criação abaixo não depende de
    // capturar uma unique violation dentro de uma transação já abortada.
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(
        hashtextextended(${`appointment-event:${input.appointmentId}:${input.idempotencyKey}`}, 0)
      )
    `;
    const existing = await tx.appointmentEvent.findUnique({
      where: {
        appointmentId_idempotencyKey: {
          appointmentId: input.appointmentId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: { id: true },
    });
    if (existing) return { ...existing, created: false };
  }

  const event = await tx.appointmentEvent.create({
    data: {
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      eventType: input.eventType,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey ?? null,
      requestFingerprint: input.requestFingerprint ?? null,
      reason: input.reason ?? null,
      previousValue: input.previousValue,
      newValue: input.newValue,
    },
    select: { id: true },
  });

  const recipients = new Map<string, InternalNotificationRecipient>();
  for (const recipient of input.recipients ?? []) {
    recipients.set(`${recipient.type}:${recipient.id}`, recipient);
  }

  if (recipients.size > 0) {
    const now = new Date();
    await tx.notificationOutbox.createMany({
      data: [...recipients.entries()].map(([recipientKey, recipient]) => ({
        salonId: input.salonId,
        eventId: event.id,
        appointmentId: input.appointmentId,
        recipientType: recipient.type,
        recipientId: recipient.id,
        recipientKey,
        channel: "INTERNAL",
        template: input.template,
        payload: input.payload,
        // Para o canal interno, persistir a linha já é a entrega. Canais
        // externos futuros entram como PENDING e são processados fora da
        // transação do agendamento.
        status: "SENT",
        attempts: 1,
        sentAt: now,
      })),
      skipDuplicates: true,
    });
  }

  await notifyClientOfChange(tx, input, event.id, recipients);

  return { ...event, created: true };
}

/**
 * Cancelamento ou remarcação feitos pelo estabelecimento: o cliente recebe uma
 * notificação no celular na hora (som, vibração e aviso na tela, como o
 * sistema permitir), sem depender de abrir o app. O dono não espera aceite.
 * Ações do próprio cliente não geram aviso para ele.
 */
async function notifyClientOfChange(
  tx: Tx,
  input: AppointmentEventInput,
  eventId: string,
  recipients: Map<string, InternalNotificationRecipient>,
) {
  if (input.actor.type === "CLIENT" || input.actor.type === "GUEST") return;
  const client = [...recipients.values()].find((recipient) => recipient.type === "CLIENT");
  if (!client) return;
  const [{ isClientChangeTemplate }, { queueClientChangeNotice, scheduleClientChangeDelivery }] =
    await Promise.all([import("./client-change-notice-copy"), import("./client-change-notice")]);
  if (!isClientChangeTemplate(input.template)) return;
  const queued = await queueClientChangeNotice(tx, {
    salonId: input.salonId,
    clientId: client.id,
    appointmentId: input.appointmentId,
    eventId,
    template: input.template,
    payload: input.payload,
  });
  if (queued > 0) scheduleClientChangeDelivery(input.salonId);
}
