import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/sql/manual/009_waitlist_reliability.sql"),
  "utf8",
);
const preflight = readFileSync(
  resolve("prisma/sql/manual/009_waitlist_reliability.preflight.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve("prisma/sql/manual/009_waitlist_reliability.rollback.sql"),
  "utf8",
);

describe("migration de confiabilidade da fila", () => {
  it("é aditiva, transacional e preserva dados", () => {
    expect(migration).toMatch(/\bBEGIN;/);
    expect(migration).toMatch(/\bCOMMIT;/);
    expect(migration).not.toMatch(/^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/im);
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "cancelledAt"');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "serviceSnapshots" JSONB');
    expect(migration).toContain("TIMESTAMPTZ(3)");
    expect(migration).toContain("AT TIME ZONE ''UTC''");
  });

  it("impede duplicidade ativa e associação cross-tenant", () => {
    expect(migration).toContain('"WaitlistEntry_active_client_key"');
    expect(migration).toContain('"WaitlistEntry_active_guest_key"');
    expect(migration).toContain('FOREIGN KEY ("appointmentId", "salonId")');
    expect(migration).toContain('FOREIGN KEY ("clientId", "salonId")');
    expect(migration).toContain('FOREIGN KEY ("professionalId", "salonId")');
    expect(migration).toContain('"fulfilledAt" IS NULL');
    expect(migration).toContain('"cancelledAt" IS NULL');
  });

  it("possui preflight somente leitura e rollback não destrutivo", () => {
    expect(preflight).toMatch(/SELECT[\s\S]*WaitlistEntry/);
    expect(preflight).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    expect(preflight).toContain('appointment."salonId" <> waitlist."salonId"');
    expect(preflight).toContain('client."salonId" <> waitlist."salonId"');
    expect(rollback).toMatch(/\bBEGIN;/);
    expect(rollback).toMatch(/\bCOMMIT;/);
    expect(rollback).not.toMatch(/^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/im);
    expect(rollback).toContain('ALTER COLUMN "serviceSnapshots" DROP NOT NULL');
    expect(rollback).toContain('DROP INDEX IF EXISTS "WaitlistEntry_active_guest_key"');
  });
});
