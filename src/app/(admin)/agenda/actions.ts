"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isOverlapViolation } from "@/lib/db-errors";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant, type Tx } from "@/lib/prisma-tenant";
import {
  createAppointment,
  rescheduleAppointment,
  updateAppointmentStatusReliably,
} from "@/lib/appointment-service";
import { isAppointmentError } from "@/lib/appointment-domain";
import { recordAppointmentEvent } from "@/lib/appointment-events";
import {
  addCalendarDays,
  isDateKey,
  startOfDateInTimeZone,
  toLocalDateTime,
} from "@/lib/time";

/** Papéis que podem forçar overbooking — decisão de política, não operacional. */
const OVERBOOK_ROLES = ["OWNER", "MANAGER"] as const;

export type ActionResult = { error: string } | { success: true };

const createInput = z.object({
  professionalId: z.string(),
  serviceIds: z.array(z.string().min(1)).min(1).max(10),
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  clientPhone: z.string().optional().nullable(),
  startLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/),
  idempotencyKey: z.string().uuid(),
  notes: z.string().optional().nullable(),
  // Overbooking deliberado: só tem efeito se houver conflito real E a role
  // permitir (checado no servidor, nunca confiando só no que o cliente
  // manda) — sem conflito, este flag simplesmente não muda nada.
  overbookReason: z.string().trim().min(3).max(200).optional(),
});

function appointmentActionMessage(error: unknown): string {
  if (isOverlapViolation(error)) return "Horário já ocupado";
  if (!isAppointmentError(error)) {
    return error instanceof Error ? error.message : "Não foi possível concluir a ação";
  }
  const messages: Partial<Record<typeof error.code, string>> = {
    NOT_FOUND: "Agendamento não encontrado",
    FORBIDDEN: "Você não tem permissão para alterar este agendamento",
    SERVICE_INVALID: "Serviço inválido",
    PRO_SERVICE_MISMATCH: "Este profissional não realiza todos os serviços",
    INVALID_LOCAL_TIME: "Data ou horário inválido para o fuso do estabelecimento",
    INVALID_TIMEZONE: "O fuso do estabelecimento precisa ser corrigido",
    TOO_SOON: "Horário fora da antecedência mínima",
    TOO_FAR: "Horário além do limite de agendamento",
    OUTSIDE_WORKING_HOURS: "Horário fora da jornada do profissional",
    PROFESSIONAL_UNAVAILABLE: "O profissional está indisponível nesse período",
    SALON_CLOSED: "O estabelecimento está fechado nesse período",
    SLOT_TAKEN: "Horário já ocupado",
    ALREADY_CLOSED: "O agendamento já foi encerrado",
    ALREADY_STARTED: "O atendimento já começou",
    INVALID_STATUS_TRANSITION: "Mudança de status não permitida",
    VERSION_CONFLICT: "O agendamento foi alterado em outra tela. Atualize e tente novamente",
    IDEMPOTENCY_MISMATCH: "A solicitação repetida contém dados diferentes",
    REASON_REQUIRED: "Informe um motivo com pelo menos 3 caracteres",
  };
  return messages[error.code] ?? error.code;
}

/**
 * Cria um agendamento manualmente (pelo admin, na tela de agenda).
 *
 * Aceita `clientId` (cliente existente) OU `clientName`+`clientPhone` (cria um
 * novo cliente no mesmo salão). Valida:
 *  - profissional e serviço pertencem ao salão ativo
 *  - profissional pode fazer aquele serviço
 *  - o salão não está com bloqueio de dia inteiro nesse horário
 *  - não há conflito de horário — a menos que `overbookReason` esteja
 *    preenchido e a role permita (OWNER/MANAGER), caso em que o
 *    agendamento nasce com `isOverbooked=true` e uma entrada em `AuditLog`
 */
