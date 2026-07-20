-- Row-Level Security (RLS) para as tabelas tenant-scoped
--
-- COMO ATIVAR:
--   1. Aplique este SQL no banco: `psql $DATABASE_URL -f prisma/migrations/rls/enable_rls.sql`
--   2. Troque `src/lib/prisma.ts` por `src/lib/prisma-tenant.ts` no import das
--      Server Actions e páginas — a extensão do Prisma seta `app.current_salon`
--      antes de cada query, e o Postgres bloqueia leitura cross-tenant.
--   3. Rode com um usuário Postgres que NÃO é superuser nem dono das tabelas
--      (superusers bypassam RLS). No Neon isso é o padrão.
--
-- POR QUE: mesmo que uma Server Action esqueça o filtro `salonId`, o banco
-- devolve zero linhas dos outros salões. Defense-in-depth real.

-- ─── Habilita RLS ────────────────────────────────────────────────────────
ALTER TABLE "Salon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Professional" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfessionalService" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkingHours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeOff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;

-- ─── Função helper: pega o salão atual da GUC ───────────────────────────
-- Retorna NULL quando não está setado — nesse caso, as policies bloqueiam
-- tudo por padrão.
CREATE OR REPLACE FUNCTION app_current_salon() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.current_salon', TRUE), '')
$$ LANGUAGE SQL STABLE;

-- ─── Policies ────────────────────────────────────────────────────────────
-- Padrão: uma policy única "tenant_isolation" que aplica a SELECT/INSERT/
-- UPDATE/DELETE. Compara a coluna `salonId` da linha com o GUC atual.

DROP POLICY IF EXISTS tenant_isolation ON "Salon";
CREATE POLICY tenant_isolation ON "Salon"
  USING (id = app_current_salon())
  WITH CHECK (id = app_current_salon());

DROP POLICY IF EXISTS tenant_isolation ON "Membership";
CREATE POLICY tenant_isolation ON "Membership"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

DROP POLICY IF EXISTS tenant_isolation ON "Professional";
CREATE POLICY tenant_isolation ON "Professional"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

DROP POLICY IF EXISTS tenant_isolation ON "Service";
CREATE POLICY tenant_isolation ON "Service"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

DROP POLICY IF EXISTS tenant_isolation ON "ProfessionalService";
CREATE POLICY tenant_isolation ON "ProfessionalService"
  USING (
    EXISTS (
      SELECT 1 FROM "Professional" p
      WHERE p.id = "ProfessionalService"."professionalId"
      AND p."salonId" = app_current_salon()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Professional" p
      WHERE p.id = "ProfessionalService"."professionalId"
      AND p."salonId" = app_current_salon()
    )
  );

DROP POLICY IF EXISTS tenant_isolation ON "WorkingHours";
CREATE POLICY tenant_isolation ON "WorkingHours"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

DROP POLICY IF EXISTS tenant_isolation ON "TimeOff";
CREATE POLICY tenant_isolation ON "TimeOff"
  USING (
    EXISTS (
      SELECT 1 FROM "Professional" p
      WHERE p.id = "TimeOff"."professionalId"
      AND p."salonId" = app_current_salon()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Professional" p
      WHERE p.id = "TimeOff"."professionalId"
      AND p."salonId" = app_current_salon()
    )
  );

DROP POLICY IF EXISTS tenant_isolation ON "ClientProfile";
CREATE POLICY tenant_isolation ON "ClientProfile"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

DROP POLICY IF EXISTS tenant_isolation ON "Appointment";
CREATE POLICY tenant_isolation ON "Appointment"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

DROP POLICY IF EXISTS tenant_isolation ON "Payment";
CREATE POLICY tenant_isolation ON "Payment"
  USING (
    EXISTS (
      SELECT 1 FROM "Appointment" a
      WHERE a.id = "Payment"."appointmentId"
      AND a."salonId" = app_current_salon()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Appointment" a
      WHERE a.id = "Payment"."appointmentId"
      AND a."salonId" = app_current_salon()
    )
  );

-- ─── OBS ────────────────────────────────────────────────────────────────
-- Tabelas SEM RLS de propósito: User (usuário pode ter memberships em vários
-- salões — auth precisa achá-lo antes de qualquer tenant existir). O
-- isolamento de dados de User acontece pela lógica das actions, não RLS.
