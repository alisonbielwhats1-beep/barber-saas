import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { withSalon } from "@/lib/prisma-tenant";
import { assertSafeDatabaseOperation } from "@/lib/database-safety";

const pg = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

pg("assinaturas push em PostgreSQL descartável", () => {
  it("vincula aparelho ao cliente do salão, impede cross-tenant e preserva revogação", async () => {
    assertSafeDatabaseOperation(process.env, { operation: "client-push-integration" });
    const suffix = crypto.randomUUID();
    const salonA = await prisma.salon.create({ data: { slug: `push-a-${suffix}`, name: "Salão A", accessStatus: "APPROVED" } });
    const salonB = await prisma.salon.create({ data: { slug: `push-b-${suffix}`, name: "Salão B", accessStatus: "APPROVED" } });
    const clientA = await withSalon(salonA.id, tx => tx.clientProfile.create({ data: { salonId: salonA.id, name: "Cliente A" } }));
    const clientB = await withSalon(salonB.id, tx => tx.clientProfile.create({ data: { salonId: salonB.id, name: "Cliente B" } }));
    const endpoint = `https://fcm.googleapis.com/fcm/send/${suffix}`;
    const saved = await withSalon(salonA.id, tx => tx.clientPushSubscription.create({ data: {
      salonId: salonA.id, clientId: clientA.id, endpoint, p256dh: "synthetic-key", auth: "synthetic-auth",
    } }));
    const otherSalon = await withSalon(salonB.id, tx => tx.clientPushSubscription.create({ data: {
      salonId: salonB.id, clientId: clientB.id, endpoint, p256dh: "synthetic-key", auth: "synthetic-auth",
    } }));
    expect(await withSalon(salonA.id, tx => tx.clientPushSubscription.count({ where: { salonId: salonA.id, clientId: clientA.id, revokedAt: null } }))).toBe(1);
    expect(otherSalon.endpoint).toBe(saved.endpoint);
    await expect(withSalon(salonA.id, tx => tx.clientPushSubscription.create({ data: {
      salonId: salonA.id, clientId: clientB.id, endpoint: `${endpoint}-wrong`, p256dh: "key", auth: "auth",
    } }))).rejects.toThrow();
    await withSalon(salonA.id, tx => tx.clientPushSubscription.updateMany({ where: { id: saved.id, salonId: salonA.id, clientId: clientA.id }, data: { revokedAt: new Date() } }));
    expect(await withSalon(salonA.id, tx => tx.clientPushSubscription.count({ where: { salonId: salonA.id, clientId: clientA.id, revokedAt: null } }))).toBe(0);
    expect(await withSalon(salonB.id, tx => tx.clientPushSubscription.count({ where: { id: otherSalon.id, salonId: salonB.id, revokedAt: null } }))).toBe(1);
    const security = await prisma.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public."ClientPushSubscription"'::regclass
    `;
    expect(security[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
