-- Fase 2 — núcleo confiável de agendamentos.
--
-- IMPORTANTE:
--   * Este arquivo NÃO foi aplicado em Production.
--   * Aplicar primeiro em PostgreSQL descartável/homologação e executar a suíte
--     de concorrência antes de qualquer rollout remoto.
--   * A mudança é aditiva e preserva os campos/relacionamentos legados.
--   * Datas existentes foram gravadas pelo Prisma como instantes UTC em
--     TIMESTAMP sem fuso. A conversão abaixo preserva esses instantes usando
--     explicitamente UTC, sem aplicar o offset do processo ou da sessão.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "AppointmentOrigin" AS ENUM ('LEGACY', 'PUBLIC', 'ADMIN', 'WAITLIST', 'RECURRING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AppointmentEventType" AS ENUM (
    'CREATED',
    'RESCHEDULED',
    'STATUS_CHANGED',
    'CANCELLED',
    'WAITLIST_FULFILLED',
    'REMINDER_MARKED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AppointmentActorType" AS ENUM ('CLIENT', 'STAFF', 'SYSTEM', 'GUEST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationChannel" AS ENUM ('INTERNAL', 'EMAIL', 'MANUAL_WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A constraint precisa sair antes da conversão de tsrange para tstzrange.
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS appointment_no_overlap;

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS "origin" "AppointmentOrigin" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledByType" "AppointmentActorType",
  ADD COLUMN IF NOT EXISTS "cancelledById" TEXT;

UPDATE "Appointment" AS appointment
SET "timezone" = salon."timezone"
FROM "Salon" AS salon
WHERE salon.id = appointment."salonId"
  AND appointment."timezone" = 'America/Sao_Paulo'
  AND salon."timezone" <> appointment."timezone";

-- Só converte colunas que ainda são timestamp sem fuso. Reexecutar o arquivo
-- não reaplica offset nem modifica colunas que já são timestamptz.
DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('Appointment', 'startAt'),
      ('Appointment', 'endAt'),
      ('Appointment', 'reminderSentAt'),
      ('Appointment', 'cancelledAt'),
      ('Appointment', 'createdAt'),
      ('Appointment', 'updatedAt'),
      ('Payment', 'paidAt'),
      ('TimeOff', 'startAt'),
      ('TimeOff', 'endAt'),
      ('SalonClosure', 'startAt'),
      ('SalonClosure', 'endAt')
    ) AS columns_to_convert(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target.table_name
        AND column_name = target.column_name
        AND data_type = 'timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ(3) USING %I AT TIME ZONE ''UTC''',
        target.table_name,
        target.column_name,
        target.column_name
      );
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_salonId_idempotencyKey_key"
  ON "Appointment" ("salonId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "Appointment_salonId_status_startAt_idx"
  ON "Appointment" ("salonId", status, "startAt");

CREATE INDEX IF NOT EXISTS "Appointment_professionalId_status_startAt_endAt_idx"
  ON "Appointment" ("professionalId", status, "startAt", "endAt");

-- Alvos compostos para que toda FK das estruturas de histórico carregue o
-- tenant junto com o id. Isso impede associação cross-tenant mesmo em uma
-- escrita privilegiada acidental.
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_id_salonId_key"
  ON "Appointment" (id, "salonId");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientProfile_id_salonId_key"
  ON "ClientProfile" (id, "salonId");
CREATE UNIQUE INDEX IF NOT EXISTS "Professional_id_salonId_key"
  ON "Professional" (id, "salonId");
CREATE UNIQUE INDEX IF NOT EXISTS "Service_id_salonId_key"
  ON "Service" (id, "salonId");

DO $$ BEGIN
  ALTER TABLE "Appointment"
    ADD CONSTRAINT "Appointment_client_tenant_fkey"
    FOREIGN KEY ("clientId", "salonId")
    REFERENCES "ClientProfile"(id, "salonId") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Appointment"
    ADD CONSTRAINT "Appointment_professional_tenant_fkey"
    FOREIGN KEY ("professionalId", "salonId")
    REFERENCES "Professional"(id, "salonId") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Appointment"
    ADD CONSTRAINT "Appointment_service_tenant_fkey"
    FOREIGN KEY ("serviceId", "salonId")
    REFERENCES "Service"(id, "salonId") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Appointment"
    ADD CONSTRAINT appointment_positive_interval CHECK ("startAt" < "endAt");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AppointmentService" (
  "appointmentId" TEXT NOT NULL,
  "salonId"       TEXT NOT NULL,
  "serviceId"     TEXT NOT NULL,
  "position"      INTEGER NOT NULL,
  "serviceName"   TEXT NOT NULL,
  "durationMin"   INTEGER NOT NULL,
  "priceCents"    INTEGER NOT NULL,

  CONSTRAINT "AppointmentService_pkey" PRIMARY KEY ("appointmentId", "position"),
  CONSTRAINT "AppointmentService_appointment_tenant_fkey"
    FOREIGN KEY ("appointmentId", "salonId")
    REFERENCES "Appointment"(id, "salonId") ON DELETE CASCADE,
  CONSTRAINT "AppointmentService_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"(id) ON DELETE CASCADE,
  CONSTRAINT "AppointmentService_service_tenant_fkey"
    FOREIGN KEY ("serviceId", "salonId") REFERENCES "Service"(id, "salonId"),
  CONSTRAINT appointment_service_positive_values
    CHECK ("position" >= 0 AND "durationMin" > 0 AND "priceCents" >= 0),
  CONSTRAINT "AppointmentService_appointmentId_serviceId_key"
    UNIQUE ("appointmentId", "serviceId")
);

