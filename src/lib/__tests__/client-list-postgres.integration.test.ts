import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { hiddenClientIds, setClientListVisibility } from "../client-list-visibility";
import { assertSafeDatabaseOperation } from "../database-safety";

const suite = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;
let salonId = "", userId = "", clientId = "";
suite("lista de clientes no PostgreSQL", () => {
  beforeAll(async () => {
    assertSafeDatabaseOperation(process.env, { operation: "client-list-integration" });
    const key = crypto.randomUUID();
    const salon = await prisma.salon.create({ data: { slug: `list-${key}`, name: "Lista sintética", accessStatus: "APPROVED" } });
    salonId = salon.id;
    const user = await prisma.user.create({ data: { name: "Dono sintético", email: `${key}@example.test`, passwordHash: "synthetic-test-only" } });
    userId = user.id;
    const client = await prisma.clientProfile.create({ data: { salonId, name: "Cliente sintético", email: `client-${key}@example.test`, passwordHash: "synthetic-unchanged-hash", sessionVersion: 3 } });
    clientId = client.id;
    const professional = await prisma.professional.create({ data: { salonId, userId } });
    const service = await prisma.service.create({ data: { salonId, name: "Serviço", durationMin: 30, priceCents: 5000 } });
    await prisma.appointment.create({ data: { salonId, clientId, professionalId: professional.id, serviceId: service.id, startAt: new Date("2033-01-10T12:00:00Z"), endAt: new Date("2033-01-10T12:30:00Z"), priceCents: 5000, status: "CONFIRMED" } });
    await prisma.appointment.create({ data: { salonId, clientId, professionalId: professional.id, serviceId: service.id, startAt: new Date("2025-01-10T12:00:00Z"), endAt: new Date("2025-01-10T12:30:00Z"), priceCents: 5000, status: "COMPLETED", payment: { create: { amountCents: 5000, method: "PIX", currency: "BRL" } } } });
  });
  afterAll(async () => {
    if (salonId) await prisma.salon.delete({ where: { id: salonId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
  it("serializa exclusões repetidas, preserva acesso/histórico e restaura", async () => {
    const ctx = { salonId, userId };
    const snapshot = () => prisma.clientProfile.findUniqueOrThrow({ where: { id: clientId }, include: { appointments: { orderBy: { id: "asc" }, include: { payment: true } } } });
    const before = await snapshot();
    const set = (hidden: boolean) => withTenant(ctx, tx => setClientListVisibility(tx, { ...ctx, clientId, hidden }));
    await Promise.all([set(true), set(true), set(true)]);
    expect(await prisma.auditLog.count({ where: { salonId, entityId: clientId, action: "CLIENT_HIDDEN_FROM_LIST" } })).toBe(1);
    expect(await withTenant(ctx, tx => hiddenClientIds(tx, salonId))).toEqual(new Set([clientId]));
    expect(await snapshot()).toEqual(before);
    await withTenant(ctx, async tx => {
      await expect(setClientListVisibility(tx, { ...ctx, salonId: "different-tenant", clientId, hidden: true })).rejects.toThrow("Cliente não encontrado");
    });
    await set(false);
    expect(await withTenant(ctx, tx => hiddenClientIds(tx, salonId))).toEqual(new Set());
    expect(await snapshot()).toEqual(before);
  });
});
