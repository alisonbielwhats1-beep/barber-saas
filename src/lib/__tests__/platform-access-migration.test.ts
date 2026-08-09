import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/sql/manual/010_platform_access_approval.sql"),
  "utf8",
);
const preflight = readFileSync(
  resolve("prisma/sql/manual/010_platform_access_approval.preflight.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve("prisma/sql/manual/010_platform_access_approval.rollback.sql"),
  "utf8",
);

describe("migration de aprovação da plataforma", () => {
  it("preserva salões existentes e deixa novos cadastros pendentes", () => {
    expect(migration).toMatch(/\bBEGIN;/);
    expect(migration).toMatch(/\bCOMMIT;/);
    expect(migration).not.toMatch(/^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/im);
    expect(migration).toContain("DEFAULT 'APPROVED'");
    expect(migration).toContain('ALTER COLUMN "accessStatus" SET DEFAULT \'PENDING\'');
    expect(migration).toContain('SET "accessRequestedAt" = "createdAt"');
    expect(migration).toContain('"SalonAccessEvent_single_request_key"');
  });

  it("protege histórico e administração com RLS", () => {
    expect(migration).toContain('ALTER TABLE "SalonAccessEvent" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('"platformRole" = \'SUPER_ADMIN\'');
    expect(migration).toContain('REVOKE ALL ON TABLE "SalonAccessEvent" FROM anon');
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE "SalonAccessEvent" TO app_runtime');
  });

  it("tem preflight somente leitura e rollback sem perda de dados", () => {
    expect(preflight).toMatch(/SELECT[\s\S]*information_schema/);
    expect(preflight).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    expect(rollback).toMatch(/\bBEGIN;/);
    expect(rollback).toMatch(/\bCOMMIT;/);
    expect(rollback).not.toMatch(/^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/im);
    expect(rollback).toContain('ALTER COLUMN "accessStatus" SET DEFAULT \'APPROVED\'');
  });
});
