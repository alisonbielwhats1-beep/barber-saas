"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { deriveCashState } from "@/lib/operational-flows";
import { withTenant, type Tx } from "@/lib/prisma-tenant";
import { assertRole, getTenantContext } from "@/lib/tenant";

export type PaymentActionResult = { success: true } | { error: string };

async function actorName(tx: Tx, userId: string) {
  const actor = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
  return actor?.name ?? "Usuário";
}

const money = z.coerce.number().int().min(0).max(100_000_000);

export async function openCashRegister(input: {
  openingFloatCents: number;
  notes?: string;
}): Promise<PaymentActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const openingFloatCents = money.parse(input.openingFloatCents);
  const notes = z.string().trim().max(300).optional().parse(input.notes);

  try {
    await withTenant(ctx, async (tx) => {
      const events = await tx.auditLog.findMany({
        where: { salonId: ctx.salonId, entityType: "CashRegister", action: { in: ["CASH_OPENED", "CASH_CLOSED"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { action: true, createdAt: true, metadata: true },
      });
      if (deriveCashState(events).isOpen) throw new Error("O caixa já está aberto");
      await writeAuditLog(tx, {
        salonId: ctx.salonId,
        userId: ctx.userId,
        actorName: await actorName(tx, ctx.userId),
        action: "CASH_OPENED",
        entityType: "CashRegister",
        entityId: "main",
        reason: notes,
        metadata: { openingFloatCents },
      });
    });
    revalidatePath("/pagamentos");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Não foi possível abrir o caixa" };
  }
}

export async function closeCashRegister(input: {
  countedCashCents: number;
  expectedCashCents: number;
  notes?: string;
}): Promise<PaymentActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const countedCashCents = money.parse(input.countedCashCents);
  const expectedCashCents = money.parse(input.expectedCashCents);
  const notes = z.string().trim().max(300).optional().parse(input.notes);

  try {
    await withTenant(ctx, async (tx) => {
      const events = await tx.auditLog.findMany({
        where: { salonId: ctx.salonId, entityType: "CashRegister", action: { in: ["CASH_OPENED", "CASH_CLOSED"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { action: true, createdAt: true, metadata: true },
      });
      if (!deriveCashState(events).isOpen) throw new Error("Abra o caixa antes de fechá-lo");
      await writeAuditLog(tx, {
        salonId: ctx.salonId,
        userId: ctx.userId,
        actorName: await actorName(tx, ctx.userId),
        action: "CASH_CLOSED",
        entityType: "CashRegister",
        entityId: "main",
        reason: notes,
        metadata: {
          countedCashCents,
          expectedCashCents,
          differenceCents: countedCashCents - expectedCashCents,
        },
      });
    });
    revalidatePath("/pagamentos");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Não foi possível fechar o caixa" };
  }
}

export async function setDepositStatus(input: {
  appointmentId: string;
  status: "REQUESTED" | "RECEIVED" | "WAIVED";
  amountCents: number;
}): Promise<PaymentActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = z.object({
    appointmentId: z.string().min(1),
    status: z.enum(["REQUESTED", "RECEIVED", "WAIVED"]),
    amountCents: money,
  }).parse(input);

  try {
    await withTenant(ctx, async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: { id: data.appointmentId, salonId: ctx.salonId },
        select: { id: true, client: { select: { name: true } } },
      });
      if (!appointment) throw new Error("Agendamento não encontrado");
      await writeAuditLog(tx, {
        salonId: ctx.salonId,
        userId: ctx.userId,
        actorName: await actorName(tx, ctx.userId),
        action: "DEPOSIT_STATUS_CHANGED",
        entityType: "Appointment",
        entityId: appointment.id,
        metadata: { status: data.status, amountCents: data.amountCents, clientName: appointment.client.name },
      });
    });
    revalidatePath("/pagamentos");
    revalidatePath("/agenda");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Não foi possível atualizar o sinal" };
  }
}
