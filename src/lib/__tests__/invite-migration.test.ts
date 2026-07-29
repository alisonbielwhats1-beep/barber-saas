import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260728220000_fase_1_security_invites",
  "migration.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("migration de persistência dos convites", () => {
  it("mantém exatamente um convite pendente por e-mail normalizado e salão", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "UserInvite_salonId_normalizedEmail_pending_key"\s+ON "UserInvite"\(\s*"salonId",\s*lower\(btrim\("email"\)\)\s*\)\s+WHERE "usedAt" IS NULL;/,
    );
    expect(sql).not.toContain(
      'CREATE UNIQUE INDEX "UserInvite_salonId_email_pending_key"',
    );
  });

  it("permite convite bloqueado sem criar User global", () => {
    expect(sql).toContain('"email" TEXT NOT NULL');
    expect(sql).toContain('"userId" TEXT,');
    expect(sql).toContain(
      '"emailVerificationRequired" BOOLEAN NOT NULL DEFAULT true',
    );
    expect(sql).not.toContain('"passwordSetupRequired"');
  });

  it("habilita RLS e revoga anon/authenticated sem policy pública", () => {
    expect(sql).toContain(
      'ALTER TABLE "UserInvite" ENABLE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "UserInvite" FROM anon, authenticated;',
    );
    expect(sql).not.toMatch(
      /CREATE\s+POLICY[\s\S]*?\sON\s+"UserInvite"/i,
    );
  });

  it("preserva o bypass do backend e não infere passwordSetAt por backfill", () => {
    expect(sql).not.toContain(
      'ALTER TABLE "UserInvite" FORCE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'ADD COLUMN "passwordSetAt" TIMESTAMP(3);',
    );
    expect(sql).not.toMatch(
      /UPDATE\s+"User"\s+SET\s+"passwordSetAt"/i,
    );
  });
});
