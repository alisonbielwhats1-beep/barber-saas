import { writeAuditLog } from "./audit";
import {
  createAppointment,
  lockAppointmentOperationalScope,
  type AppointmentMutationResult,
  type CreateAppointmentInput,
} from "./appointment-service";
import { lockProductMutations } from "./inventory-lock";
import { validateStockAdjustment } from "./operational-flows";
import type { Tx } from "./prisma-tenant";

export type AppointmentProductReservationInput = {
  salonId: string;
  appointmentId: string;
  actorName: string;
  items: Array<{ productId: string; quantity: number }>;
};

type OmitFromEach<T, Key extends PropertyKey> = T extends unknown
  ? Omit<T, Key>
  : never;

export type CreateAppointmentWithProductsInput = {
  appointment: OmitFromEach<CreateAppointmentInput, "idempotencyContext">;
  productReservation: {
    actorName: string;
    items: Array<{ productId: string; quantity: number }>;
  };
};

export type AppointmentProductReservationErrorCode =
  | "APPOINTMENT_NOT_FOUND"
  | "PRODUCT_INVALID"
  | "INSUFFICIENT_STOCK"
  | "RESERVATION_ALREADY_EXISTS";

export class AppointmentProductReservationError extends Error {
  constructor(
    readonly code: AppointmentProductReservationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppointmentProductReservationError";
  }
}

export async function adjustProductStockReliably(
  tx: Tx,
  input: {
    salonId: string;
    productId: string;
    delta: number;
    userId: string;
    actorName: string;
    reason: string;
    kind: "PURCHASE" | "LOSS" | "INVENTORY" | "ADJUSTMENT";
  },
): Promise<{ previousStock: number; newStock: number }> {
  await lockProductMutations(tx, [input.productId]);
  const product = await tx.product.findFirst({
    where: { id: input.productId, salonId: input.salonId },
    select: { name: true, stock: true },
  });
  if (!product) {
    throw new AppointmentProductReservationError(
      "PRODUCT_INVALID",
      "Produto não pertence ao estabelecimento",
    );
  }
  const newStock = validateStockAdjustment({
    currentStock: product.stock,
    delta: input.delta,
  });
  const updated = await tx.product.updateMany({
    where: {
      id: input.productId,
      salonId: input.salonId,
      stock: product.stock,
    },
    data: { stock: newStock },
  });
  if (updated.count !== 1) throw new Error("Estoque alterado por outra operação");
  await writeAuditLog(tx, {
    salonId: input.salonId,
    userId: input.userId,
    actorName: input.actorName,
    action: "STOCK_ADJUSTED",
    entityType: "Product",
    entityId: input.productId,
    reason: input.reason,
    metadata: {
      productName: product.name,
      kind: input.kind,
      delta: input.delta,
      previousStock: product.stock,
      newStock,
    },
  });
  return { previousStock: product.stock, newStock };
}

function normalizeReservationItems(
  rawItems: AppointmentProductReservationInput["items"],
) {
  const quantities = new Map<string, number>();
  for (const item of rawItems) {
    if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppointmentProductReservationError(
        "PRODUCT_INVALID",
        "Quantidade de produto inválida",
      );
    }
    const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;
    if (quantity > 20) {
      throw new AppointmentProductReservationError(
        "PRODUCT_INVALID",
        "Quantidade de produto acima do limite",
      );
    }
    quantities.set(item.productId, quantity);
  }
  const items = [...quantities.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
  return items;
}

