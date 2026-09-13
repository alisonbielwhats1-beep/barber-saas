"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import {
  addCalendarDays,
  dateKeyInTimeZone,
  isDateKey,
  startOfDateInTimeZone,
} from "@/lib/time";
import { closeComandaReliably } from "@/lib/comanda-service";
import { defaultReceivedDate } from "@/lib/receipt-adjustments";

const daySchema = z.string().refine(isDateKey, "Data inválida");
async function receiptContext() {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  return ctx;
}

export async function getReceiptDays(endDate?: string) {
  const ctx = await receiptContext();
  return withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUniqueOrThrow({
      where: { id: ctx.salonId },
      select: { timezone: true },
    });
    const today = dateKeyInTimeZone(new Date(), salon.timezone);
    const end = endDate ? daySchema.parse(endDate) : today;
    if (end > today) throw new Error("Escolha um período até hoje.");
    const start = addCalendarDays(end, -30);
    const rows = await tx.appointment.findMany({
      where: {
        salonId: ctx.salonId,
        startAt: {
          gte: startOfDateInTimeZone(start, salon.timezone),
          lt: startOfDateInTimeZone(addCalendarDays(end, 1), salon.timezone),
        },
        OR: [
          { payment: { isNot: null } },
          { status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        ],
      },
      select: {
        startAt: true,
        priceCents: true,
        payment: { select: { amountCents: true } },
        products: { select: { quantity: true, priceCentsUnit: true } },
      },
    });
    const days = Array.from({ length: 31 }, (_, i) => ({
      date: addCalendarDays(end, -i),
      count: 0,
      pendingCount: 0,
      received: 0,
      pending: 0,
    }));
    const byDate = new Map(days.map((d) => [d.date, d]));
    for (const row of rows) {
      const day = byDate.get(dateKeyInTimeZone(row.startAt, salon.timezone));
      if (!day) continue;
      day.count++;
      if (row.payment) day.received += row.payment.amountCents;
      else {
        day.pendingCount++;
        day.pending +=
          row.priceCents +
          row.products.reduce(
            (sum, p) => sum + p.quantity * p.priceCentsUnit,
            0,
          );
      }
    }
    return { days, today };
  });
}

export async function getReceiptDay(rawDate: string) {
  const ctx = await receiptContext();
  const date = daySchema.parse(rawDate);
  return withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUniqueOrThrow({
      where: { id: ctx.salonId },
      select: { timezone: true, currency: true },
    });
    const now = new Date();
    const rows = await tx.appointment.findMany({
      where: {
        salonId: ctx.salonId,
        startAt: {
          gte: startOfDateInTimeZone(date, salon.timezone),
          lt: startOfDateInTimeZone(addCalendarDays(date, 1), salon.timezone),
        },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        payment: null,
      },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        version: true,
        startAt: true,
        status: true,
        priceCents: true,
        dependentName: true,
        client: { select: { name: true } },
        professional: { select: { user: { select: { name: true } } } },
        service: { select: { name: true } },
        serviceItems: {
          orderBy: { position: "asc" },
          select: { serviceName: true },
        },
        products: {
          select: { productId: true, quantity: true, priceCentsUnit: true },
        },
      },
    });
    const paid = await tx.appointment.findMany({
      where: {
        salonId: ctx.salonId,
        startAt: {
          gte: startOfDateInTimeZone(date, salon.timezone),
          lt: startOfDateInTimeZone(addCalendarDays(date, 1), salon.timezone),
        },
        payment: { isNot: null },
      },
      select: {
        id: true,
        client: { select: { name: true } },
        payment: { select: { amountCents: true, paidAt: true } },
      },
      orderBy: { startAt: "asc" },
    });
    const services = await tx.service.findMany({
      where: { salonId: ctx.salonId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, priceCents: true },
    });
    return {
      paid: paid.map((a) => ({
        id: a.id,
        name: a.client.name,
        amountCents: a.payment!.amountCents,
        paidAt: a.payment!.paidAt.toISOString(),
      })),
      timezone: salon.timezone,
      currency: salon.currency,
      today: dateKeyInTimeZone(now, salon.timezone),
      receivedDate: defaultReceivedDate(salon.timezone, now),
      services,
      rows: rows.map((a) => ({
        id: a.id,
        version: a.version,
        startAt: a.startAt.toISOString(),
        status: a.status,
        eligible: a.startAt <= now,
        name: a.dependentName
          ? `${a.dependentName} · titular ${a.client.name}`
          : a.client.name,
        professional: a.professional.user.name,
        service:
          a.serviceItems.map((s) => s.serviceName).join(" + ") ||
          a.service.name,
        baseCents:
          a.priceCents +
          a.products.reduce((sum, p) => sum + p.quantity * p.priceCentsUnit, 0),
        products: a.products.map((p) => ({
          productId: p.productId,
          quantity: p.quantity,
        })),
      })),
    };
  });
}

