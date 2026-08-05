-- Fase 2 (fim): recorrência, overbooking com auditoria, bloqueio de dia
-- inteiro do salão. Rodar no Supabase SQL Editor.
--
-- ORDEM OBRIGATÓRIA: rode este SQL ANTES de subir o código que depende dele
-- — mesmo motivo das migrations 004/005/006. Duas tabelas NOVAS (RLS +
-- GRANT explícitos, senão nascem com o mesmo problema já corrigido em User:
-- RLS ativo por padrão do Supabase, zero policy, bloqueia geral) e duas
-- colunas novas em "Appointment" + a exclusion constraint recriada.

-- ─── SalonClosure — bloqueio do salão inteiro (feriado, reforma, viagem) ────

CREATE TABLE IF NOT EXISTS "SalonClosure" (
  "id"        TEXT NOT NULL,
  "salonId"   TEXT NOT NULL,
  "startAt"   TIMESTAMP(3) NOT NULL,
  "endAt"     TIMESTAMP(3) NOT NULL,
  "reason"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SalonClosure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalonClosure_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "SalonClosure_salonId_startAt_idx"
  ON "SalonClosure" ("salonId", "startAt");

ALTER TABLE "SalonClosure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalonClosure" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "SalonClosure";
CREATE POLICY tenant_isolation ON "SalonClosure"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "SalonClosure" TO app_runtime;

-- ─── AuditLog — trilha de ações sensíveis (hoje: overbooking) ──────────────
-- Append-only por design: sem UPDATE/DELETE pra app_runtime, só SELECT e
-- INSERT. Um log que a própria aplicação pode apagar não serve de trilha.

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id"         TEXT NOT NULL,
  "salonId"    TEXT NOT NULL,
  "userId"     TEXT,
  "actorName"  TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "reason"     TEXT,
  "metadata"   JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditLog_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AuditLog_salonId_createdAt_idx"
  ON "AuditLog" ("salonId", "createdAt");

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

GRANT SELECT, INSERT ON TABLE "AuditLog" TO app_runtime;

-- ─── Appointment: overbooking + série de recorrência ───────────────────────

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "isOverbooked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "seriesId" TEXT;

CREATE INDEX IF NOT EXISTS "Appointment_seriesId_idx" ON "Appointment" ("seriesId");

-- Recria a exclusion constraint (002_appointment_no_overlap.sql) excluindo
-- linhas marcadas isOverbooked=true da checagem. Todo agendamento existente
-- nasce com isOverbooked=false (default), então o comportamento pra dados
-- já gravados não muda em nada — só abre a exceção pra overbooking
-- deliberado, marcado explicitamente pela aplicação.
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS appointment_no_overlap;
ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    "professionalId" WITH =,
    tsrange("startAt", "endAt") WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS') AND NOT "isOverbooked");

-- ── Conferência: as duas tabelas devem ter rls_ativo=true, rls_forcado=true, policies=1 ──
-- SELECT c.relname AS tabela, c.relrowsecurity AS rls_ativo, c.relforcerowsecurity AS rls_forcado,
--   (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
-- FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname IN ('SalonClosure', 'AuditLog');
