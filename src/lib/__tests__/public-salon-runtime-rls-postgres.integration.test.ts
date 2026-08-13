import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const describePostgres =
  process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

const ROLE = "app_runtime_ci";
const PASSWORD = "ci-only-runtime-password";

describePostgres("acesso público com a role runtime e RLS real", () => {
  const admin = new PrismaClient();
  let runtime: PrismaClient;
  let salon: { id: string; slug: string };
  let access: typeof import("../prisma-tenant");

  beforeAll(async () => {
    const setupStatements = [
      `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          CREATE ROLE ${ROLE}
            LOGIN PASSWORD '${PASSWORD}'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END
      $$
      `,
      `
      DO $$
      BEGIN
        EXECUTE format(
          'GRANT CONNECT ON DATABASE %I TO ${ROLE}',
          current_database()
        );
      END
      $$
      `,
      `GRANT USAGE ON SCHEMA public TO ${ROLE}`,
      // A policy produtiva `salon_platform_admin_update` consulta User para a
      // exceção de SUPER_ADMIN. A role app_runtime real possui este SELECT;
      // sem ele o Postgres falha ao avaliar o conjunto permissivo de policies.
      `GRANT SELECT ON TABLE "User" TO ${ROLE}`,
      `GRANT SELECT, UPDATE ON TABLE "Salon" TO ${ROLE}`,
      `ALTER TABLE "Salon" ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE "Salon" FORCE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS salon_runtime_ci_read ON "Salon"`,
      `CREATE POLICY salon_runtime_ci_read ON "Salon"
        FOR SELECT TO ${ROLE} USING (TRUE)`,
      `DROP POLICY IF EXISTS salon_runtime_ci_update ON "Salon"`,
      `CREATE POLICY salon_runtime_ci_update ON "Salon"
        FOR UPDATE TO ${ROLE}
        USING (id = current_setting('app.current_salon', true))
        WITH CHECK (id = current_setting('app.current_salon', true))`,
    ];
    for (const statement of setupStatements) {
      await admin.$executeRawUnsafe(statement);
    }

    salon = await admin.salon.create({
      data: {
        slug: `runtime-rls-ci-${crypto.randomUUID()}`,
        name: "Runtime RLS CI",
        timezone: "America/Sao_Paulo",
        accessStatus: "APPROVED",
        accessReviewedAt: new Date(),
      },
      select: { id: true, slug: true },
    });

    const runtimeUrl = new URL(process.env.DATABASE_URL!);
    runtimeUrl.username = ROLE;
    runtimeUrl.password = PASSWORD;
    runtime = new PrismaClient({
      datasources: { db: { url: runtimeUrl.toString() } },
    });

    vi.doMock("../prisma", () => ({ prisma: runtime }));
    access = await import("../prisma-tenant");
  });

  afterAll(async () => {
    await runtime?.$disconnect();
    if (salon?.id) {
      await admin.salon.delete({ where: { id: salon.id } });
    }
    await admin.$executeRawUnsafe(
      `DROP POLICY IF EXISTS salon_runtime_ci_update ON "Salon"`,
    );
    await admin.$executeRawUnsafe(
      `DROP POLICY IF EXISTS salon_runtime_ci_read ON "Salon"`,
    );
    await admin.$executeRawUnsafe(`DROP OWNED BY ${ROLE}`);
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin.$disconnect();
    vi.doUnmock("../prisma");
    vi.resetModules();
  });

  it("prova que FOR SHARE sem GUC fica invisível para a role runtime", async () => {
    const rows = await runtime.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Salon"
      WHERE "id" = ${salon.id}
      FOR SHARE
    `;

    expect(rows).toEqual([]);
  });

  it("resolve por slug, seta a GUC antes do FOR SHARE e executa o callback", async () => {
    const callback = vi.fn(async (
      tx: import("../prisma-tenant").Tx,
      salonId: string,
    ) => {
      const [identity] = await tx.$queryRaw<
        Array<{
          currentUser: string;
          isSuperuser: boolean;
          bypassesRls: boolean;
          rlsEnabled: boolean;
          rlsForced: boolean;
        }>
      >`
        SELECT
          current_user AS "currentUser",
          role.rolsuper AS "isSuperuser",
          role.rolbypassrls AS "bypassesRls",
          table_state.relrowsecurity AS "rlsEnabled",
          table_state.relforcerowsecurity AS "rlsForced"
        FROM pg_roles role
        CROSS JOIN pg_class table_state
        WHERE role.rolname = current_user
          AND table_state.oid = '"Salon"'::regclass
      `;
      const row = await tx.salon.findUnique({
        where: { id: salonId },
        select: { id: true, slug: true },
      });
      return { identity, row };
    });

    await expect(access.withSalonBySlug(salon.slug, callback)).resolves.toEqual({
      identity: {
        currentUser: ROLE,
        isSuperuser: false,
        bypassesRls: false,
        rlsEnabled: true,
        rlsForced: true,
      },
      row: salon,
    });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("valida por id com a GUC ativa antes do FOR SHARE", async () => {
    const callback = vi.fn(
      async (_tx: import("../prisma-tenant").Tx, salonId: string) => salonId,
    );

    await expect(access.withApprovedSalon(salon.id, callback)).resolves.toBe(
      salon.id,
    );
    expect(callback).toHaveBeenCalledOnce();
  });
});
