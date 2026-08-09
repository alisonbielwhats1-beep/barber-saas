import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "prisma/sql/manual/011_platform_billing.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "prisma/sql/manual/011_platform_billing.rollback.sql"),
  "utf8",
);

describe("migration de cobranças da plataforma", () => {
  it("mantém cobrança do SaaS separada e acessível apenas pelo SUPER_ADMIN", () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "PlatformInvoice"');
    expect(migration).toContain('"platformRole" = \'SUPER_ADMIN\'');
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).not.toMatch(/GRANT\s+DELETE/i);
  });

  it("impede valores inválidos e exige data ao marcar como pago", () => {
    expect(migration).toContain('"amountCents" > 0');
    expect(migration).toContain("status = 'PAID'");
    expect(migration).toContain('"paidDate" IS NOT NULL');
  });

  it("oferece rollback reversível sem apagar cobranças ou histórico", () => {
    expect(rollback).toContain("REVOKE SELECT, INSERT, UPDATE");
    expect(rollback).not.toMatch(/DROP\s+TABLE/i);
    expect(rollback).not.toMatch(/DELETE\s+FROM/i);
  });
});
