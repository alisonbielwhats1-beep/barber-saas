-- Lista de espera por agendamento específico
-- Rodar no Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- POR QUE: hoje, quando um cliente cancela um horário concorrido, o slot só
-- reabre pra quem checar a página de novo por acaso. `WaitlistEntry` guarda
-- quem quis aquele agendamento específico enquanto ele estava ocupado; ao
-- cancelar, `fulfillWaitlistOnCancel` (src/lib/waitlist.ts) cria
-- automaticamente um novo Appointment pro primeiro da fila.
--
-- Diferente de 004/005 (só ADD COLUMN em tabela existente), esta é uma
-- TABELA NOVA — precisa de RLS habilitado e GRANT explícitos, senão nasce
-- com o mesmo problema que já corrigimos em User (RLS ativo por padrão do
-- Supabase, zero policy, bloqueia geral). Este arquivo já inclui os dois,
-- não repita o erro de contar "resolvido" sem rodar essa parte.
--
-- ORDEM OBRIGATÓRIA: rode este SQL ANTES de subir o código que usa
-- WaitlistEntry — mesmo motivo das migrations 004/005.

CREATE TABLE IF NOT EXISTS "WaitlistEntry" (
  "id"                     TEXT NOT NULL,
  "salonId"                TEXT NOT NULL,
  "appointmentId"          TEXT NOT NULL,
  "clientId"               TEXT,
  "guestName"              TEXT,
  "guestPhone"             TEXT,
  "fulfilledAt"            TIMESTAMP(3),
  "fulfilledAppointmentId" TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaitlistEntry_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE,
  CONSTRAINT "WaitlistEntry_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE,
  CONSTRAINT "WaitlistEntry_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "WaitlistEntry_salonId_appointmentId_fulfilledAt_createdAt_idx"
  ON "WaitlistEntry" ("salonId", "appointmentId", "fulfilledAt", "createdAt");

-- ─── RLS — mesma policy uniforme das outras tabelas tenant-scoped ───────────
-- Não precisa de policy pública nem de leitura por token: toda escrita desta
-- tabela já acontece dentro de withSalon/withTenant, que setam a GUC de
-- salão antes de qualquer query.

ALTER TABLE "WaitlistEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistEntry" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "WaitlistEntry";
CREATE POLICY tenant_isolation ON "WaitlistEntry"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

-- ─── Acesso da role de runtime ───────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "WaitlistEntry" TO app_runtime;

-- Conferência: deve devolver rls_ativo=true, rls_forcado=true, policies=1.
-- SELECT
--   c.relname             AS tabela,
--   c.relrowsecurity      AS rls_ativo,
--   c.relforcerowsecurity AS rls_forcado,
--   (SELECT count(*) FROM pg_policies p
--     WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname = 'WaitlistEntry';