export async function createAppointmentManually(
  input: z.infer<typeof createInput>,
): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = createInput.parse(input);
  const canOverbook = (OVERBOOK_ROLES as readonly string[]).includes(ctx.role);
  if (!data.clientId && !data.clientName) return { error: "Informe um cliente" };

  try {
    await withTenant(ctx, async (tx) => {
      const actor = {
        type: "STAFF" as const,
        id: ctx.userId,
        name: await actorName(tx, ctx.userId),
      };
      await createAppointment(tx, {
        salonId: ctx.salonId,
        professionalId: data.professionalId,
        serviceIds: data.serviceIds,
        startLocal: data.startLocal,
        notes: data.notes,
        origin: "ADMIN",
        actor,
        idempotencyKey: data.idempotencyKey,
        enforceBookingWindow: false,
        canOverride: canOverbook,
        overrideReason: data.overbookReason,
        ...(data.clientId
          ? { clientId: data.clientId }
          : {
              guest: {
                name: data.clientName!,
                phone: data.clientPhone ?? null,
              },
            }),
      });
    });
  } catch (error) {
    return { error: appointmentActionMessage(error) };
  }

  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  return { success: true };
}

async function actorName(tx: Tx, userId: string): Promise<string> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? "Usuário";
}

async function permittedProfessionalId(
  tx: Tx,
  ctx: { salonId: string; userId: string; role: string },
): Promise<string | undefined> {
  if (ctx.role !== "PROFESSIONAL") return undefined;
  const professional = await tx.professional.findFirst({
    where: { salonId: ctx.salonId, userId: ctx.userId, active: true },
    select: { id: true },
  });
  if (!professional) throw new Error("Profissional não encontrado neste estabelecimento");
  return professional.id;
}

const statusInput = z.enum([
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export async function updateAppointmentStatus(
  id: string,
  status: z.infer<typeof statusInput>,
  options?: {
    idempotencyKey?: string;
    expectedVersion?: number;
    reason?: string | null;
  },
): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"]);
  const parsedStatus = statusInput.parse(status);
  if (parsedStatus === "CANCELLED") {
    assertRole(ctx, ["OWNER", "MANAGER"]);
  }

  try {
    await withTenant(ctx, async (tx) => {
      await updateAppointmentStatusReliably(tx, {
        salonId: ctx.salonId,
        appointmentId: id,
        status: parsedStatus,
        actor: {
          type: "STAFF",
          id: ctx.userId,
          name: await actorName(tx, ctx.userId),
        },
        idempotencyKey: options?.idempotencyKey ?? randomUUID(),
        expectedVersion: options?.expectedVersion,
        reason: options?.reason,
        permittedProfessionalId: await permittedProfessionalId(tx, ctx),
      });
    });
  } catch (error) {
    return { error: appointmentActionMessage(error) };
  }
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/book", "layout");
  return { success: true };
}

export async function cancelAppointment(
  id: string,
  reason: string,
  idempotencyKey: string,
  expectedVersion?: number,
): Promise<ActionResult> {
  return updateAppointmentStatus(id, "CANCELLED", {
    reason,
    idempotencyKey,
    expectedVersion,
  });
}

// ── Comanda ──────────────────────────────────────────────────────────────────

export async function getComandaData(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);

  const appt = await withTenant(ctx, (tx) =>
    tx.appointment.findFirst({
      where: { id, salonId: ctx.salonId },
      select: {
        version: true,
        priceCents: true,
        service: { select: { name: true } },
        serviceItems: {
          orderBy: { position: "asc" },
          select: { serviceName: true },
        },
        products: {
          select: {
            quantity: true,
            priceCentsUnit: true,
            product: { select: { name: true } },
          },
        },
        payment: {
          select: {
            amountCents: true,
            discountCents: true,
            method: true,
            notes: true,
          },
        },
      },
    }),
  );
  if (!appt) throw new Error("Agendamento não encontrado");
  return appt;
}

const comandaInput = z.object({
  id: z.string(),
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  discountCents: z.number().int().min(0).default(0),
  method: z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "PIX", "TRANSFER"]),
  notes: z.string().optional().nullable(),
});