const batchSchema = z.object({
  receivedDate: daySchema,
  finalize: z.boolean(),
  rows: z
    .array(
      z.object({
        id: z.string().min(1),
        version: z.number().int().nonnegative(),
        idempotencyKey: z.string().uuid(),
        method: z.enum([
          "CASH",
          "PIX",
          "CREDIT_CARD",
          "DEBIT_CARD",
          "TRANSFER",
        ]),
        extraServiceIds: z.array(z.string().min(1)).max(30),
        surchargeCents: z.number().int().min(0).max(100_000_000),
        adjustmentReason: z.string().trim().max(300),
        expectedTotalCents: z.number().int().min(0).max(100_000_000),
        products: z
          .array(
            z.object({
              productId: z.string().min(1),
              quantity: z.number().int().min(0).max(999),
            }),
          )
          .max(100),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (rows) => new Set(rows.map((r) => r.id)).size === rows.length,
      "Atendimento repetido no lote",
    ),
});

export async function receiveBatch(raw: z.input<typeof batchSchema>) {
  const ctx = await receiptContext();
  const input = batchSchema.parse(raw);
  const results: { id: string; success: boolean; message: string }[] = [];
  for (const row of input.rows) {
    try {
      await withTenant(ctx, async (tx) => {
        const appointment = await tx.appointment.findFirst({
          where: { id: row.id, salonId: ctx.salonId },
          select: { status: true },
        });
        if (!appointment) throw new Error("Atendimento não encontrado.");
        if (!input.finalize && appointment.status !== "COMPLETED")
          throw new Error(
            "Confirme que o atendimento foi realizado para finalizar e receber.",
          );
        const actor = await tx.user.findUnique({
          where: { id: ctx.userId },
          select: { name: true },
        });
        await closeComandaReliably(tx, {
          salonId: ctx.salonId,
          userId: ctx.userId,
          actorName: actor?.name ?? "Equipe",
          role: ctx.role as "OWNER" | "MANAGER",
          appointmentId: row.id,
          idempotencyKey: row.idempotencyKey,
          expectedVersion: row.version,
          method: row.method,
          productLines: row.products,
          discountCents: 0,
          extraServiceIds: row.extraServiceIds,
          surchargeCents: row.surchargeCents,
          adjustmentReason: row.adjustmentReason,
          receivedDate: input.receivedDate,
          expectedTotalCents: row.expectedTotalCents,
        });
      });
      results.push({
        id: row.id,
        success: true,
        message: "Recebimento registrado",
      });
    } catch (error) {
      results.push({
        id: row.id,
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível registrar. Tente novamente.",
      });
    }
  }
  for (const path of [
    "/financeiro",
    "/hoje",
    "/agenda",
    "/dashboard",
    "/pagamentos",
    "/fechamento",
    "/relatorios",
    "/clientes",
  ])
    revalidatePath(path);
  return results;
}
