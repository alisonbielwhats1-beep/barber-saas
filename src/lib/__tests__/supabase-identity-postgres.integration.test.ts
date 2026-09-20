import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { assertSafeDatabaseOperation } from "../database-safety";
const suite = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;
suite("Supabase identity mapping in PostgreSQL", () => {
  const db = new PrismaClient();
  const id = randomUUID();
  beforeAll(async () => {
    assertSafeDatabaseOperation(process.env, { operation: "identity-integration-test" });
    // Standalone PostgreSQL CI does not pre-create the Supabase API roles.
    await db.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$`);
    await db.authIdentity.create({ data: { id } });
  });
  afterAll(async () => { await db.authIdentity.delete({ where: { id } }); await db.$disconnect(); });
  it("keeps the global revocation table unavailable to public API roles", async () => {
    const rows = await db.$queryRaw<Array<{ anon: boolean; authenticated: boolean; rls: boolean; force: boolean }>>`
      SELECT has_table_privilege('anon', '"AuthIdentity"', 'SELECT') AS anon,
             has_table_privilege('authenticated', '"AuthIdentity"', 'SELECT') AS authenticated,
             relrowsecurity AS rls, relforcerowsecurity AS force
      FROM pg_class WHERE oid = '"AuthIdentity"'::regclass`;
    expect(rows).toEqual([{ anon: false, authenticated: false, rls: true, force: true }]);
  });
  it("serializes recovery commits so only one request consumes a session version", async () => {
    async function consume() {
      return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "AuthIdentity" WHERE id = ${id}::uuid FOR UPDATE`;
        const current = await tx.authIdentity.findUniqueOrThrow({ where: { id } });
        if (current.sessionVersion !== 0) return false;
        await tx.authIdentity.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
        return true;
      });
    }
    expect((await Promise.all([consume(), consume()])).sort()).toEqual([false, true]);
    expect((await db.authIdentity.findUniqueOrThrow({ where: { id } })).sessionVersion).toBe(1);
  });
});