DO $$ BEGIN
  ALTER TABLE "AppointmentService"
    ADD CONSTRAINT "AppointmentService_appointment_tenant_fkey"
    FOREIGN KEY ("appointmentId", "salonId")
    REFERENCES "Appointment"(id, "salonId") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "AppointmentService"
    ADD CONSTRAINT "AppointmentService_service_tenant_fkey"
    FOREIGN KEY ("serviceId", "salonId") REFERENCES "Service"(id, "salonId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "AppointmentService_salonId_appointmentId_idx"
  ON "AppointmentService" ("salonId", "appointmentId");
CREATE INDEX IF NOT EXISTS "AppointmentService_serviceId_idx"
  ON "AppointmentService" ("serviceId");

-- Um item legado por agendamento mantém duração/preço/nome históricos
-- disponíveis sem alterar Appointment.serviceId.
INSERT INTO "AppointmentService" (
  "appointmentId",
  "salonId",
  "serviceId",
  "position",
  "serviceName",
  "durationMin",
  "priceCents"
)
SELECT
  appointment.id,
  appointment."salonId",
  appointment."serviceId",
  0,
  service.name,
  GREATEST(1, EXTRACT(EPOCH FROM (appointment."endAt" - appointment."startAt"))::INTEGER / 60),
  appointment."priceCents"
FROM "Appointment" AS appointment
JOIN "Service" AS service ON service.id = appointment."serviceId"
ON CONFLICT ("appointmentId", "position") DO NOTHING;

CREATE TABLE IF NOT EXISTS "AppointmentEvent" (
  "id"             TEXT NOT NULL,
  "salonId"        TEXT NOT NULL,
  "appointmentId"  TEXT NOT NULL,
  "eventType"      "AppointmentEventType" NOT NULL,
  "previousValue"  JSONB,
  "newValue"       JSONB,
  "actorType"      "AppointmentActorType" NOT NULL,
  "actorId"        TEXT,
  "reason"         TEXT,
  "correlationId"  TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "requestFingerprint" TEXT,
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppointmentEvent_pkey" PRIMARY KEY (id),
  CONSTRAINT "AppointmentEvent_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"(id) ON DELETE CASCADE,
  CONSTRAINT "AppointmentEvent_appointment_tenant_fkey"
    FOREIGN KEY ("appointmentId", "salonId")
    REFERENCES "Appointment"(id, "salonId") ON DELETE RESTRICT
);

ALTER TABLE "AppointmentEvent"
  ADD COLUMN IF NOT EXISTS "requestFingerprint" TEXT;

DO $$ BEGIN
  ALTER TABLE "AppointmentEvent"
    ADD CONSTRAINT "AppointmentEvent_appointment_tenant_fkey"
    FOREIGN KEY ("appointmentId", "salonId")
    REFERENCES "Appointment"(id, "salonId") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentEvent_appointmentId_idempotencyKey_key"
  ON "AppointmentEvent" ("appointmentId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "AppointmentEvent_salonId_createdAt_idx"
  ON "AppointmentEvent" ("salonId", "createdAt");
CREATE INDEX IF NOT EXISTS "AppointmentEvent_appointmentId_createdAt_idx"
  ON "AppointmentEvent" ("appointmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "AppointmentEvent_correlationId_idx"
  ON "AppointmentEvent" ("correlationId");
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentEvent_id_salonId_key"
  ON "AppointmentEvent" (id, "salonId");

CREATE TABLE IF NOT EXISTS "NotificationOutbox" (
  "id"            TEXT NOT NULL,
  "salonId"       TEXT NOT NULL,
  "eventId"       TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "recipientType" TEXT NOT NULL,
  "recipientId"   TEXT,
  "recipientKey"  TEXT NOT NULL,
  "channel"       "NotificationChannel" NOT NULL,
  "template"      TEXT NOT NULL,
  "payload"       JSONB NOT NULL,
  "status"        "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "sentAt"        TIMESTAMPTZ(3),
  "readAt"        TIMESTAMPTZ(3),
  "lastError"     TEXT,
  "createdAt"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY (id),
  CONSTRAINT "NotificationOutbox_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"(id) ON DELETE CASCADE,
  CONSTRAINT "NotificationOutbox_event_tenant_fkey"
    FOREIGN KEY ("eventId", "salonId")
    REFERENCES "AppointmentEvent"(id, "salonId") ON DELETE RESTRICT,
  CONSTRAINT "NotificationOutbox_appointment_tenant_fkey"
    FOREIGN KEY ("appointmentId", "salonId")
    REFERENCES "Appointment"(id, "salonId") ON DELETE RESTRICT,
  CONSTRAINT "NotificationOutbox_delivery_key"
    UNIQUE ("eventId", "recipientKey", channel, template),
  CONSTRAINT notification_outbox_attempts_nonnegative CHECK (attempts >= 0)
);

DO $$ BEGIN
  ALTER TABLE "NotificationOutbox"
    ADD CONSTRAINT "NotificationOutbox_event_tenant_fkey"
    FOREIGN KEY ("eventId", "salonId")
    REFERENCES "AppointmentEvent"(id, "salonId") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "NotificationOutbox"
    ADD CONSTRAINT "NotificationOutbox_appointment_tenant_fkey"
    FOREIGN KEY ("appointmentId", "salonId")
    REFERENCES "Appointment"(id, "salonId") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "NotificationOutbox_salonId_recipientKey_readAt_createdAt_idx"
  ON "NotificationOutbox" ("salonId", "recipientKey", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_status_nextAttemptAt_idx"
  ON "NotificationOutbox" (status, "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_appointmentId_createdAt_idx"
  ON "NotificationOutbox" ("appointmentId", "createdAt");

-- Novas tabelas nunca ficam disponíveis para anon/authenticated por acidente.
-- Os papéis existem no Supabase, mas o bloco continua aplicável em PostgreSQL
-- descartável puro, onde eles normalmente não foram criados.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "AppointmentService", "AppointmentEvent", "NotificationOutbox" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "AppointmentService", "AppointmentEvent", "NotificationOutbox" FROM authenticated';
  END IF;
END $$;

ALTER TABLE "AppointmentService" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentService" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AppointmentService";
CREATE POLICY tenant_isolation ON "AppointmentService"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

ALTER TABLE "AppointmentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AppointmentEvent";
CREATE POLICY tenant_isolation ON "AppointmentEvent"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

ALTER TABLE "NotificationOutbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationOutbox" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NotificationOutbox";
CREATE POLICY tenant_isolation ON "NotificationOutbox"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "AppointmentService" TO app_runtime;
    GRANT SELECT, INSERT ON TABLE "AppointmentEvent" TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON TABLE "NotificationOutbox" TO app_runtime;
  END IF;
END $$;

-- Intervalos são [início, fim): um atendimento que termina às 10:00 não
-- conflita com outro que começa exatamente às 10:00.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    "salonId" WITH =,
    "professionalId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS') AND NOT "isOverbooked");

COMMIT;
