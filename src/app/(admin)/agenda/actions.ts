"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addMinutes } from "date-fns";
import { prisma } from "@/lib/prisma";
import { isOverlapViolation } from "@/lib/db-errors";
import { assertRole, getTenantContext } from "@/lib/tenant";

/** Executa a mutação traduzindo violação da exclusion constraint. */
async function guardOverlap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isOverlapViolation(e)) throw new Error("Horário já ocupado");
    throw e;
  }
}

export type ActionResult = { error: string } | { success: true };

const createInput = z.object({
  professionalId: z.string(),
  serviceId: z.string(),
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  clientPhone: z.string().optional().nullable(),
  startAt: z.string().datetime(),
  notes: z.string().optional().nullable(),
});

/**
 * Cria um agendamento manualmente (pelo admin, na tela de agenda).
 *
 * Aceita `clientId` (cliente existente) OU `clientName`+`clientPhone` (cria um
 * novo cliente no mesmo salão). Valida:
 *  - profissional e serviço pertencem ao salão ativo
 *  - profissional pode fazer aquele serviço
 *  - não há conflito de horário
 */
export async function createAppointmentManually(
  input: z.infer<typeof createInput>,
): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = createInput.parse(input);

  const [service, link] = await Promise.all([
    prisma.service.findFirst({
      where: { id: data.serviceId, salonId: ctx.salonId, active: true },
      select: { durationMin: true, priceCents: true },
    }),
    prisma.professionalService.findFirst({
      where: {
        serviceId: data.serviceId,
        professional: { id: data.professionalId, salonId: ctx.salonId, active: true },
      },
    }),
  ]);
  if (!service) return { error: "Serviço inválido" };
  if (!link) return { error: "Este profissional não faz esse serviço" };

  const startAt = new Date(data.startAt);
  const endAt = addMinutes(startAt, service.durationMin);

  const conflict = await prisma.appointment.findFirst({
    where: {
      professionalId: data.professionalId,
      status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  });
  if (conflict) return { error: "Horário já ocupado" };

  let clientId = data.clientId;
  if (!clientId) {
    if (!data.clientName) return { error: "Informe um cliente" };
    const client = await prisma.clientProfile.create({
      data: {
        salonId: ctx.salonId,
        name: data.clientName,
        phone: data.clientPhone ?? null,
      },
      select: { id: true },
    });
    clientId = client.id;
  } else {
    const owned = await prisma.clientProfile.findFirst({
      where: { id: clientId, salonId: ctx.salonId },
      select: { id: true },
    });
    if (!owned) return { error: "Cliente inválido" };
  }

  await guardOverlap(() =>
    prisma.appointment.create({
      data: {
        salonId: ctx.salonId,
        clientId,
        serviceId: data.serviceId,
        professionalId: data.professionalId,
        startAt,
        endAt,
        priceCents: service.priceCents,
        status: "CONFIRMED",
        notes: data.notes ?? null,
      },
    }),
  );

  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  return { success: true };
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
) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"]);
  const parsedStatus = statusInput.parse(status);

  await prisma.appointment.updateMany({
    where: { id, salonId: ctx.salonId },
    data: { status: parsedStatus },
  });
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
}

export async function cancelAppointment(id: string) {
  return updateAppointmentStatus(id, "CANCELLED");
}

// ── Comanda ──────────────────────────────────────────────────────────────────

export async function getComandaData(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);

  const appt = await prisma.appointment.findFirst({
    where: { id, salonId: ctx.salonId },
    select: {
      priceCents: true,
      service: { select: { name: true } },
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
  });
  if (!appt) throw new Error("Agendamento não encontrado");
  return appt;
}

const comandaInput = z.object({
  id: z.string(),
  discountCents: z.number().int().min(0).default(0),
  method: z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "PIX", "TRANSFER"]),
  notes: z.string().optional().nullable(),
});

