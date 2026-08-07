import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/sql/manual/009_product_sales.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve("prisma/sql/manual/009_product_sales.rollback.sql"),
  "utf8",
);
const preflight = readFileSync(
  resolve("prisma/sql/manual/009_product_sales.preflight.sql"),
  "utf8",
);

describe("migration de vendas avulsas de produtos", () => {
  it("é aditiva, transacional e armazena o instante com timezone", () => {
    expect(migration).toMatch(/\bBEGIN;/);
    expect(migration).toMatch(/\bCOMMIT;/);
    expect(migration).toContain('CREATE TABLE "ProductSale"');
    expect(migration).toContain('"soldAt"            TIMESTAMPTZ(3)');
    expect(migration).not.toMatch(/DROP\s+TABLE/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
  });

  it("impede estoque lógico inválido e retries duplicados", () => {
    expect(migration).toContain('CHECK (quantity > 0)');
    expect(migration).toContain('CHECK ("priceCentsUnit" >= 0)');
    expect(migration).toContain('UNIQUE ("salonId", "idempotencyKey")');
  });

  it("amarra produto e venda ao mesmo tenant e ativa RLS", () => {
    expect(migration).toContain('FOREIGN KEY ("productId", "salonId")');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('"salonId" = app_current_salon()');
    expect(migration).not.toMatch(/GRANT\s+.*\b(?:anon|authenticated)\b/i);
  });

  it("possui rollback não destrutivo", () => {
    expect(rollback).toMatch(/\bBEGIN;/);
    expect(rollback).toMatch(/\bCOMMIT;/);
    expect(rollback).not.toMatch(/DROP\s+TABLE/i);
    expect(rollback).not.toMatch(/DELETE\s+FROM/i);
  });

  it("possui preflight somente leitura", () => {
    const sqlWithoutComments = preflight.replace(/--.*$/gm, "");
    expect(sqlWithoutComments).toMatch(/SELECT[\s\S]*"Product"/);
    expect(sqlWithoutComments).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i,
    );
  });
});