export async function closeComanda(
  input: z.infer<typeof comandaInput>,
): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = comandaInput.parse(input);

  try {
    await withTenant(ctx, async (tx) => {
      const appt = await tx.appointment.findFirst({
        where: { id: data.id, salonId: ctx.salonId },
        select: {
          id: true,
          version: true,
          status: true,
          priceCents: true,
          products: { select: { quantity: true, priceCentsUnit: true } },
        },
      });
      if (!appt) throw new Error("Agendamento não encontrado");
      if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") {
        throw new Error("Agendamento já encerrado");
      }

      const subtotal =
        appt.priceCents +
        appt.products.reduce((s, p) => s + p.quantity * p.priceCentsUnit, 0);
      const amountCents = Math.max(0, subtotal - data.discountCents);

      // O status é alterado primeiro dentro da mesma transação. Em retry com
      // a mesma chave, o evento idempotente retorna antes do version check;
      // uma chave diferente não consegue reabrir/editar uma comanda concluída.
      const transition = await updateAppointmentStatusReliably(tx, {
        salonId: ctx.salonId,
        appointmentId: data.id,
        status: "COMPLETED",
        actor: {
          type: "STAFF",
          id: ctx.userId,
          name: await actorName(tx, ctx.userId),
        },
        idempotencyKey: data.idempotencyKey,
        expectedVersion: data.expectedVersion,
        idempotencyContext: {
          amountCents,
          discountCents: data.discountCents,
          method: data.method,
          notes: data.notes ?? null,
        },
      });

      // A primeira execução grava evento e pagamento na mesma transação.
      // Um retry idempotente não deve atualizar `paidAt` novamente.
      if (transition.duplicate) return;

      const paymentId = `pay_${randomUUID()}`;
      await tx.$executeRaw`
        INSERT INTO "Payment" (id, "appointmentId", "amountCents", "discountCents", method, notes, "paidAt")
        VALUES (
          ${paymentId},
          ${data.id},
          ${amountCents},
          ${data.discountCents},
          ${data.method}::"PaymentMethod",
          ${data.notes ?? null},
          NOW()
        )
        ON CONFLICT ("appointmentId") DO UPDATE SET
          "amountCents"   = EXCLUDED."amountCents",
          "discountCents" = EXCLUDED."discountCents",
          method          = EXCLUDED.method,
          notes           = EXCLUDED.notes,
          "paidAt"        = NOW()
      `;
    });
  } catch (error) {
    return { error: appointmentActionMessage(error) };
  }

  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/financeiro");
  revalidatePath("/book", "layout");
  return { success: true };
}

// ── Lembretes ────────────────────────────────────────────────────────────────

