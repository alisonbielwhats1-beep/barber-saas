import { createHash } from "node:crypto";
import type { PaymentMethod } from "@prisma/client";
import { writeAuditLog } from "./audit";
import {
  calculateComandaTotals,
  normalizeProductLines,
  reconcileReservedProduct,
} from "./comanda";
import {
  lockAppointmentOperationalScope,
  updateAppointmentStatusReliably,
} from "./appointment-service";
import {
  AppointmentError,
  assertOperationalStatusTime,
} from "./appointment-domain";
import type { Tx } from "./prisma-tenant";
import { lockProductMutations } from "./inventory-lock";

export type ComandaRole = "OWNER" | "MANAGER" | "RECEPTIONIST";

export type CloseComandaInput = {
  salonId: string;
  userId: string;
  actorName: string;
  role: ComandaRole;
  appointmentId: string;
  idempotencyKey: string;
  expectedVersion: number;
  discountCents: number;
  productLines: Array<{ productId: string; quantity: number }>;
  method: PaymentMethod;
  notes?: string | null;
  now?: Date;
};

export type ComandaErrorCode =
  | "DISCOUNT_FORBIDDEN"
  | "APPOINTMENT_NOT_FOUND"
  | "APPOINTMENT_CLOSED"
  | "PAYMENT_ALREADY_EXISTS"
  | "INCONSISTENT_PAYMENT_AUDIT"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_INACTIVE"
  | "PRODUCT_QUANTITY_INVALID"
  | "INSUFFICIENT_STOCK"
  | "STOCK_CHANGED";

export class ComandaError extends Error {
  constructor(readonly code: ComandaErrorCode, message: string) {
    super(message);
    this.name = "ComandaError";
  }
}

export function assertComandaDiscountAllowed(
  role: ComandaRole,
  discountCents: number,
): void {
  if (role === "RECEPTIONIST" && discountCents > 0) {
    throw new ComandaError(
      "DISCOUNT_FORBIDDEN",
      "Somente proprietário ou gerente pode aplicar desconto",
    );
  }
}

function requestFingerprint(input: CloseComandaInput, productLines: CloseComandaInput["productLines"]): string {
  return createHash("sha256").update(JSON.stringify({
    appointmentId: input.appointmentId,
    expectedVersion: input.expectedVersion,
    discountCents: input.discountCents,
    productLines,
    method: input.method,
    notes: input.notes ?? null,
  })).digest("hex");
}

function auditMetadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * Núcleo transacional da comanda. O chamador deve fornecer um `Tx`; portanto,
 * status, estoque, pagamento e auditoria confirmam ou revertem juntos.
 */
