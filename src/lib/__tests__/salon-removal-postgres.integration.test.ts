import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { assertSafeDatabaseOperation } from "../database-safety";
import { inspectSalonRemoval, removeEmptySalon } from "../salon-removal";
import { archivedSalonIds, setSalonArchived } from "../salon-history";
import type { Tx } from "../prisma-tenant";
vi.mock("server-only", () => ({}));
const suite = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

suite("safe empty salon deletion and reversible history with PostgreSQL", () => {
  const db = new PrismaClient();
  let adminId: string, ownerId: string;
  const scope = <T>(actor: string, operation: (tx: Tx) => Promise<T>) => db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE salon_removal_ci");
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${actor}, true)`;
    await tx.$executeRaw`SELECT set_config('app.hq_access', 'enabled', true)`;
    return operation(tx);
  }, { timeout: 15000 });
  async function salon(status: "SUSPENDED" | "APPROVED" = "SUSPENDED") {
    return db.salon.create({ data: { name: "Empty synthetic salon", slug: `removal-${crypto.randomUUID()}`, accessStatus: status,
      memberships: { create: { userId: ownerId, role: "OWNER" } },
      accessEvents: { create: { actorUserId: adminId, type: "SUSPENDED", newStatus: status, newPlan: "FREE" } },
    } });
  }
  beforeAll(async () => {
    assertSafeDatabaseOperation(process.env, { operation: "salon-removal-integration" });
    // Model the legacy production dependency absent from Prisma. Synthetic only.
    await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "ProductSale" (id text PRIMARY KEY, "salonId" text NOT NULL REFERENCES "Salon"(id) ON DELETE CASCADE)');
    await db.$executeRawUnsafe('ALTER TABLE "ProductSale" ENABLE ROW LEVEL SECURITY');
    await db.$executeRawUnsafe('ALTER TABLE "ProductSale" FORCE ROW LEVEL SECURITY');
    await db.$executeRawUnsafe('CREATE POLICY removal_legacy_tenant ON "ProductSale" USING ("salonId"=current_setting(\'app.current_salon\',true))');
    await db.$executeRawUnsafe("DO $$ BEGIN CREATE ROLE salon_removal_ci NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    await db.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO salon_removal_ci");
    await db.$executeRawUnsafe("GRANT SELECT ON ALL TABLES IN SCHEMA public TO salon_removal_ci");
    await db.$executeRawUnsafe('GRANT DELETE, UPDATE ON "Salon" TO salon_removal_ci');
    await db.$executeRawUnsafe("GRANT INSERT ON hq_activities TO salon_removal_ci");
    await db.$executeRawUnsafe("GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO salon_removal_ci");
    await db.$executeRawUnsafe('ALTER TABLE "Salon" ENABLE ROW LEVEL SECURITY');
    await db.$executeRawUnsafe('ALTER TABLE "Salon" FORCE ROW LEVEL SECURITY');
    await db.$executeRawUnsafe('CREATE POLICY salon_removal_ci_read ON "Salon" FOR SELECT TO salon_removal_ci USING (true)');
    await db.$executeRawUnsafe('CREATE POLICY salon_removal_ci_update ON "Salon" FOR UPDATE TO salon_removal_ci USING (id=current_setting(\'app.current_salon\',true))');
    await db.$executeRawUnsafe('CREATE POLICY salon_removal_ci_delete ON "Salon" FOR DELETE TO salon_removal_ci USING (id=current_setting(\'app.current_salon\',true))');
    const user = (platformRole: "SUPER_ADMIN" | "USER") => db.user.create({ data: { name: "Removal synthetic user", email: `${crypto.randomUUID()}@example.test`, passwordHash: "synthetic-never-login", platformRole } });
    adminId = (await user("SUPER_ADMIN")).id; ownerId = (await user("USER")).id;
  });
  afterAll(() => db.$disconnect());
  it("deletes only an empty disabled salon, retaining login and independent administrative history", async () => {
    const target = await salon();
    await scope(adminId, tx => removeEmptySalon(tx, adminId, target.id, target.slug));
    expect(await db.salon.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await db.user.findUnique({ where: { id: ownerId } })).not.toBeNull();
    const event = await db.hqActivities.findFirstOrThrow({ where: { entityType: "Salon", entityId: target.id } });
    expect(event.metadata).toMatchObject({ decisions: [{ type: "SUSPENDED" }] });
  });
  it("preserves client profiles and rejects active salons, ordinary users and stale confirmations", async () => {
    const target = await salon();
    const client = await db.clientProfile.create({ data: { salonId: target.id, name: "Must survive" } });
    await expect(scope(adminId, tx => removeEmptySalon(tx, adminId, target.id, target.slug))).rejects.toThrow("Exclusão bloqueada");
    expect(await db.clientProfile.findUnique({ where: { id: client.id } })).not.toBeNull();
    await expect(scope(ownerId, tx => inspectSalonRemoval(tx, ownerId, target.id))).rejects.toThrow("Acesso restrito");
    const active = await salon("APPROVED");
    await expect(scope(adminId, tx => removeEmptySalon(tx, adminId, active.id, active.slug))).rejects.toThrow("Exclusão bloqueada");
    const empty = await salon();
    await expect(scope(adminId, tx => removeEmptySalon(tx, adminId, empty.id, "wrong-slug"))).rejects.toThrow("identificador exato");
    expect(await db.salon.findUnique({ where: { id: empty.id } })).not.toBeNull();
  });
  it("archives and restores a salon with clients without changing any customer or access", async () => {
    const target = await salon();
    const client = await db.clientProfile.create({ data: { salonId: target.id, name: "Historical client" } });
    await scope(adminId, tx => setSalonArchived(tx, adminId, target.id, true));
    expect(await scope(adminId, archivedSalonIds)).toContain(target.id);
    await scope(adminId, tx => setSalonArchived(tx, adminId, target.id, false));
    expect(await scope(adminId, archivedSalonIds)).not.toContain(target.id);
    expect(await db.clientProfile.findUnique({ where: { id: client.id } })).toEqual(client);
    expect(await db.salon.findUnique({ where: { id: target.id } })).toEqual(target);
  });
  it("preserves legacy product sales not modeled by Prisma", async () => {
    const target = await salon();
    const saleId = crypto.randomUUID();
    await db.$executeRaw`INSERT INTO "ProductSale" (id,"salonId") VALUES (${saleId},${target.id})`;
    await expect(scope(adminId, tx => removeEmptySalon(tx, adminId, target.id, target.slug))).rejects.toThrow("Exclusão bloqueada");
    expect(await db.$queryRaw`SELECT id FROM "ProductSale" WHERE id=${saleId}`).toEqual([{ id: saleId }]);
  });
});
