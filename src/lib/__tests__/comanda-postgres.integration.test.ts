import { describe, expect, it } from "vitest";
import { closeComandaReliably, type CloseComandaInput } from "../comanda-service";
import { prisma } from "../prisma";
import { withSalon, type Tx } from "../prisma-tenant";
import {
  cancelAppointmentReliably,
  lockAppointmentOperationalScope,
} from "../appointment-service";
import {
  adjustProductStockReliably,
  createAppointmentWithProductReservation,
  reserveAppointmentProducts,
} from "../appointment-product-service";

const describePostgres =
  process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

async function fixture(stock = 10) {
  const suffix = crypto.randomUUID();
  const salon = await prisma.salon.create({
    data: {
      slug: `comanda-ci-${suffix}`,
      name: "Comanda CI",
      timezone: "America/Sao_Paulo",
    },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      email: `comanda-${suffix}@example.test`,
      name: "Operador CI",
      passwordHash: "integration-only",
    },
    select: { id: true },
  });
  const professional = await prisma.professional.create({
    data: { salonId: salon.id, userId: user.id },
    select: { id: true },
  });
  const service = await prisma.service.create({
    data: {
      salonId: salon.id,
      name: "Corte CI",
      durationMin: 30,
      priceCents: 5_000,
      professionals: { create: { professionalId: professional.id } },
    },
    select: { id: true },
  });
  const product = await prisma.product.create({
    data: {
      salonId: salon.id,
      name: "Pomada CI",
      priceCents: 1_000,
      costCents: 400,
      stock,
    },
    select: { id: true },
  });
  await prisma.workingHours.create({
    data: {
      salonId: salon.id,
      professionalId: professional.id,
      weekday: 4,
      startMinutes: 9 * 60,
      endMinutes: 18 * 60,
    },
  });
  const clients = await Promise.all(["A", "B", "C"].map((name) =>
    prisma.clientProfile.create({
      data: { salonId: salon.id, name: `Cliente ${name}` },
      select: { id: true },
    }),
  ));

  async function appointment(input?: {
    status?: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED";
    clientIndex?: number;
    minute?: number;
    startAt?: Date;
  }) {
    const minute = input?.minute ?? 0;
    const startAt = input?.startAt ?? new Date(Date.UTC(2020, 0, 2, 12, minute));
    return prisma.appointment.create({
      data: {
        salonId: salon.id,
        clientId: clients[input?.clientIndex ?? 0]!.id,
        professionalId: professional.id,
        serviceId: service.id,
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        priceCents: 5_000,
        status: input?.status ?? "COMPLETED",
        timezone: "America/Sao_Paulo",
        origin: "ADMIN",
      },
      select: { id: true, version: true },
    });
  }

  async function reserveProduct(
    appointmentId: string,
    quantity: number,
    priceCentsUnit = 800,
  ) {
    await prisma.product.update({
      where: { id: product.id },
      data: { priceCents: priceCentsUnit },
    });
    await withSalon(salon.id, async (tx) => {
      await reserveAppointmentProducts(tx, {
        salonId: salon.id,
        appointmentId,
        actorName: "Cliente CI",
        items: [{ productId: product.id, quantity }],
      });
    });
  }

  return {
    salonId: salon.id,
    userId: user.id,
    professionalId: professional.id,
    serviceId: service.id,
    clientId: clients[0]!.id,
    productId: product.id,
    appointment,
    reserveProduct,
  };
}