async function reserveAppointmentProductsAfterParentLock(
  tx: Tx,
  input: AppointmentProductReservationInput,
): Promise<void> {
  const items = normalizeReservationItems(input.items);
  if (items.length === 0) return;
  await lockProductMutations(tx, items.map((item) => item.productId));

  // A existência da reserva é verificada depois dos locks canônicos. Uma
  // transação concorrente que esperou o appointment observa o commit anterior.
  const appointment = await tx.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    select: {
      id: true,
      products: { select: { id: true } },
    },
  });
  if (!appointment) {
    throw new AppointmentProductReservationError(
      "APPOINTMENT_NOT_FOUND",
      "Agendamento não pertence ao estabelecimento",
    );
  }
  if (appointment.products.length > 0) {
    throw new AppointmentProductReservationError(
      "RESERVATION_ALREADY_EXISTS",
      "Os produtos deste agendamento já foram reservados",
    );
  }

  const products = await tx.product.findMany({
    where: {
      id: { in: items.map((item) => item.productId) },
      salonId: input.salonId,
      active: true,
    },
    select: { id: true, name: true, priceCents: true, stock: true },
  });
  if (products.length !== items.length) {
    throw new AppointmentProductReservationError(
      "PRODUCT_INVALID",
      "Produto não pertence ao estabelecimento ou está inativo",
    );
  }
  const productById = new Map(products.map((product) => [product.id, product]));
  const snapshots = items.map((item) => ({
    ...item,
    product: productById.get(item.productId)!,
  }));

  for (const snapshot of snapshots) {
    if (snapshot.quantity > snapshot.product.stock) {
      throw new AppointmentProductReservationError(
        "INSUFFICIENT_STOCK",
        `Estoque insuficiente para ${snapshot.product.name}`,
      );
    }
    const reserved = await tx.product.updateMany({
      where: {
        id: snapshot.productId,
        salonId: input.salonId,
        active: true,
        stock: snapshot.product.stock,
      },
      data: { stock: { decrement: snapshot.quantity } },
    });
    if (reserved.count !== 1) {
      throw new AppointmentProductReservationError(
        "INSUFFICIENT_STOCK",
        `Estoque insuficiente para ${snapshot.product.name}`,
      );
    }
    await writeAuditLog(tx, {
      salonId: input.salonId,
      userId: null,
      actorName: input.actorName,
      action: "STOCK_ADJUSTED",
      entityType: "Product",
      entityId: snapshot.productId,
      reason: "Reserva no agendamento público",
      metadata: {
        productName: snapshot.product.name,
        kind: "RESERVATION",
        delta: -snapshot.quantity,
        previousStock: snapshot.product.stock,
        newStock: snapshot.product.stock - snapshot.quantity,
        appointmentId: input.appointmentId,
      },
    });
  }

  await tx.appointmentProduct.createMany({
    data: snapshots.map((snapshot) => ({
      appointmentId: input.appointmentId,
      productId: snapshot.productId,
      quantity: snapshot.quantity,
      priceCentsUnit: snapshot.product.priceCents,
    })),
  });
}

/**
 * Reserva produtos para um appointment já commitado. Esta é a única API de
 * reserva genérica exportada: ela sempre adquire appointment -> professional
 * -> products e relê AppointmentProduct depois dos locks.
 */
export async function reserveAppointmentProducts(
  tx: Tx,
  input: AppointmentProductReservationInput,
): Promise<void> {
  // Validação fail-closed acontece antes de qualquer lock/banco. A função
  // interna normaliza de novo por defesa em profundidade.
  normalizeReservationItems(input.items);
  await lockAppointmentOperationalScope(tx, {
    salonId: input.salonId,
    appointmentId: input.appointmentId,
  });
  await reserveAppointmentProductsAfterParentLock(tx, input);
}

/**
 * Única capability para create+reserve no mesmo Tx. O caller não recebe id de
 * appointment nem escolhe uma fronteira de lock: a função cria e, apenas na
 * primeira execução idempotente, reserva antes do commit. A função interna
 * pós-lock não é exportada e portanto não pode ser acionada por uma rota.
 */
export async function createAppointmentWithProductReservation(
  tx: Tx,
  input: CreateAppointmentWithProductsInput,
): Promise<AppointmentMutationResult> {
  const items = normalizeReservationItems(input.productReservation.items);
  const created = await createAppointment(tx, {
    ...input.appointment,
    // O contexto faz parte do fingerprint calculado pelo dominio, junto aos
    // campos canonicos do appointment. Ele e composto dentro da capability
    // para impedir que um caller dissocie a chave do carrinho reservado. O
    // formato de array preserva retries de reservas criadas antes desta
    // fronteira segura, que ja persistiam o carrinho normalizado no fingerprint.
    idempotencyContext: items,
  });
  if (!created.duplicate && items.length > 0) {
    await reserveAppointmentProductsAfterParentLock(tx, {
      salonId: input.appointment.salonId,
      appointmentId: created.appointment.id,
      actorName: input.productReservation.actorName,
      items,
    });
  }
  return created;
}