export async function closeComandaReliably(
  tx: Tx,
  input: CloseComandaInput,
): Promise<{ duplicate: boolean; paymentId: string }> {
  assertComandaDiscountAllowed(input.role, input.discountCents);
  const productLines = normalizeProductLines(input.productLines)
    .sort((a, b) => a.productId.localeCompare(b.productId));
  if (productLines.some((line) => line.quantity > 999)) {
    throw new ComandaError(
      "PRODUCT_QUANTITY_INVALID",
      "Quantidade de produto inválida",
    );
  }
  const fingerprint = requestFingerprint(input, productLines);

  // O lock compartilhado com as demais mutações serializa double-submit do
  // atendimento. Produtos recebem locks próprios, sempre em ordem canônica.
  await lockAppointmentOperationalScope(tx, {
    salonId: input.salonId,
    appointmentId: input.appointmentId,
  });
  const appointment = await tx.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    select: {
      id: true,
      version: true,
      status: true,
      startAt: true,
      priceCents: true,
      payment: { select: { id: true } },
      products: {
        orderBy: [{ productId: "asc" }, { priceCentsUnit: "asc" }, { id: "asc" }],
        select: {
          id: true,
          productId: true,
          quantity: true,
          priceCentsUnit: true,
        },
      },
    },
  });
  if (!appointment) {
    throw new ComandaError("APPOINTMENT_NOT_FOUND", "Agendamento não encontrado");
  }
  if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
    throw new ComandaError("APPOINTMENT_CLOSED", "Agendamento já encerrado");
  }

  const previousCheckout = await tx.auditLog.findFirst({
    where: {
      salonId: input.salonId,
      action: "COMANDA_CLOSED",
      entityType: "Appointment",
      entityId: input.appointmentId,
      metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey },
    },
    orderBy: { createdAt: "asc" },
    select: { metadata: true },
  });
  if (previousCheckout) {
    if (
      auditMetadataString(previousCheckout.metadata, "requestFingerprint") !== fingerprint
    ) {
      throw new AppointmentError("IDEMPOTENCY_MISMATCH");
    }
    if (!appointment.payment) {
      throw new ComandaError(
        "INCONSISTENT_PAYMENT_AUDIT",
        "A auditoria da comanda não possui pagamento correspondente",
      );
    }
    return {
      duplicate: true,
      paymentId: appointment.payment.id,
    };
  }
  if (appointment.payment) {
    throw new ComandaError(
      "PAYMENT_ALREADY_EXISTS",
      "O pagamento deste agendamento já foi registrado",
    );
  }
  const existingByProduct = new Map<string, typeof appointment.products>();
  for (const existing of appointment.products) {
    const rows = existingByProduct.get(existing.productId) ?? [];
    rows.push(existing);
    existingByProduct.set(existing.productId, rows);
  }
  const desiredByProduct = new Map(
    productLines.map((line) => [line.productId, line.quantity]),
  );
  const productIds = [...new Set([
    ...existingByProduct.keys(),
    ...desiredByProduct.keys(),
  ])].sort();

  await lockProductMutations(tx, productIds);
  const products = productIds.length === 0
    ? []
    : await tx.product.findMany({
        where: {
          salonId: input.salonId,
          id: { in: productIds },
        },
        select: {
          id: true,
          name: true,
          priceCents: true,
          stock: true,
          active: true,
        },
      });
  if (products.length !== productIds.length) {
    throw new ComandaError("PRODUCT_NOT_FOUND", "Produto não encontrado ou inativo");
  }
  const productById = new Map(products.map((product) => [product.id, product]));
  const pricedLines: Array<{
    productId: string;
    quantity: number;
    priceCentsUnit: number;
  }> = [];
  const stockDeltas = new Map<string, number>();
  for (const productId of productIds) {
    const product = productById.get(productId)!;
    const existingRows = existingByProduct.get(productId) ?? [];
    const desiredQuantity = desiredByProduct.get(productId) ?? 0;
    const reconciliation = reconcileReservedProduct({
      reserved: existingRows,
      desiredQuantity,
      currentPriceCents: product.priceCents,
    });
    if (reconciliation.additionalQuantity > 0 && !product.active) {
      throw new ComandaError(
        "PRODUCT_INACTIVE",
        `${product.name} está inativo e não pode ter a quantidade aumentada`,
      );
    }
    if (reconciliation.additionalQuantity > product.stock) {
      throw new ComandaError(
        "INSUFFICIENT_STOCK",
        `Estoque insuficiente para ${product.name}`,
      );
    }
    stockDeltas.set(productId, reconciliation.stockDelta);
    pricedLines.push(...reconciliation.pricedLines.map((line) => ({
      productId,
      ...line,
    })));
  }

  const totals = calculateComandaTotals({
    serviceCents: appointment.priceCents,
    productLines: pricedLines,
    discountCents: input.discountCents,
  });
  const now = input.now ?? new Date();
  if (appointment.status === "COMPLETED") {
    if (appointment.version !== input.expectedVersion) {
      throw new AppointmentError("VERSION_CONFLICT");
    }
    assertOperationalStatusTime("COMPLETED", appointment.startAt, now);
  } else {
    await updateAppointmentStatusReliably(tx, {
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      status: "COMPLETED",
      actor: { type: "STAFF", id: input.userId, name: input.actorName },
      idempotencyKey: input.idempotencyKey,
      expectedVersion: input.expectedVersion,
      now,
      idempotencyContext: {
        amountCents: totals.totalCents,
        discountCents: totals.discountCents,
        method: input.method,
        notes: input.notes ?? null,
        productLines: pricedLines,
      },
    });
  }

  await tx.appointmentProduct.deleteMany({
    where: { appointmentId: input.appointmentId },
  });
  if (pricedLines.length > 0) {
    await tx.appointmentProduct.createMany({
      data: pricedLines.map((line) => ({
        appointmentId: input.appointmentId,
        productId: line.productId,
        quantity: line.quantity,
        priceCentsUnit: line.priceCentsUnit,
      })),
    });
  }
  for (const productId of productIds) {
    const delta = stockDeltas.get(productId) ?? 0;
    if (delta === 0) continue;
    const product = productById.get(productId)!;
    const updated = await tx.product.updateMany({
      where: {
        id: productId,
        salonId: input.salonId,
        stock: product.stock,
      },
      data: delta > 0
        ? { stock: { increment: delta } }
        : { stock: { decrement: -delta } },
    });
    if (updated.count !== 1) {
      throw new ComandaError(
        "STOCK_CHANGED",
        "Estoque alterado por outra operação. Revise a comanda.",
      );
    }
    await writeAuditLog(tx, {
      salonId: input.salonId,
      userId: input.userId,
      actorName: input.actorName,
      action: "STOCK_ADJUSTED",
      entityType: "Product",
      entityId: productId,
      reason: delta > 0
        ? "Devolução de reserva na comanda"
        : "Acréscimo na comanda",
      metadata: {
        productName: product.name,
        kind: delta > 0 ? "RESERVATION_RETURN" : "SALE",
        delta,
        previousStock: product.stock,
        newStock: product.stock + delta,
        appointmentId: input.appointmentId,
      },
    });
  }

  const payment = await tx.payment.create({
    data: {
      appointmentId: input.appointmentId,
      amountCents: totals.totalCents,
      discountCents: totals.discountCents,
      method: input.method,
      notes: input.notes ?? null,
    },
    select: { id: true },
  });
  await writeAuditLog(tx, {
    salonId: input.salonId,
    userId: input.userId,
    actorName: input.actorName,
    action: "COMANDA_CLOSED",
    entityType: "Appointment",
    entityId: input.appointmentId,
    reason: appointment.status === "COMPLETED"
      ? "Recebimento registrado após a conclusão"
      : "Comanda fechada e recebida",
    metadata: {
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      paymentId: payment.id,
      previousStatus: appointment.status,
      amountCents: totals.totalCents,
      discountCents: totals.discountCents,
      method: input.method,
      productLines: pricedLines,
    },
  });
  return { duplicate: false, paymentId: payment.id };
}
