import { describe, expect, it } from "vitest";
import {
  assertSafeDatabaseOperation,
  DESTRUCTIVE_DATABASE_CONFIRMATION,
  type DatabaseSafetyEnvironment,
} from "../database-safety";

const localEnvironment: DatabaseSafetyEnvironment = {
  APP_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/salon_test",
  DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:5432/salon_test",
};

const stagingEnvironment: DatabaseSafetyEnvironment = {
  APP_ENV: "staging",
  DATABASE_URL:
    "postgresql://postgres.stagingref:secret@aws-1-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  DIRECT_URL:
    "postgresql://postgres.stagingref:secret@aws-1-sa-east-1.pooler.supabase.com:5432/postgres",
  PRODUCTION_SUPABASE_PROJECT_REF: "productionref",
  SUPABASE_PROJECT_REF: "stagingref",
  SUPABASE_URL: "https://stagingref.supabase.co",
};

describe("assertSafeDatabaseOperation", () => {
  it("aceita banco local em teste sem revelar credenciais", () => {
    const result = assertSafeDatabaseOperation(localEnvironment, {
      operation: "schema-check",
    });

    expect(result).toEqual({
      appEnvironment: "test",
      databaseHosts: ["localhost", "127.0.0.1"],
      operation: "schema-check",
      target: "local",
    });
    expect(JSON.stringify(result)).not.toContain("postgres:postgres");
  });

  it.each([undefined, "production", "preview", "homologacao"])(
    "bloqueia APP_ENV inválida: %s",
    (appEnvironment) => {
      expect(() =>
        assertSafeDatabaseOperation(
          { ...localEnvironment, APP_ENV: appEnvironment },
          { operation: "migration" },
        ),
      ).toThrow(/produção é bloqueada/);
    },
  );

  it("bloqueia Vercel de produção mesmo com APP_ENV segura", () => {
    expect(() =>
      assertSafeDatabaseOperation(
        { ...localEnvironment, VERCEL_ENV: "production" },
        { operation: "seed" },
      ),
    ).toThrow(/VERCEL_ENV=production/);
  });

  it("bloqueia banco remoto em test e development", () => {
    for (const appEnvironment of ["test", "development"]) {
      expect(() =>
        assertSafeDatabaseOperation(
          { ...stagingEnvironment, APP_ENV: appEnvironment },
          { operation: "migration" },
        ),
      ).toThrow(/aceita somente PostgreSQL local/);
    }
  });

  it("aceita somente o projeto Supabase declarado para staging", () => {
    expect(
      assertSafeDatabaseOperation(stagingEnvironment, {
        operation: "migration",
      }).target,
    ).toBe("supabase-staging");

    expect(() =>
      assertSafeDatabaseOperation(
        {
          ...stagingEnvironment,
          DATABASE_URL: stagingEnvironment.DATABASE_URL?.replace(
            "postgres.stagingref",
            "postgres.otherref",
          ),
        },
        { operation: "migration" },
      ),
    ).toThrow(/não corresponde ao project ref de homologação/);
  });

  it("não confia apenas no usuário do pooler quando o host não é Supabase", () => {
    expect(() =>
      assertSafeDatabaseOperation(
        {
          ...stagingEnvironment,
          DATABASE_URL:
            "postgresql://postgres.stagingref:secret@database.example.com:6543/postgres",
        },
        { operation: "migration" },
      ),
    ).toThrow(/projeto Supabase identificável/);
  });

  it("bloqueia quando homologação e produção têm o mesmo project ref", () => {
    expect(() =>
      assertSafeDatabaseOperation(
        {
          ...stagingEnvironment,
          SUPABASE_PROJECT_REF: "productionref",
        },
        { operation: "migration" },
      ),
    ).toThrow(/igual ao de produção/);
  });

  it("exige confirmação separada para seed destrutivo", () => {
    expect(() =>
      assertSafeDatabaseOperation(localEnvironment, {
        destructive: true,
        operation: "seed",
      }),
    ).toThrow(/confirmação explícita/);

    expect(
      assertSafeDatabaseOperation(
        {
          ...localEnvironment,
          ALLOW_DESTRUCTIVE_DB_OPERATIONS:
            DESTRUCTIVE_DATABASE_CONFIRMATION,
        },
        { destructive: true, operation: "seed" },
      ).target,
    ).toBe("local");
  });

  it("rejeita protocolos que não são PostgreSQL", () => {
    expect(() =>
      assertSafeDatabaseOperation(
        { ...localEnvironment, DATABASE_URL: "https://localhost/database" },
        { operation: "migration" },
      ),
    ).toThrow(/protocolo postgresql/);
  });
});
