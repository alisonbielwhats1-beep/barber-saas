import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "prisma/sql/manual/012_appointment_product_tenant_snapshots.sql"),
  "utf8",
);
const preflight = readFileSync(
  resolve(process.cwd(), "prisma/sql/manual/012_appointment_product_tenant_snapshots.preflight.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "prisma/sql/manual/012_appointment_product_tenant_snapshots.rollback.sql"),
  "utf8",
);

describe("migration tenant-aware de produtos e snapshots", () => {
  it("faz backfill e cria FKs compostas com RLS", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "salonId" TEXT');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "productName" TEXT');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "currency" TEXT');
    expect(migration).toContain('"AppointmentProduct_appointment_tenant_fkey"');
    expect(migration).toContain('"AppointmentProduct_product_tenant_fkey"');
    expect(migration).toContain('"Product_id_salonId_key"');
    expect(migration).toContain('"salonId" = app_current_salon()');
    expect(migration).toContain('ALTER TABLE "AppointmentProduct" FORCE ROW LEVEL SECURITY');
  });

  it("falha fechada antes de alterar dados quando encontra anomalias", () => {
    expect(migration).toContain("RAISE EXCEPTION '012 bloqueada: AppointmentProduct possui vínculo cross-tenant'");
    expect(migration).toContain("RAISE EXCEPTION '012 bloqueada: backfill de Payment incompleto'");
    expect(preflight).toMatch(/SELECT[\s\S]*cross_tenant_appointment_products/);
    expect(preflight).toMatch(/SELECT[\s\S]*payments_without_salon/);
    expect(preflight).toContain("to_regprocedure('app_current_salon()')");
    const executablePreflight = preflight.replace(/--[^\r\n]*/g, "");
    expect(executablePreflight).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
  });

  it("não apaga histórico em nenhum caminho de rollback", () => {
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i);
    expect(rollback).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN)\b/i);
    expect(rollback).toContain('SELECT');
  });
});
