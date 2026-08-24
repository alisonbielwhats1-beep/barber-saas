import { describe, expect, it } from "vitest";
import { validateRuntimeContract } from "../runtime-contract";

const base = {
  APP_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/salon_test",
  DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/salon_test",
  NEXTAUTH_SECRET: "ci-only-secret-not-used-in-prod",
  NEXTAUTH_URL: "http://localhost:3000",
};

describe("validateRuntimeContract", () => {
  it("aceita o contrato mínimo do ambiente de testes", () => {
    expect(validateRuntimeContract(base)).toEqual([]);
  });

  it("não aceita produção fora da Vercel Production", () => {
    const issues = validateRuntimeContract({
      ...base,
      APP_ENV: "production",
      VERCEL_ENV: "preview",
      NEXTAUTH_URL: "https://salon-saas.example.com",
      SUPABASE_URL: "https://productionref.supabase.co",
      SUPABASE_ANON_KEY: "ci-anon",
      SUPABASE_SERVICE_ROLE_KEY: "ci-service",
      CRON_SECRET: "ci-cron",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "VERCEL_ENV" }),
      ]),
    );
  });

  it("exige referências diferentes para homologação e produção", () => {
    const issues = validateRuntimeContract({
      APP_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL:
        "postgresql://app_runtime:password@db.stagingref.supabase.co:5432/postgres",
      DIRECT_URL:
        "postgresql://postgres:password@db.stagingref.supabase.co:5432/postgres",
      NEXTAUTH_SECRET: "ci-only-secret-not-used-in-prod",
      NEXTAUTH_URL: "https://preview.example.com",
      SUPABASE_URL: "https://stagingref.supabase.co",
      SUPABASE_PROJECT_REF: "stagingref",
      PRODUCTION_SUPABASE_PROJECT_REF: "stagingref",
      SUPABASE_ANON_KEY: "ci-anon",
      SUPABASE_SERVICE_ROLE_KEY: "ci-service",
      CRON_SECRET: "ci-cron",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "SUPABASE_PROJECT_REF" }),
      ]),
    );
  });

  it("não aceita produção com banco local ou role postgres no runtime", () => {
    const issues = validateRuntimeContract({
      ...base,
      APP_ENV: "production",
      VERCEL_ENV: "production",
      NEXTAUTH_URL: "https://salon-saas.example.com",
      SUPABASE_URL: "https://productionref.supabase.co",
      SUPABASE_ANON_KEY: "ci-anon",
      SUPABASE_SERVICE_ROLE_KEY: "ci-service",
      CRON_SECRET: "ci-cron",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "DATABASE_URL" }),
      ]),
    );
  });
});
