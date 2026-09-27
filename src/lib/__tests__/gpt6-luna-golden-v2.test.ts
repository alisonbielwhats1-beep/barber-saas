import { describe, expect, it, vi } from "vitest";
import { createGpt6V2Manifest, GPT6_V2_CASE_IDS } from "../../../packages/salon-secretary/evaluation/gpt6-luna-golden-v2";
import { assertGpt6V2LocalEnvironment } from "../../../scripts/gpt6-luna-v2-fixtures";

const manifest = createGpt6V2Manifest("2026-09-22");
const find = (id: typeof GPT6_V2_CASE_IDS[number]) => manifest.cases.find(c => c.case_id === id)!;

describe("GPT-6 Luna Golden Battery V2 — offline manifest", () => {
  it("keeps ten historical capabilities in order, with isolated deterministic tenants and no confirmation", () => {
    expect(manifest.cases.map(c => c.case_id)).toEqual(GPT6_V2_CASE_IDS);
    expect(new Set(manifest.cases.map(c => c.fixture_refs.salon)).size).toBe(10);
    for (const item of manifest.cases) {
      expect(item.expected.confirmation_allowed).toBe(false);
      expect(item.historical).toMatchObject({ case_id: item.case_id, model: "gpt-5.6-luna", comparability: "FUNCTIONALLY_EQUIVALENT" });
      expect(item.message).not.toContain(item.fixture_refs.salon);
      expect(item.message).not.toContain(item.fixture_refs.owner);
      expect(item.message).not.toMatch(/\b(?:g6v2|[a-f0-9]{8}-[a-f0-9]{4})\b/);
      expect(item.preconditions.length).toBeGreaterThan(0);
    }
    expect(createGpt6V2Manifest("2026-09-22")).toEqual(manifest);
    expect(createGpt6V2Manifest("2026-09-23").cases[0]!.message).toBe(manifest.cases[0]!.message);
    expect(createGpt6V2Manifest("2026-09-23").cases[0]!.fixture_refs.salon).not.toBe(manifest.cases[0]!.fixture_refs.salon);
  });

  it("preserves the ten golden intents without weakening dependent cases", () => {
    expect(find("services-create").expected).toMatchObject({ operations: ["service.create"], fields: { priceCents: 5000, missing: ["durationMin"] }, proposal_state: "NEEDS_INPUT" });
    expect(find("services-price").expected).toMatchObject({ operations: ["service.change"], fields: { priceCents: 8000 } });
    expect(find("customers-create").expected.fields.name).toBe("Maria Clara de Alencar");
    expect(find("scheduling-create").expected).toMatchObject({ operations: ["appointment.create"], fields: { date: "2026-09-23", time: "10:00" } });
    expect(find("scheduling-change").expected).toMatchObject({ operations: ["appointment.change"], fields: { source_time: "10:00", time: "11:00" } });
    expect(find("scheduling-batch").expected).toMatchObject({ operations: ["appointment.cancel", "appointment.create"], dependencies: [{ from: 0, to: 1 }] });
    expect(find("scheduling-batch").message).toContain("Motivo: substituição solicitada pela equipe.");
    expect(find("financial-revenue").expected.fields).toEqual({ metrics: ["service_revenue"], period: "yesterday", expected_value_cents: 12000 });
    expect(find("inventory-low").expected.fields).toEqual({ low_stock: true, expected_names: ["Shampoo Aurora"] });
    expect(find("communication-exact").expected.fields).toMatchObject({ channel: "WHATSAPP", message_mode: "EXACT", content: "Serviço cancelado, Fábio." });
    expect(find("communication-dependent-name").expected).toMatchObject({ operations: ["appointment.cancel", "customer.message"], dependencies: [{ from: 0, to: 1 }], fields: { customer_name: "Amanda Maria de Souza", recipient_name: "Amanda Maria de Souza", service_name: null, message_mode: "EXACT" } });
  });

  it("rejects impossible base dates and confines tomorrow/yesterday to salon calendar", () => {
    expect(manifest.timezone).toBe("America/Sao_Paulo");
    expect(manifest.tomorrow).toBe("2026-09-23");
    expect(manifest.yesterday).toBe("2026-09-21");
    expect(() => createGpt6V2Manifest("2026-02-30")).toThrow();
    expect(() => createGpt6V2Manifest("tomorrow")).toThrow();
  });

  it("fails closed outside the exact disposable URLs, runtime/admin roles and unpaid allowlisted model", () => {
    const original = { APP_ENV:process.env.APP_ENV, VERCEL_ENV:process.env.VERCEL_ENV, DATABASE_URL:process.env.DATABASE_URL,
      DIRECT_URL:process.env.DIRECT_URL, SALON_SECRETARY_ALLOW_PAID_CALLS:process.env.SALON_SECRETARY_ALLOW_PAID_CALLS,
      SALON_SECRETARY_MODEL:process.env.SALON_SECRETARY_MODEL };
    try {
      vi.stubEnv("APP_ENV", "test"); vi.stubEnv("VERCEL_ENV", "");
      vi.stubEnv("DATABASE_URL", "postgresql://mvp_service_runtime:synthetic@127.0.0.1:55441/everflair_service_mvp");
      vi.stubEnv("DIRECT_URL", "postgresql://mvp_test_admin:synthetic@127.0.0.1:55441/everflair_service_mvp");
      vi.stubEnv("SALON_SECRETARY_ALLOW_PAID_CALLS", "false"); vi.stubEnv("SALON_SECRETARY_MODEL", "gpt-6-luna");
      expect(() => assertGpt6V2LocalEnvironment()).not.toThrow();
      vi.stubEnv("SALON_SECRETARY_MODEL", "gpt-5.6-luna");
      expect(() => assertGpt6V2LocalEnvironment()).not.toThrow();
      vi.stubEnv("SALON_SECRETARY_MODEL", "unknown-model");
      expect(() => assertGpt6V2LocalEnvironment()).toThrow("ACTIVE_MODEL_UNSUPPORTED");
      vi.stubEnv("SALON_SECRETARY_MODEL", "gpt-6-luna");
      vi.stubEnv("DATABASE_URL", "postgresql://mvp_service_runtime:synthetic@db.example.com:5432/everflair_service_mvp");
      expect(() => assertGpt6V2LocalEnvironment()).toThrow("DATABASE_URL_UNSAFE");
      vi.stubEnv("DATABASE_URL", "postgresql://mvp_service_runtime:synthetic@127.0.0.1:55441/everflair_service_mvp");
      vi.stubEnv("DIRECT_URL", "postgresql://postgres:synthetic@127.0.0.1:55441/everflair_service_mvp");
      expect(() => assertGpt6V2LocalEnvironment()).toThrow("DIRECT_URL_UNSAFE");
      vi.stubEnv("DIRECT_URL", "postgresql://mvp_test_admin:synthetic@127.0.0.1:55441/everflair_service_mvp");
      vi.stubEnv("SALON_SECRETARY_ALLOW_PAID_CALLS", "true");
      expect(() => assertGpt6V2LocalEnvironment()).toThrow("PAID_CALLS_NOT_DISABLED");
    } finally {
      for(const [key,value] of Object.entries(original)) vi.stubEnv(key,value);
      vi.unstubAllEnvs();
    }
  });
});
