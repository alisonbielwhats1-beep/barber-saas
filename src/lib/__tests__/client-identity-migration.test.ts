import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("migration de identidade de cliente", () => {
  it("prepara normalização e vínculo por tenant sem unir perfis automaticamente", () => {
    const migration = source("prisma/migrations/20260822120000_client_identity_resolution/migration.sql");
    const manual = source("prisma/sql/manual/014_client_identity_resolution.sql");
    const preflight = source("prisma/sql/manual/014_client_identity_resolution.preflight.sql");

    for (const sql of [migration, manual]) {
      expect(sql).toContain('"phoneNormalized"');
      expect(sql).toContain('"mergedIntoId"');
      expect(sql).toContain('"ClientProfile_mergedInto_tenant_fkey"');
      expect(sql).toContain("REFERENCES \"ClientProfile\"(\"id\", \"salonId\")");
      expect(sql).toContain("^55[0-9]{10,11}$");
      expect(sql).toContain("^[0-9]{10,11}$");
      expect(sql).not.toMatch(/DELETE\s+FROM\s+"ClientProfile"/i);
    }
    expect(preflight).toContain("current_database()");
    expect(preflight).toContain("profile_ids");
    expect(preflight).toContain("Números compartilhados não devem ser unidos automaticamente");
    expect(preflight.replace(/--.*$/gm, "")).not.toMatch(/\b(ALTER|CREATE|DELETE|DROP|INSERT|TRUNCATE|UPDATE)\b/i);
  });
});
