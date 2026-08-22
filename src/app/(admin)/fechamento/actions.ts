"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant, type Tx } from "@/lib/prisma-tenant";
import { writeAuditLog } from "@/lib/audit";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, startOfDateInTimeZone } from "@/lib/time";
import { summarizeDailyClosing, type ClosingPaymentMethod } from "@/lib/daily-closing";

const closingInput = z.object({
  dateKey: z.string().refine(isDateKey, "Data inválida"),
  declaredCashCents: z.number().int().min(0).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type DailyClosingActionResult =
  | { success: true; alreadyClosed?: boolean }
  | { error: string };

async function actorName(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? "Usuário";
}

/**
 * Registra um snapshot operacional no AuditLog, sem migration nova.
 * O fechamento não altera pagamentos nem impede correções posteriores; ele
 * deixa explícito o que foi conferido e por quem.
 */
export async function recordDailyClosing(
  input: z.infer<typeof closingInput>,
): Promise<DailyClosingActionResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const parsed = closingInput.safeParse(input);
  if (!parsed.success) return { error: "Dados do fechamento inválidos" };
  const data = parsed.data;

  try {
    const result = await withTenant(ctx, async (tx) => {
      const salon = await tx.salon.findUnique({
        where: { id: ctx.salonId },
        select: { timezone: true },
      });
      if (!salon) throw new Error("Estabelecimento não encontrado");

      const todayKey = dateKeyInTimeZone(new Date(), salon.timezone);
      if (data.dateKey > todayKey) throw new Error("Só é possível fechar hoje ou dias anteriores");

      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`daily-closing:${ctx.salonId}:${data.dateKey}`}, 0)
        )
      `;

      const existing = await tx.auditLog.findFirst({
        where: {
          salonId: ctx.salonId,
          action: "DAILY_CLOSING",
          entityType: "DAILY_CLOSING",
          entityId: data.dateKey,
        },
        select: { id: true },
      });
      if (existing) return { alreadyClosed: true } as const;

      const from = startOfDateInTimeZone(data.dateKey, salon.timezone);
      const to = startOfDateInTimeZone(addCalendarDays(data.dateKey, 1), salon.timezone);
      const appointments = await tx.appointment.findMany({
        where: { salonId: ctx.salonId, startAt: { gte: from, lt: to } },
        select: {
          status: true,
          priceCents: true,
          payment: { select: { amountCents: true, method: true } },
        },
      });
      const payments = await tx.payment.findMany({
        where: { appointment: { salonId: ctx.salonId }, paidAt: { gte: from, lt: to } },
        select: { amountCents: true, method: true },
      });
      const expenses = await tx.expense.findMany({
        where: { salonId: ctx.salonId, paidAt: { gte: from, lt: to } },
        select: { amountCents: true },
      });
      const summary = summarizeDailyClosing({
        appointments,
        payments: payments.map((payment) => ({
          amountCents: payment.amountCents,
          method: payment.method as ClosingPaymentMethod,
        })),
        expenses,
      });
      const actor = await actorName(tx, ctx.userId);
      const declaredCashCents = data.declaredCashCents ?? null;

      await writeAuditLog(tx, {
        salonId: ctx.salonId,
        userId: ctx.userId,
        actorName: actor,
        action: "DAILY_CLOSING",
        entityType: "DAILY_CLOSING",
        entityId: data.dateKey,
        reason: data.notes ?? null,
        metadata: {
          dateKey: data.dateKey,
          declaredCashCents,
          cashDifferenceCents: declaredCashCents === null
            ? null
            : declaredCashCents - summary.cashReceivedCents,
          ...summary,
        },
      });
      return { alreadyClosed: false } as const;
    });

    revalidatePath("/fechamento");
    revalidatePath("/financeiro");
    revalidatePath("/dashboard");
    return { success: true, ...(result.alreadyClosed ? { alreadyClosed: true } : {}) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Não foi possível fechar o dia" };
  }
}