function checkoutInput(
  data: Awaited<ReturnType<typeof fixture>>,
  appointment: { id: string; version: number },
  overrides: Partial<CloseComandaInput> = {},
): CloseComandaInput {
  return {
    salonId: data.salonId,
    userId: data.userId,
    actorName: "Operador CI",
    role: "OWNER",
    appointmentId: appointment.id,
    idempotencyKey: crypto.randomUUID(),
    expectedVersion: appointment.version,
    discountCents: 0,
    productLines: [],
    method: "PIX",
    now: new Date("2026-08-13T15:00:00.000Z"),
    ...overrides,
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  expect(value).toBeTruthy();
  expect(Array.isArray(value)).toBe(false);
  expect(typeof value).toBe("object");
  return value as Record<string, unknown>;
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function assertNotDeadlock(error: unknown): void {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  expect(code).not.toBe("P2034");
  expect(code).not.toBe("40P01");
  expect(message).not.toMatch(/40P01|deadlock detected|write conflict|transaction conflict/i);
}

async function withTestTimeout<T>(promise: Promise<T>, timeoutMs = 8_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TEST_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function concurrentGate(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    await ready;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type BlockedActivity = {
  pid: number;
  waitEventType: string | null;
  blockers: number[];
};

async function identifyBackend(tx: Tx, applicationName: string): Promise<number> {
  const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT
      set_config('application_name', ${applicationName}, true),
      pg_backend_pid() AS pid
  `;
  if (!backend) throw new Error("BACKEND_NOT_IDENTIFIED");
  return backend.pid;
}

async function waitForBlockedActivity(
  applicationName: string,
  blockerPid: number,
  timeoutMs = 5_000,
): Promise<BlockedActivity> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [activity] = await prisma.$queryRaw<BlockedActivity[]>`
      SELECT
        pid,
        wait_event_type AS "waitEventType",
        pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity
      WHERE application_name = ${applicationName}
        AND state = 'active'
    `;
    if (
      activity?.waitEventType === "Lock" &&
      activity.blockers.includes(blockerPid)
    ) {
      return activity;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("TRANSACTION_DID_NOT_BLOCK_ON_EXPECTED_BACKEND");
}

describePostgres("comanda transacional real", () => {
  it("paga produto pré-reservado pelo snapshot sem baixar estoque novamente", async () => {
    const data = await fixture(10);
    const appointment = await data.appointment();
    await data.reserveProduct(appointment.id, 2, 800);
    await prisma.product.update({
      where: { id: data.productId },
      data: { priceCents: 9_900 },
    });
    const key = crypto.randomUUID();
    const tamperedLine = {
      productId: data.productId,
      quantity: 2,
      priceCentsUnit: 1,
    } as unknown as CloseComandaInput["productLines"][number];
    const input = checkoutInput(data, appointment, {
      idempotencyKey: key,
      productLines: [tamperedLine],
    });

    await expect(withSalon(data.salonId, (tx) => closeComandaReliably(tx, input)))
      .resolves.toMatchObject({ duplicate: false });
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 8 });
    await expect(prisma.payment.findUniqueOrThrow({
      where: { appointmentId: appointment.id },
      select: { amountCents: true },
    })).resolves.toEqual({ amountCents: 6_600 });
    await expect(prisma.appointmentProduct.findFirstOrThrow({
      where: { appointmentId: appointment.id, productId: data.productId },
      select: { quantity: true, priceCentsUnit: true },
    })).resolves.toEqual({ quantity: 2, priceCentsUnit: 800 });
    const reservations = await prisma.auditLog.findMany({
      where: {
        salonId: data.salonId,
        entityId: data.productId,
        action: "STOCK_ADJUSTED",
        metadata: { path: ["kind"], equals: "RESERVATION" },
      },
      select: { metadata: true },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.metadata).toMatchObject({
      delta: -2,
      previousStock: 10,
      newStock: 8,
      appointmentId: appointment.id,
    });

    await expect(withSalon(data.salonId, (tx) => closeComandaReliably(tx, input)))
      .resolves.toMatchObject({ duplicate: true });
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 8 });
  });

  it("devolve somente o delta removido da reserva e audita o saldo verdadeiro", async () => {
    const data = await fixture(10);
    const appointment = await data.appointment();
    await data.reserveProduct(appointment.id, 2, 700);

    await withSalon(data.salonId, (tx) => closeComandaReliably(tx, checkoutInput(
      data,
      appointment,
      { productLines: [{ productId: data.productId, quantity: 1 }] },
    )));

    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 9 });
    await expect(prisma.payment.findUniqueOrThrow({
      where: { appointmentId: appointment.id },
      select: { amountCents: true },
    })).resolves.toEqual({ amountCents: 5_700 });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        salonId: data.salonId,
        entityId: data.productId,
        action: "STOCK_ADJUSTED",
        metadata: { path: ["kind"], equals: "RESERVATION_RETURN" },
      },
      select: { metadata: true },
    });
    expect(audit.metadata).toMatchObject({
      kind: "RESERVATION_RETURN",
      delta: 1,
      previousStock: 8,
      newStock: 9,
    });
  });

  it("rejeita quantidade adulterada acima do limite sem alterar a reserva", async () => {
    const data = await fixture(10);
    const appointment = await data.appointment();
    await data.reserveProduct(appointment.id, 1, 800);

    await expect(withSalon(data.salonId, (tx) => closeComandaReliably(tx, checkoutInput(
      data,
      appointment,
      { productLines: [{ productId: data.productId, quantity: 1_000 }] },
    )))).rejects.toMatchObject({ code: "PRODUCT_QUANTITY_INVALID" });
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 9 });
    expect(await prisma.payment.count({ where: { appointmentId: appointment.id } })).toBe(0);
  });

  it("cancelamento devolve reserva uma única vez e audita a reposição", async () => {
    const data = await fixture(10);
    const appointment = await data.appointment({
      status: "CONFIRMED",
      startAt: new Date("2032-08-05T13:00:00.000Z"),
    });
    await data.reserveProduct(appointment.id, 2, 800);
    const idempotencyKey = crypto.randomUUID();
    const input = {
      salonId: data.salonId,
      appointmentId: appointment.id,
      actor: { type: "STAFF" as const, id: data.userId, name: "Operador CI" },
      idempotencyKey,
      expectedVersion: appointment.version,
      reason: "Cancelamento operacional",
      enforceClientPolicy: false,
      now: new Date("2032-08-01T12:00:00.000Z"),
    };

    await withSalon(data.salonId, (tx) => cancelAppointmentReliably(tx, input));
    await expect(withSalon(data.salonId, (tx) => cancelAppointmentReliably(tx, input)))
      .resolves.toMatchObject({ duplicate: true });
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 10 });
    const audits = await prisma.auditLog.findMany({
      where: {
        salonId: data.salonId,
        entityId: data.productId,
        action: "STOCK_ADJUSTED",
        metadata: { path: ["kind"], equals: "RESERVATION_CANCELLED" },
      },
      select: { metadata: true },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({
      kind: "RESERVATION_CANCELLED",
      delta: 2,
      previousStock: 8,
      newStock: 10,
    });
  });

  it("recebe COMPLETED sem repetir status e trata retries/chaves adversariais", async () => {
    const data = await fixture();
    const appointment = await data.appointment();
    const key = crypto.randomUUID();
    const input = checkoutInput(data, appointment, { idempotencyKey: key });

    const concurrent = await Promise.all([
      withSalon(data.salonId, (tx) => closeComandaReliably(tx, input)),
      withSalon(data.salonId, (tx) => closeComandaReliably(tx, input)),
    ]);
    expect(concurrent.map((result) => result.duplicate).sort())
      .toEqual([false, true]);
    expect(new Set(concurrent.map((result) => result.paymentId)).size).toBe(1);
    const retry = await withSalon(data.salonId, (tx) => closeComandaReliably(tx, input));
    expect(retry).toEqual({ duplicate: true, paymentId: concurrent[0]!.paymentId });

    await expect(withSalon(data.salonId, (tx) => closeComandaReliably(tx, {
      ...input,
      method: "CASH",
    }))).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await expect(withSalon(data.salonId, (tx) => closeComandaReliably(tx, {
      ...input,
      idempotencyKey: crypto.randomUUID(),
    }))).rejects.toMatchObject({ code: "PAYMENT_ALREADY_EXISTS" });

    await expect(prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      select: { status: true, version: true },
    })).resolves.toEqual({ status: "COMPLETED", version: 1 });
    expect(await prisma.payment.count({ where: { appointmentId: appointment.id } })).toBe(1);
    expect(await prisma.appointmentEvent.count({ where: { appointmentId: appointment.id } })).toBe(0);
    expect(await prisma.auditLog.count({
      where: { entityId: appointment.id, action: "COMANDA_CLOSED" },
    })).toBe(1);
  });

  it("rejeita Payment preexistente sem reescrever paidAt ou valor", async () => {
    const data = await fixture();
    const appointment = await data.appointment();
    const paidAt = new Date("2026-08-10T12:00:00.000Z");
    const payment = await prisma.payment.create({
      data: {
        appointmentId: appointment.id,
        amountCents: 4_500,
        discountCents: 500,
        method: "CASH",
        paidAt,
      },
      select: { id: true },
    });

    await expect(withSalon(data.salonId, (tx) => closeComandaReliably(
      tx,
      checkoutInput(data, appointment),
    ))).rejects.toMatchObject({ code: "PAYMENT_ALREADY_EXISTS" });
    await expect(prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }))
      .resolves.toMatchObject({ amountCents: 4_500, discountCents: 500, method: "CASH", paidAt });
  });

  it("impede desconto de recepcionista, inclusive payload de 100%, sem efeito parcial", async () => {
    const data = await fixture();
    const appointment = await data.appointment();
    for (const discountCents of [1, 5_000]) {
      await expect(withSalon(data.salonId, (tx) => closeComandaReliably(tx, checkoutInput(
        data,
        appointment,
        { role: "RECEPTIONIST", discountCents },
      )))).rejects.toMatchObject({ code: "DISCOUNT_FORBIDDEN" });
    }
    expect(await prisma.payment.count({ where: { appointmentId: appointment.id } })).toBe(0);

    await expect(withSalon(data.salonId, (tx) => closeComandaReliably(tx, checkoutInput(
      data,
      appointment,
      { role: "MANAGER", discountCents: 5_000 },
    )))).resolves.toMatchObject({ duplicate: false });
    await expect(prisma.payment.findUniqueOrThrow({ where: { appointmentId: appointment.id } }))
      .resolves.toMatchObject({ amountCents: 0, discountCents: 5_000 });
  });

  it("reverte status, estoque, produtos, pagamento, evento e auditoria com a transação", async () => {
    const data = await fixture(2);
    const appointment = await data.appointment({ status: "CONFIRMED" });
    const input = checkoutInput(data, appointment, {
      productLines: [{ productId: data.productId, quantity: 1 }],
    });

    await expect(withSalon(data.salonId, async (tx) => {
      await closeComandaReliably(tx, input);
      throw new Error("rollback adversarial depois da comanda");
    })).rejects.toThrow("rollback adversarial");

    await expect(prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      select: { status: true, version: true },
    })).resolves.toEqual({ status: "CONFIRMED", version: 1 });
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 2 });
    expect(await prisma.appointmentProduct.count({ where: { appointmentId: appointment.id } })).toBe(0);
    expect(await prisma.payment.count({ where: { appointmentId: appointment.id } })).toBe(0);
    expect(await prisma.appointmentEvent.count({ where: { appointmentId: appointment.id } })).toBe(0);
    expect(await prisma.auditLog.count({
      where: { salonId: data.salonId, OR: [{ entityId: appointment.id }, { entityId: data.productId }] },
    })).toBe(0);
  });

  it("serializa duas comandas no mesmo produto e audita saldos verdadeiros", async () => {
    const data = await fixture(2);
    const firstAppointment = await data.appointment({ clientIndex: 0, minute: 0 });
    const secondAppointment = await data.appointment({ clientIndex: 1, minute: 0 });

    await Promise.all([
      withSalon(data.salonId, (tx) => closeComandaReliably(tx, checkoutInput(
        data,
        firstAppointment,
        { productLines: [{ productId: data.productId, quantity: 1 }] },
      ))),
      withSalon(data.salonId, (tx) => closeComandaReliably(tx, checkoutInput(
        data,
        secondAppointment,
        { productLines: [{ productId: data.productId, quantity: 1 }] },
      ))),
    ]);

    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 0 });
    expect(await prisma.payment.count({
      where: { appointmentId: { in: [firstAppointment.id, secondAppointment.id] } },
    })).toBe(2);

    const stockAudits = await prisma.auditLog.findMany({
      where: {
        salonId: data.salonId,
        entityId: data.productId,
        action: "STOCK_ADJUSTED",
      },
      select: { metadata: true },
    });
    expect(stockAudits).toHaveLength(2);
    const balances = stockAudits.map((entry) => {
      const metadata = jsonObject(entry.metadata);
      return `${metadata.previousStock}->${metadata.newStock}`;
    });
    expect(balances.sort()).toEqual(["1->0", "2->1"]);
  });

  it("rejeita produto cross-tenant no núcleo sem estoque ou vínculo parcial", async () => {
    const own = await fixture(4);
    const foreign = await fixture(7);
    const appointment = await own.appointment();

    await expect(withSalon(own.salonId, (tx) => reserveAppointmentProducts(tx, {
      salonId: own.salonId,
      appointmentId: appointment.id,
      actorName: "Ataque CI",
      items: [{ productId: foreign.productId, quantity: 1 }],
    }))).rejects.toMatchObject({ code: "PRODUCT_INVALID" });

    await expect(prisma.product.findUniqueOrThrow({
      where: { id: foreign.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 7 });
    expect(await prisma.appointmentProduct.count({
      where: { appointmentId: appointment.id },
    })).toBe(0);
  });

  it("checkout rejeita appointment e produto estrangeiros sem efeito financeiro", async () => {
    const own = await fixture(4);
    const foreign = await fixture(7);
    const ownAppointment = await own.appointment();
    const foreignAppointment = await foreign.appointment();

    await expect(withSalon(own.salonId, (tx) => closeComandaReliably(
      tx,
      checkoutInput(own, foreignAppointment),
    ))).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(withSalon(own.salonId, (tx) => closeComandaReliably(
      tx,
      checkoutInput(own, ownAppointment, {
        productLines: [{ productId: foreign.productId, quantity: 1 }],
      }),
    ))).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });

    expect(await prisma.payment.count({
      where: { appointmentId: { in: [ownAppointment.id, foreignAppointment.id] } },
    })).toBe(0);
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: foreign.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 7 });
    expect(await prisma.appointmentProduct.count({
      where: { appointmentId: ownAppointment.id },
    })).toBe(0);
  });

  it("serializa duas reservas do mesmo appointment e grava estoque/audit/vínculo uma vez", async () => {
    const data = await fixture(5);
    const appointment = await data.appointment();
    const losingProduct = await prisma.product.create({
      data: {
        salonId: data.salonId,
        name: "Produto concorrente perdedor",
        priceCents: 2_000,
        costCents: 500,
        stock: 8,
      },
      select: { id: true },
    });
    const releaseFirst = deferred<void>();
    const firstHasLock = deferred<number>();
    const secondHasBackend = deferred<number>();
    const firstApplicationName = `reservation-winner-${crypto.randomUUID()}`;
    const secondApplicationName = `reservation-loser-${crypto.randomUUID()}`;

    const first = withSalon(data.salonId, async (tx) => {
      const pid = await identifyBackend(tx, firstApplicationName);
      await lockAppointmentOperationalScope(tx, {
        salonId: data.salonId,
        appointmentId: appointment.id,
      });
      firstHasLock.resolve(pid);
      await releaseFirst.promise;
      return reserveAppointmentProducts(tx, {
        salonId: data.salonId,
        appointmentId: appointment.id,
        actorName: "Cliente um",
        items: [{ productId: data.productId, quantity: 1 }],
      });
    });
    const firstPid = await withTestTimeout(firstHasLock.promise);

    const second = withSalon(data.salonId, async (tx) => {
      const pid = await identifyBackend(tx, secondApplicationName);
      secondHasBackend.resolve(pid);
      return reserveAppointmentProducts(tx, {
        salonId: data.salonId,
        appointmentId: appointment.id,
        actorName: "Cliente dois",
        items: [{ productId: losingProduct.id, quantity: 2 }],
      });
    });

    let blocked!: BlockedActivity;
    let secondPid!: number;
    let observationError: unknown;
    try {
      secondPid = await withTestTimeout(secondHasBackend.promise);
      blocked = await waitForBlockedActivity(secondApplicationName, firstPid);
    } catch (error) {
      observationError = error;
    } finally {
      // Libera sempre o vencedor, inclusive quando a observacao falha, para
      // nao deixar conexoes presas ate o timeout da suite.
      releaseFirst.resolve();
    }

    const results = await withTestTimeout(Promise.allSettled([first, second]));
    if (observationError) throw observationError;
    expect(blocked).toMatchObject({ pid: secondPid, waitEventType: "Lock" });
    expect(blocked.blockers).toContain(firstPid);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toBeDefined();
    assertNotDeadlock(rejected!.reason);
    expect(errorCode(rejected!.reason)).toBe("RESERVATION_ALREADY_EXISTS");
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 4 });
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: losingProduct.id },
      select: { stock: true },
    })).resolves.toEqual({ stock: 8 });
    expect(await prisma.appointmentProduct.count({
      where: { appointmentId: appointment.id },
    })).toBe(1);
    expect(await prisma.appointmentProduct.count({
      where: { appointmentId: appointment.id, productId: losingProduct.id },
    })).toBe(0);
    expect(await prisma.auditLog.count({
      where: {
        salonId: data.salonId,
        action: "STOCK_ADJUSTED",
        metadata: { path: ["kind"], equals: "RESERVATION" },
      },
    })).toBe(1);
  });

  it("create+reserve com a mesma idempotency key aplica estoque e audit uma vez", async () => {
    const data = await fixture(5);
    const idempotencyKey = crypto.randomUUID();
    const input = {
      appointment: {
        salonId: data.salonId,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2030-01-10T12:00",
        origin: "PUBLIC" as const,
        actor: { type: "CLIENT" as const, id: data.clientId, name: "Cliente A" },
        idempotencyKey,
        enforceBookingWindow: false,
        clientId: data.clientId,
      },
      productReservation: {
        actorName: "Cliente A",
        items: [{ productId: data.productId, quantity: 1 }],
      },
    };

    const first = await withSalon(data.salonId, (tx) =>
      createAppointmentWithProductReservation(tx, input));
    const retry = await withSalon(data.salonId, (tx) =>
      createAppointmentWithProductReservation(tx, input));
    await expect(withSalon(data.salonId, (tx) =>
      createAppointmentWithProductReservation(tx, {
        ...input,
        productReservation: {
          ...input.productReservation,
          items: [{ productId: data.productId, quantity: 2 }],
        },
      }))).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });

    expect(first.duplicate).toBe(false);
    expect(retry).toMatchObject({
      duplicate: true,
      appointment: { id: first.appointment.id },
    });
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 4 });
    expect(await prisma.appointmentProduct.count({
      where: { appointmentId: first.appointment.id, productId: data.productId },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: {
        salonId: data.salonId,
        entityId: data.productId,
        action: "STOCK_ADJUSTED",
        metadata: { path: ["kind"], equals: "RESERVATION" },
      },
    })).toBe(1);
  });

  it("rejeita carrinhos divergentes concorrentes com a mesma chave idempotente", async () => {
    const data = await fixture(5);
    const idempotencyKey = crypto.randomUUID();
    const gate = concurrentGate(2);
    const makeInput = (quantity: number) => ({
      appointment: {
        salonId: data.salonId,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2030-01-10T13:00",
        origin: "PUBLIC" as const,
        actor: { type: "CLIENT" as const, id: data.clientId, name: "Cliente A" },
        idempotencyKey,
        enforceBookingWindow: false,
        clientId: data.clientId,
      },
      productReservation: {
        actorName: "Cliente A",
        items: [{ productId: data.productId, quantity }],
      },
    });

    const results = await withTestTimeout(Promise.allSettled([1, 2].map((quantity) =>
      withSalon(data.salonId, async (tx) => {
        await gate();
        return createAppointmentWithProductReservation(tx, makeInput(quantity));
      }))));

    const fulfilled = results.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<
        typeof createAppointmentWithProductReservation
      >>> => result.status === "fulfilled",
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toBeDefined();
    expect(rejected).toBeDefined();
    expect(errorCode(rejected!.reason)).toBe("IDEMPOTENCY_MISMATCH");
    assertNotDeadlock(rejected!.reason);

    const reservation = await prisma.appointmentProduct.findFirstOrThrow({
      where: { appointmentId: fulfilled!.value.appointment.id },
      select: { quantity: true },
    });
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 5 - reservation.quantity });
    expect(await prisma.auditLog.count({
      where: {
        salonId: data.salonId,
        entityId: data.productId,
        action: "STOCK_ADJUSTED",
        metadata: { path: ["kind"], equals: "RESERVATION" },
      },
    })).toBe(1);
  });

  it("checkout e cancelamento concorrentes terminam sem deadlock e só um confirma", async () => {
    const data = await fixture(10);
    const appointment = await data.appointment({
      status: "CONFIRMED",
      startAt: new Date("2032-08-05T13:00:00.000Z"),
    });
    await data.reserveProduct(appointment.id, 1, 800);

    const gate = concurrentGate(2);
    const results = await withTestTimeout(Promise.allSettled([
      withSalon(data.salonId, async (tx) => {
        await gate();
        return closeComandaReliably(tx, checkoutInput(
          data,
          appointment,
          {
            productLines: [{ productId: data.productId, quantity: 1 }],
            now: new Date("2032-08-05T14:00:00.000Z"),
          },
        ));
      }),
      withSalon(data.salonId, async (tx) => {
        await gate();
        return cancelAppointmentReliably(tx, {
          salonId: data.salonId,
          appointmentId: appointment.id,
          actor: { type: "STAFF", id: data.userId, name: "Operador CI" },
          idempotencyKey: crypto.randomUUID(),
          expectedVersion: appointment.version,
          reason: "Cancelamento concorrente",
          enforceClientPolicy: false,
          now: new Date("2032-08-01T12:00:00.000Z"),
        });
      }),
    ]));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toBeDefined();
    assertNotDeadlock(rejected!.reason);
    expect(["ALREADY_CLOSED", "APPOINTMENT_CLOSED", "VERSION_CONFLICT"])
      .toContain(errorCode(rejected!.reason));
    const final = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      select: { status: true },
    });
    expect(["COMPLETED", "CANCELLED"]).toContain(final.status);
    expect(await prisma.payment.count({ where: { appointmentId: appointment.id } }))
      .toBe(final.status === "COMPLETED" ? 1 : 0);
    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: final.status === "COMPLETED" ? 9 : 10 });
  });

  it("checkout, nova reserva e ajuste concorrentes serializam o mesmo produto", async () => {
    const data = await fixture(2);
    const checkoutAppointment = await data.appointment({ clientIndex: 0, minute: 0 });
    const reservationAppointment = await data.appointment({ clientIndex: 1, minute: 30 });

    await Promise.all([
      withSalon(data.salonId, (tx) => closeComandaReliably(tx, checkoutInput(
        data,
        checkoutAppointment,
        { productLines: [{ productId: data.productId, quantity: 1 }] },
      ))),
      withSalon(data.salonId, (tx) => reserveAppointmentProducts(tx, {
        salonId: data.salonId,
        appointmentId: reservationAppointment.id,
        actorName: "Cliente concorrente",
        items: [{ productId: data.productId, quantity: 1 }],
      })),
      withSalon(data.salonId, (tx) => adjustProductStockReliably(tx, {
        salonId: data.salonId,
        productId: data.productId,
        delta: 2,
        userId: data.userId,
        actorName: "Operador CI",
        reason: "Compra concorrente",
        kind: "PURCHASE",
      })),
    ]);

    await expect(prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { stock: true },
    })).resolves.toEqual({ stock: 2 });
    expect(await prisma.payment.count({ where: { appointmentId: checkoutAppointment.id } })).toBe(1);
    expect(await prisma.appointmentProduct.count({
      where: { appointmentId: reservationAppointment.id },
    })).toBe(1);
  });
});