export async function markReminderSent(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);

  await withTenant(ctx, async (tx) => {
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${`manual-reminder:${id}`}, 0))
    `;
    const appointment = await tx.appointment.findFirst({
      where: { id, salonId: ctx.salonId },
      select: {
        id: true,
        clientId: true,
        startAt: true,
        endAt: true,
        timezone: true,
        reminderSentAt: true,
        service: { select: { name: true } },
        serviceItems: {
          orderBy: { position: "asc" },
          select: { serviceName: true },
        },
      },
    });
    if (!appointment || appointment.reminderSentAt) return;

    const now = new Date();
    await tx.appointment.updateMany({
      where: { id, salonId: ctx.salonId, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    const actor = {
      type: "STAFF" as const,
      id: ctx.userId,
      name: await actorName(tx, ctx.userId),
    };
    const payload = {
      appointmentId: id,
      eventType: "REMINDER_MARKED",
      startAt: appointment.startAt.toISOString(),
      endAt: appointment.endAt.toISOString(),
      timezone: appointment.timezone,
      services: appointment.serviceItems.length > 0
        ? appointment.serviceItems.map((service) => service.serviceName)
        : [appointment.service.name],
      actor,
      channel: "MANUAL_WHATSAPP",
    };
    const event = await recordAppointmentEvent(tx, {
      salonId: ctx.salonId,
      appointmentId: id,
      eventType: "REMINDER_MARKED",
      actor,
      correlationId: randomUUID(),
      idempotencyKey: `manual-reminder:${id}`,
      requestFingerprint: `manual-reminder:${id}`,
      newValue: payload,
      template: "appointment.reminder.manual",
      payload,
    });
    await tx.notificationOutbox.createMany({
      data: [{
        salonId: ctx.salonId,
        eventId: event.id,
        appointmentId: id,
        recipientType: "CLIENT",
        recipientId: appointment.clientId,
        recipientKey: `CLIENT:${appointment.clientId}`,
        channel: "MANUAL_WHATSAPP",
        template: "appointment.reminder.manual",
        payload,
        status: "SENT",
        attempts: 1,
        sentAt: now,
      }],
      skipDuplicates: true,
    });
  });
  revalidatePath("/dashboard");
}

/**
 * Duplica um agendamento para a semana seguinte no mesmo horário. Se o slot
 * estiver ocupado, procura o mesmo horário nos dias seguintes (até 6 dias).
 * A cópia nasce como PENDING.
 */
export async function duplicateAppointment(
  id: string,
  idempotencyKey: string = randomUUID(),
): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);

  const { appointment, timezone, staffName } = await withTenant(ctx, async (tx) => {
    const appt = await tx.appointment.findFirst({
      where: { id, salonId: ctx.salonId },
      select: {
        clientId: true,
        professionalId: true,
        startAt: true,
        notes: true,
        service: { select: { id: true } },
        serviceItems: {
          orderBy: { position: "asc" },
          select: { serviceId: true },
        },
      },
    });
    const salon = await tx.salon.findUnique({
      where: { id: ctx.salonId },
      select: { timezone: true },
    });
    return {
      appointment: appt,
      timezone: salon?.timezone ?? "America/Sao_Paulo",
      staffName: await actorName(tx, ctx.userId),
    };
  });
  if (!appointment) return { error: "Agendamento não encontrado" };

  const originalLocal = toLocalDateTime(appointment.startAt, timezone);
  const firstDate = originalLocal.slice(0, 10);
  const time = originalLocal.slice(11);
  const serviceIds = appointment.serviceItems.length > 0
    ? appointment.serviceItems.map((service) => service.serviceId)
    : [appointment.service.id];
  for (let offsetDays = 7; offsetDays <= 13; offsetDays++) {
    const startLocal = `${addCalendarDays(firstDate, offsetDays)}T${time}`;
    try {
      await withTenant(ctx, (tx) =>
        createAppointment(tx, {
          salonId: ctx.salonId,
          professionalId: appointment.professionalId,
          serviceIds,
          startLocal,
          notes: appointment.notes,
          origin: "ADMIN",
          actor: { type: "STAFF", id: ctx.userId, name: staffName },
          idempotencyKey: `${idempotencyKey}:${offsetDays}`,
          enforceBookingWindow: false,
          clientId: appointment.clientId,
        }),
      );
      revalidatePath("/agenda");
      revalidatePath("/dashboard");
      revalidatePath("/book", "layout");
      return { success: true };
    } catch (error) {
      const unavailable =
        isOverlapViolation(error) ||
        (isAppointmentError(error) &&
          [
            "SLOT_TAKEN",
            "SALON_CLOSED",
            "PROFESSIONAL_UNAVAILABLE",
            "OUTSIDE_WORKING_HOURS",
          ].includes(error.code));
      if (!unavailable) return { error: appointmentActionMessage(error) };
    }
  }
  return { error: "Sem horário livre na semana seguinte para repetir" };
}

const editInput = z.object({
  id: z.string(),
  professionalId: z.string(),
  serviceIds: z.array(z.string().min(1)).min(1).max(10),
  startLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/),
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().positive().optional(),
  notes: z.string().optional().nullable(),
});

/**
 * Edita data/hora e observações de um agendamento existente.
 * Mantém o profissional e a duração original; verifica conflitos.
 */
export async function editAppointment(input: z.infer<typeof editInput>): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"]);
  const data = editInput.parse(input);

  try {
    await withTenant(ctx, async (tx) => {
      const ownProfessionalId = await permittedProfessionalId(tx, ctx);
      if (ownProfessionalId && data.professionalId !== ownProfessionalId) {
        throw new Error("Você só pode remarcar seus próprios atendimentos");
      }
      await rescheduleAppointment(tx, {
        salonId: ctx.salonId,
        appointmentId: data.id,
        professionalId: data.professionalId,
        serviceIds: data.serviceIds,
        startLocal: data.startLocal,
        notes: data.notes,
        actor: {
          type: "STAFF",
          id: ctx.userId,
          name: await actorName(tx, ctx.userId),
        },
        idempotencyKey: data.idempotencyKey,
        expectedVersion: data.expectedVersion,
        permittedProfessionalId: ownProfessionalId,
        enforceClientPolicy: false,
      });
    });
  } catch (error) {
    return { error: appointmentActionMessage(error) };
  }
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/book", "layout");
  return { success: true };
}

const moveInput = z.object({
  id: z.string(),
  professionalId: z.string(),
  serviceIds: z.array(z.string().min(1)).min(1).max(10),
  startLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/),
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().positive().optional(),
});

/**
 * Move um agendamento (arrastar na agenda): troca horário e/ou profissional.
 * Mantém a duração do serviço, valida que o novo profissional faz o serviço
 * e que não há conflito de horário.
 */
export async function moveAppointment(input: z.infer<typeof moveInput>): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"]);
  const data = moveInput.parse(input);

  try {
    await withTenant(ctx, async (tx) => {
      const ownProfessionalId = await permittedProfessionalId(tx, ctx);
      if (ownProfessionalId && data.professionalId !== ownProfessionalId) {
        throw new Error("Você só pode remarcar seus próprios atendimentos");
      }
      await rescheduleAppointment(tx, {
        salonId: ctx.salonId,
        appointmentId: data.id,
        professionalId: data.professionalId,
        serviceIds: data.serviceIds,
        startLocal: data.startLocal,
        actor: {
          type: "STAFF",
          id: ctx.userId,
          name: await actorName(tx, ctx.userId),
        },
        idempotencyKey: data.idempotencyKey,
        expectedVersion: data.expectedVersion,
        permittedProfessionalId: ownProfessionalId,
        enforceClientPolicy: false,
      });
    });
  } catch (error) {
    return { error: appointmentActionMessage(error) };
  }
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/book", "layout");
  return { success: true };
}

// ── Recorrência ──────────────────────────────────────────────────────────────

const recurringInput = z.object({
  professionalId: z.string(),
  serviceIds: z.array(z.string().min(1)).min(1).max(10),
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  clientPhone: z.string().optional().nullable(),
  startLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/),
  idempotencyKey: z.string().uuid(),
  notes: z.string().optional().nullable(),
  frequency: z.enum(["WEEKLY", "BIWEEKLY"]),
  occurrences: z.number().int().min(2).max(24), // inclui a primeira
});

export type RecurringResult =
  | { error: string }
  | { success: true; created: number; skipped: string[] };

/**
 * Cria uma série de agendamentos recorrentes (semanal ou quinzenal).
 *
 * Sem tabela de série própria: cada ocorrência é um `Appointment`
 * independente com o mesmo `seriesId`, e cada uma passa pela MESMA validação
 * de conflito/bloqueio de uma criação manual — nada de burlar a exclusion
 * constraint ou os bloqueios do salão só por vir de uma série. Se uma data
 * específica estiver ocupada ou o salão fechado, aquela ocorrência é pulada
 * (não vira overbooking automático) e reportada em `skipped`; o resto da
 * série continua. Cada ocorrência é a própria transação — mesmo motivo do
 * `duplicateAppointment` logo acima: uma exclusion violation aborta a
 * transação Postgres corrente inteira, então tentar a próxima data na MESMA
 * transação quebraria com um erro sem relação ("current transaction is
 * aborted"), não com o conflito real.
 */
export async function createRecurringAppointments(
  input: z.infer<typeof recurringInput>,
): Promise<RecurringResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = recurringInput.parse(input);
  if (!data.clientId && !data.clientName) return { error: "Informe um cliente" };

  const seriesId = data.idempotencyKey;
  const stepDays = data.frequency === "WEEKLY" ? 7 : 14;
  const firstDate = data.startLocal.slice(0, 10);
  const wallTime = data.startLocal.slice(11);
  const staffName = await withTenant(ctx, (tx) => actorName(tx, ctx.userId));
  let created = 0;
  const skipped: string[] = [];
  let resolvedClientId = data.clientId ?? null;

  for (let i = 0; i < data.occurrences; i++) {
    const startLocal = `${addCalendarDays(firstDate, i * stepDays)}T${wallTime}`;
    try {
      const result = await withTenant(ctx, (tx) =>
        createAppointment(tx, {
          salonId: ctx.salonId,
          professionalId: data.professionalId,
          serviceIds: data.serviceIds,
          startLocal,
          notes: data.notes,
          origin: "RECURRING",
          actor: { type: "STAFF", id: ctx.userId, name: staffName },
          idempotencyKey: `${data.idempotencyKey}:${i}`,
          enforceBookingWindow: false,
          seriesId,
          ...(resolvedClientId
            ? { clientId: resolvedClientId }
            : {
                guest: {
                  name: data.clientName!,
                  phone: data.clientPhone ?? null,
                },
              }),
        }),
      );
      resolvedClientId = result.appointment.clientId;
      created++;
    } catch (error) {
      const skippable =
        isOverlapViolation(error) ||
        (isAppointmentError(error) &&
          [
            "SLOT_TAKEN",
            "SALON_CLOSED",
            "PROFESSIONAL_UNAVAILABLE",
            "OUTSIDE_WORKING_HOURS",
          ].includes(error.code));
      if (skippable) {
        skipped.push(startLocal);
        continue;
      }
      return { error: appointmentActionMessage(error) };
    }
  }

  if (created === 0) return { error: "Nenhuma data da série ficou disponível" };
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/book", "layout");
  return { success: true, created, skipped };
}

// ── Bloqueios do salão ────────────────────────────────────────────────────────

const closureInput = z.object({
  startDate: z.string().refine(isDateKey),
  endDate: z.string().refine(isDateKey),
  reason: z.string().trim().min(2).max(200).optional().nullable(),
});

export async function createSalonClosure(
  input: z.infer<typeof closureInput>,
): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = closureInput.parse(input);
  if (data.endDate < data.startDate) return { error: "A data final não pode vir antes da inicial" };

  await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: ctx.salonId },
      select: { timezone: true },
    });
    if (!salon) throw new Error("Estabelecimento não encontrado");
    await tx.salonClosure.create({
      data: {
        salonId: ctx.salonId,
        startAt: startOfDateInTimeZone(data.startDate, salon.timezone),
        endAt: startOfDateInTimeZone(addCalendarDays(data.endDate, 1), salon.timezone),
        reason: data.reason ?? null,
      },
    });
  });
  revalidatePath("/configuracoes");
  revalidatePath("/agenda");
  return { success: true };
}

export async function deleteSalonClosure(id: string): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);

  await withTenant(ctx, (tx) =>
    tx.salonClosure.deleteMany({ where: { id, salonId: ctx.salonId } }),
  );
  revalidatePath("/configuracoes");
  revalidatePath("/agenda");
  return { success: true };
}

