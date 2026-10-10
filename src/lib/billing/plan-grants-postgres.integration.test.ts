import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { assertSafeDatabaseOperation } from "../database-safety";
import type { Tx } from "../prisma-tenant";
import { grantPlan } from "./plan-grants";
import { effectiveEntitlement } from "./entitlements";
vi.mock("server-only", () => ({}));

const pg = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;
pg("plan grants with real PostgreSQL permissions", () => {
  const admin = new PrismaClient();
  let runtime: PrismaClient;
  let actorId: string, ownerId: string, salonId: string, otherSalon: string;
  const now = new Date("2026-10-09T15:00:00Z");
  const end = new Date("2026-10-20T03:00:00Z");
  const requestKey = randomUUID();
  const input = () => ({ salonId, requestKey, plan: "INDIVIDUAL", through: "2026-10-19", reason: "Synthetic authorized trial" });
  async function scope<T>(userId: string, tenant: string, hq: boolean, fn: (tx: Tx) => Promise<T>) {
    return runtime.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_salon', ${tenant}, true)`;
      await tx.$executeRaw`SELECT set_config('app.hq_access', ${hq ? "enabled" : "disabled"}, true)`;
      return fn(tx);
    });
  }
  beforeAll(async () => {
    assertSafeDatabaseOperation(process.env, { operation: "plan-grants-postgres-integration" });
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_ENABLED", "false");
    await admin.$executeRawUnsafe("DO $$ BEGIN CREATE ROLE grant_test_runtime LOGIN PASSWORD 'synthetic-grant-only' NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    await admin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO grant_test_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT ON "User", "Membership", "Salon", "Professional", "UserInvite", "BillingSubscription", "BillingEvent" TO grant_test_runtime');
    await admin.$executeRawUnsafe('GRANT EXECUTE ON FUNCTION hq_is_admin() TO grant_test_runtime');
    // Other schema-smoke suites enable Salon RLS with policies limited to their own roles.
    // Match 01_enable_rls.sql's public Salon SELECT, scoped to this synthetic role.
    // The new grant table keeps its actual tenant/admin policies unchanged.
    await admin.$executeRawUnsafe('ALTER TABLE "Salon" ENABLE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('ALTER TABLE "Salon" FORCE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('DROP POLICY IF EXISTS grant_ci_salon_read ON "Salon"');
    await admin.$executeRawUnsafe('CREATE POLICY grant_ci_salon_read ON "Salon" FOR SELECT TO grant_test_runtime USING (true)');
    await admin.$executeRawUnsafe('GRANT SELECT,INSERT ON "SalonPlanGrant" TO grant_test_runtime');
    await admin.$executeRawUnsafe('GRANT UPDATE("revokedAt") ON "SalonPlanGrant" TO grant_test_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT,INSERT,UPDATE ON hq_accounts,hq_customers TO grant_test_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT,INSERT ON hq_activities TO grant_test_runtime');
    const actor = await admin.user.create({ data: { name: "Grant admin", email: randomUUID()+"@example.test", passwordHash: "synthetic", platformRole: "SUPER_ADMIN" } });
    const owner = await admin.user.create({ data: { name: "Owner", email: randomUUID()+"@example.test", passwordHash: "synthetic" } });
    actorId = actor.id; ownerId = owner.id;
    salonId = (await admin.salon.create({ data: { name: "Grant synthetic", slug: randomUUID(), accessStatus: "APPROVED", timezone: "America/Sao_Paulo" } })).id;
    otherSalon = (await admin.salon.create({ data: { name: "Unrelated protected customer", slug: randomUUID(), plan: "PRO", accessStatus: "APPROVED" } })).id;
    await admin.membership.create({ data: { salonId, userId: ownerId, role: "OWNER" } });
    const url = new URL(process.env.DATABASE_URL!); url.username = "grant_test_runtime"; url.password = "synthetic-grant-only";
    runtime = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  });
  afterAll(async () => { await runtime?.$disconnect(); await admin.$disconnect(); vi.unstubAllEnvs(); });

  it("is not a superuser/BYPASSRLS and has FORCE RLS", async () => {
    const roles = await runtime.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(roles).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    const tables = await admin.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public."SalonPlanGrant"'::regclass`;
    expect(tables).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });
  it("atomically grants catalog terms, replay, audit and HQ trial without changing unrelated customers", async () => {
    const before = await admin.salon.findUniqueOrThrow({ where: { id: otherSalon } });
    const paymentCount = await admin.hqPayments.count();
    const [first, replay] = await Promise.all([1,2].map(() => scope(actorId, salonId, true, tx => grantPlan(tx, actorId, input(), now))));
    expect(first.id).toBe(replay.id);
    expect(first).toMatchObject({ planCode: "INDIVIDUAL", amountCents: 3990, agendaLimit: 1, endsAt: end });
    expect(await admin.salonPlanGrant.count({ where: { salonId } })).toBe(1);
    expect(await admin.hqActivities.count({ where: { entityId: first.id } })).toBe(1);
    expect(await admin.hqCustomers.findFirst({ where: { accountIdRelation: { billingSalonId: salonId } } })).toMatchObject({ status: "Teste" });
    expect(await admin.hqPayments.count()).toBe(paymentCount);
    expect(await admin.billingSubscription.count({ where: { salonId } })).toBe(0);
    expect(await admin.salon.findUniqueOrThrow({ where: { id: otherSalon } })).toEqual(before);
    expect((await admin.salon.findUniqueOrThrow({ where: { id: salonId } })).plan).toBe("FREE");
  });
  it("isolates the tenant, rejects owner writes and requires HQ authorization even for admin", async () => {
    expect(await scope(ownerId, otherSalon, false, tx => tx.salonPlanGrant.count({ where: { salonId } }))).toBe(0);
    expect(await scope(ownerId, salonId, false, tx => tx.salonPlanGrant.count({ where: { salonId } }))).toBe(1);
    await expect(scope(ownerId, salonId, false, tx => grantPlan(tx, ownerId, { ...input(), requestKey: randomUUID() }, now))).rejects.toThrow("administração");
    const grant = await admin.salonPlanGrant.findFirstOrThrow({ where: { salonId } });
    const data = { ...grant, id: randomUUID(), salonId: otherSalon, requestKey: randomUUID(), actorUserId: ownerId };
    await expect(scope(ownerId, salonId, false, tx => tx.salonPlanGrant.create({ data }))).rejects.toThrow();
    await expect(scope(actorId, otherSalon, false, tx => tx.salonPlanGrant.create({ data: { ...data, actorUserId: actorId } }))).rejects.toThrow();
    expect(await scope(ownerId, salonId, false, tx => tx.salonPlanGrant.updateMany({ where: { salonId }, data: { revokedAt: now } }))).toEqual({ count: 0 });
  });
  it("expires at exact midnight while preserving grant, account and history", async () => {
    const before = await scope(ownerId, salonId, false, tx => effectiveEntitlement(tx, salonId, "FREE", new Date(end.getTime()-1)));
    const after = await scope(ownerId, salonId, false, tx => effectiveEntitlement(tx, salonId, "FREE", end));
    expect(before).toMatchObject({ label: "Individual", monthlyAppointments: null, maxProfessionals: 1 });
    expect(after).toMatchObject({ monthlyAppointments: 30, maxProfessionals: 1 });
    expect(await admin.salonPlanGrant.count({ where: { salonId } })).toBe(1);
    expect(await admin.hqAccounts.count({ where: { billingSalonId: salonId } })).toBe(1);
  });
  it("blocks history deletion and term rewrites, including direct owner SQL", async () => {
    await expect(scope(actorId, salonId, true, tx => tx.salonPlanGrant.updateMany({ where: { salonId }, data: { amountCents: 1 } }))).rejects.toThrow();
    await expect(scope(actorId, salonId, true, tx => tx.salonPlanGrant.deleteMany({ where: { salonId } }))).rejects.toThrow();
    await expect(admin.salonPlanGrant.updateMany({ where: { salonId }, data: { endsAt: new Date("2027-10-01") } })).rejects.toThrow("Only first revocation");
    await expect(admin.salonPlanGrant.deleteMany({ where: { salonId } })).rejects.toThrow("immutable");
  });
  it("preserves prior grants on replacement and refuses legacy customer changes", async () => {
    await scope(actorId, salonId, true, tx => grantPlan(tx, actorId, { ...input(), requestKey: randomUUID(), through: "2026-10-21" }, now));
    expect(await admin.salonPlanGrant.count({ where: { salonId } })).toBe(2);
    expect(await admin.salonPlanGrant.count({ where: { salonId, revokedAt: null } })).toBe(1);
    await expect(scope(actorId, otherSalon, true, tx => grantPlan(tx, actorId, { ...input(), salonId: otherSalon, requestKey: randomUUID() }, now))).rejects.toThrow("legado");
    expect(await admin.salonPlanGrant.count({ where: { salonId: otherSalon } })).toBe(0);
  });
});
