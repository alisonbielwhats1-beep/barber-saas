import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = source("prisma/sql/manual/016_booking_experience.sql");
const preflight = source("prisma/sql/manual/016_booking_experience.preflight.sql");
const rollback = source("prisma/sql/manual/016_booking_experience.rollback.sql");

describe("fase 016 — experiência de agendamento", () => {
  it("mantém o schema alinhado às regras de preço e aceite", () => {
    const schema = source("prisma/schema.prisma");
    expect(schema).toContain("enum PricingRuleTargetType");
    expect(schema).toContain("enum RescheduleProposalStatus");
    expect(schema).toContain("model ServicePricingRule");
    expect(schema).toContain("model RescheduleProposal");
    expect(schema).toMatch(/maxBookingLeadDays\s+Int\s+@default\(60\)/);
  });

  it("é transacional, preserva histórico e mantém invariantes multi-tenant", () => {
    expect(migration).toMatch(/\bBEGIN;/);
    expect(migration).toMatch(/\bCOMMIT;/);
    expect(migration).not.toMatch(/^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/im);
    expect(migration).toContain('FOREIGN KEY ("appointmentId", "salonId")');
    expect(migration).toContain('FOREIGN KEY ("targetProfessionalId", "salonId")');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "targetNotes" TEXT');
    expect(migration).toContain('WHERE "status" = \'PENDING\'');
    expect(migration).toContain('ALTER TABLE "ServicePricingRule" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "RescheduleProposal" FORCE ROW LEVEL SECURITY');
  });

  it("usa preflight somente leitura e rollback não destrutivo", () => {
    const withoutComments = preflight
      .replace(/--.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).toMatch(/\bSELECT\b[\s\S]*ServicePricingRule/);
    expect(withoutComments).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    expect(preflight).toContain("app_runtime");
    expect(preflight).toContain("salons_above_public_limit");
    expect(rollback).toMatch(/\bBEGIN;/);
    expect(rollback).toMatch(/\bCOMMIT;/);
    expect(rollback).not.toMatch(/^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/im);
    expect(rollback).toContain('ALTER COLUMN "maxBookingLeadDays" SET DEFAULT 90');
  });

  it("expõe preço e proposta nos fluxos certos", () => {
    expect(source("src/app/api/availability/route.ts")).toContain("servicePrices");
    expect(source("src/app/book/[salonSlug]/agendar/booking-flow.tsx")).toContain(
      "maxBookingDateKey",
    );
    expect(source("src/lib/reschedule-proposals.ts")).toContain(
      "appointment.reschedule_requested",
    );
    expect(source("src/app/book/[salonSlug]/minhas/minhas-list.tsx")).toContain(
      "/api/client/reschedule-proposal",
    );
    expect(source("src/app/(admin)/agenda/actions.ts")).toContain("promoteWaitlist");
  });

  it("mantém o schema-smoke responsável por aplicar e testar o rollback", () => {
    const workflow = source(".github/workflows/ci.yml");
    expect(workflow).toContain("016_booking_experience.preflight.sql");
    expect(workflow).toContain("016_booking_experience.sql");
    expect(workflow).toContain("016_booking_experience.rollback.sql");
  });
});