export async function closeComanda(input: z.infer<typeof comandaInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = comandaInput.parse(input);

  const appt = await prisma.appointment.findFirst({
    where: { id: data.id, salonId: ctx.salonId },
    select: {
      id: true,
      status: true,
      priceCents: true,
      products: { select: { quantity: true, priceCentsUnit: true } },
    },
  });
  if (!appt) throw new Error("Agendamento não encontrado");
  if (appt.status === "CANCELLED" || appt.status === "COMPLETED") {
    throw new Error("Agendamento já encerrado");
  }

  const subtotal =
    appt.priceCents +
    appt.products.reduce((s, p) => s + p.quantity * p.priceCentsUnit, 0);
  const amountCents = Math.max(0, subtotal - data.discountCents);

  const paymentId = `pay_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  await prisma.$transaction([
    // $executeRaw para suportar discountCents/notes antes do prisma generate
    prisma.$executeRaw`
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
    `,
    prisma.appointment.update({
      where: { id: data.id },
      data: { status: "COMPLETED" },
    }),
  ]);

  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/financeiro");
}

// ── Lembretes ────────────────────────────────────────────────────────────────

export async function markReminderSent(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);

  await prisma.$executeRaw`
    UPDATE "Appointment"
    SET   "reminderSentAt" = NOW(),
          "updatedAt"      = NOW()
    WHERE id = ${id} AND "salonId" = ${ctx.salonId}
  `;
  revalidatePath("/dashboard");
}

const resizeInput = z.object({
  id: z.string(),
  endAt: z.string().datetime(),
});

/**
 * Redimensiona a duração de um agendamento (arrastar a borda inferior).
 * Mantém o início, valida duração mínima de 15min e conflito.
 */
export async function resizeAppointment(input: z.infer<typeof resizeInput>): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = resizeInput.parse(input);

  const appt = await prisma.appointment.findFirst({
    where: { id: data.id, salonId: ctx.salonId },
    select: { startAt: true, professionalId: true },
  });
  if (!appt) return { error: "Agendamento não encontrado" };

  const endAt = new Date(data.endAt);
  if (endAt.getTime() - appt.startAt.getTime() < 15 * 60_000)
    return { error: "Duração mínima de 15 minutos" };

  const conflict = await prisma.appointment.findFirst({
    where: {
      id: { not: data.id },
      professionalId: appt.professionalId,
      status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      startAt: { lt: endAt },
      endAt: { gt: appt.startAt },
    },
    select: { id: true },
  });
  if (conflict) return { error: "Conflito com outro agendamento" };

  await guardOverlap(() =>
    prisma.appointment.update({ where: { id: data.id }, data: { endAt } }),
  );
  revalidatePath("/agenda");
  return { success: true };
}

/**
 * Duplica um agendamento para a semana seguinte no mesmo horário. Se o slot
 * estiver ocupado, procura o mesmo horário nos dias seguintes (até 6 dias).
 * A cópia nasce como PENDING.
 */
export async function duplicateAppointment(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);

  const appt = await prisma.appointment.findFirst({
    where: { id, salonId: ctx.salonId },
    select: {
      clientId: true,
      serviceId: true,
      professionalId: true,
      priceCents: true,
      startAt: true,
      endAt: true,
    },
  });
  if (!appt) throw new Error("Agendamento não encontrado");

  const durationMs = appt.endAt.getTime() - appt.startAt.getTime();
  for (let addDays = 7; addDays <= 13; addDays++) {
    const startAt = new Date(appt.startAt.getTime() + addDays * 86_400_000);
    const endAt = new Date(startAt.getTime() + durationMs);
    const conflict = await prisma.appointment.findFirst({
      where: {
        professionalId: appt.professionalId,
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (conflict) continue;
    try {
      await prisma.appointment.create({
        data: {
          salonId: ctx.salonId,
          clientId: appt.clientId,
          serviceId: appt.serviceId,
          professionalId: appt.professionalId,
          startAt,
          endAt,
          priceCents: appt.priceCents,
          status: "PENDING",
        },
      });
    } catch (e) {
      // Slot ocupado na corrida — tenta o próximo dia
      if (isOverlapViolation(e)) continue;
      throw e;
    }
    revalidatePath("/agenda");
    revalidatePath("/dashboard");
    return;
  }
  throw new Error("Sem horário livre na semana seguinte para duplicar");
}

const editInput = z.object({
  id: z.string(),
  startAt: z.string().datetime(),
  notes: z.string().optional().nullable(),
});

/**
 * Edita data/hora e observações de um agendamento existente.
 * Mantém o profissional e a duração original; verifica conflitos.
 */
export async function editAppointment(input: z.infer<typeof editInput>): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = editInput.parse(input);

  const appt = await prisma.appointment.findFirst({
    where: { id: data.id, salonId: ctx.salonId },
    select: { startAt: true, endAt: true, professionalId: true },
  });
  if (!appt) return { error: "Agendamento não encontrado" };

  const duration = appt.endAt.getTime() - appt.startAt.getTime();
  const startAt = new Date(data.startAt);
  const endAt = new Date(startAt.getTime() + duration);

  const conflict = await prisma.appointment.findFirst({
    where: {
      id: { not: data.id },
      professionalId: appt.professionalId,
      status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  });
  if (conflict) return { error: "Horário já ocupado" };

  try {
    await guardOverlap(() =>
      prisma.appointment.update({
        where: { id: data.id },
        data: { startAt, endAt, notes: data.notes ?? null },
      }),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erro ao salvar" };
  }

  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  return { success: true };
}

const moveInput = z.object({
  id: z.string(),
  professionalId: z.string(),
  startAt: z.string().datetime(),
});

/**
 * Move um agendamento (arrastar na agenda): troca horário e/ou profissional.
 * Mantém a duração do serviço, valida que o novo profissional faz o serviço
 * e que não há conflito de horário.
 */
export async function moveAppointment(input: z.infer<typeof moveInput>): Promise<ActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = moveInput.parse(input);

  const appt = await prisma.appointment.findFirst({
    where: { id: data.id, salonId: ctx.salonId },
    select: { serviceId: true, startAt: true, endAt: true },
  });
  if (!appt) return { error: "Agendamento não encontrado" };

  const durationMs = appt.endAt.getTime() - appt.startAt.getTime();
  const startAt = new Date(data.startAt);
  const endAt = new Date(startAt.getTime() + durationMs);

  const canDo = await prisma.professionalService.findFirst({
    where: {
      serviceId: appt.serviceId,
      professional: { id: data.professionalId, salonId: ctx.salonId, active: true },
    },
    select: { serviceId: true },
  });
  if (!canDo) return { error: "Este profissional não faz esse serviço" };

  const conflict = await prisma.appointment.findFirst({
    where: {
      id: { not: data.id },
      professionalId: data.professionalId,
      status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  });
  if (conflict) return { error: "Horário já ocupado" };

  await guardOverlap(() =>
    prisma.appointment.update({
      where: { id: data.id },
      data: { professionalId: data.professionalId, startAt, endAt },
    }),
  );

  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  return { success: true };
}

