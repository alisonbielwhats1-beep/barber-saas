-- Fase 016 — experiência de agendamento: preço especial, aceite de
-- remarcação, promoção explícita da fila e janela pública de 60 dias.
-- Aplicar somente depois do preflight, backup/rollback conhecido e
-- autorização explícita. Não executar diretamente em Production.

BEGIN;

-- PostgreSQL 16 aceita ADD VALUE IF NOT EXISTS dentro da transação; manter
-- isso fora de DO evita a restrição de ALTER TYPE em blocos procedurais.
ALTER TYPE "AppointmentEventType" ADD VALUE IF NOT EXISTS 'RESCHEDULE_REQUESTED';
ALTER TYPE "AppointmentEventType" ADD VALUE IF NOT EXISTS 'RESCHEDULE_REJECTED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PricingRuleTargetType') THEN
    CREATE TYPE "PricingRuleTargetType" AS ENUM ('WEEKDAY', 'DATE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PricingAdjustmentType') THEN
    CREATE TYPE "PricingAdjustmentType" AS ENUM ('PERCENTAGE', 'FIXED_CENTS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RescheduleProposalStatus') THEN
    CREATE TYPE "RescheduleProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ServicePricingRule" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "targetType" "PricingRuleTargetType" NOT NULL,
  "targetKey" TEXT NOT NULL,
  "weekday" INTEGER,
  "date" DATE,
  "label" TEXT NOT NULL,
  "adjustmentType" "PricingAdjustmentType" NOT NULL,
  "adjustmentValue" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ServicePricingRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServicePricingRule_salonId_targetKey_key"
  ON "ServicePricingRule" ("salonId", "targetKey");
CREATE INDEX IF NOT EXISTS "ServicePricingRule_salonId_active_targetType_weekday_idx"
  ON "ServicePricingRule" ("salonId", "active", "targetType", "weekday");
CREATE INDEX IF NOT EXISTS "ServicePricingRule_salonId_active_date_idx"
  ON "ServicePricingRule" ("salonId", "active", "date");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServicePricingRule_target_check'
  ) THEN
    ALTER TABLE "ServicePricingRule"
      ADD CONSTRAINT "ServicePricingRule_target_check"
      CHECK (
        ("targetType" = 'WEEKDAY' AND "weekday" IS NOT NULL AND "weekday" BETWEEN 0 AND 6 AND "date" IS NULL
          AND "targetKey" = 'weekday:' || "weekday"::TEXT)
        OR
        ("targetType" = 'DATE' AND "weekday" IS NULL AND "date" IS NOT NULL
          AND "targetKey" = 'date:' || "date"::TEXT)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServicePricingRule_adjustment_check'
  ) THEN
    ALTER TABLE "ServicePricingRule"
      ADD CONSTRAINT "ServicePricingRule_adjustment_check"
      CHECK (
        "adjustmentValue" >= 0
        AND ("adjustmentType" = 'PERCENTAGE' AND "adjustmentValue" <= 100
          OR "adjustmentType" = 'FIXED_CENTS' AND "adjustmentValue" <= 100000)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServicePricingRule_label_check'
  ) THEN
    ALTER TABLE "ServicePricingRule"
      ADD CONSTRAINT "ServicePricingRule_label_check"
      CHECK (length(btrim("label")) BETWEEN 2 AND 80);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServicePricingRule_salonId_fkey'
  ) THEN
    ALTER TABLE "ServicePricingRule"
      ADD CONSTRAINT "ServicePricingRule_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "RescheduleProposal" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "requestedById" TEXT,
  "targetProfessionalId" TEXT NOT NULL,
  "status" "RescheduleProposalStatus" NOT NULL DEFAULT 'PENDING',
  "sourceVersion" INTEGER NOT NULL,
  "targetStartAt" TIMESTAMPTZ(3) NOT NULL,
  "targetEndAt" TIMESTAMPTZ(3) NOT NULL,
  "targetTimezone" TEXT NOT NULL,
  "targetPriceCents" INTEGER NOT NULL,
  "targetServices" JSONB NOT NULL,
  "reason" TEXT,
  "responseReason" TEXT,
  "idempotencyKey" TEXT,
  "requestFingerprint" TEXT,
  "respondedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RescheduleProposal_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RescheduleProposal"
  ADD COLUMN IF NOT EXISTS "targetNotes" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "RescheduleProposal_salonId_idempotencyKey_key"
  ON "RescheduleProposal" ("salonId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "RescheduleProposal_salonId_status_createdAt_idx"
  ON "RescheduleProposal" ("salonId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "RescheduleProposal_salonId_appointmentId_status_createdAt_idx"
  ON "RescheduleProposal" ("salonId", "appointmentId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "RescheduleProposal_salonId_targetProfessionalId_targetStartAt_idx"
  ON "RescheduleProposal" ("salonId", "targetProfessionalId", "targetStartAt");
CREATE INDEX IF NOT EXISTS "RescheduleProposal_requestedById_idx"
  ON "RescheduleProposal" ("requestedById");
CREATE UNIQUE INDEX IF NOT EXISTS "RescheduleProposal_pending_appointment_key"
  ON "RescheduleProposal" ("salonId", "appointmentId")
  WHERE "status" = 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RescheduleProposal_target_check'
  ) THEN
    ALTER TABLE "RescheduleProposal"
      ADD CONSTRAINT "RescheduleProposal_target_check"
      CHECK (
        "sourceVersion" > 0
        AND "targetStartAt" < "targetEndAt"
        AND "targetPriceCents" >= 0
        AND length(btrim("targetTimezone")) > 0
        AND CASE
          WHEN jsonb_typeof("targetServices") = 'array'
            THEN jsonb_array_length("targetServices") BETWEEN 1 AND 10
          ELSE FALSE
        END
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RescheduleProposal_salonId_fkey'
  ) THEN
    ALTER TABLE "RescheduleProposal"
      ADD CONSTRAINT "RescheduleProposal_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RescheduleProposal_appointment_tenant_fkey'
  ) THEN
    ALTER TABLE "RescheduleProposal"
      ADD CONSTRAINT "RescheduleProposal_appointment_tenant_fkey"
      FOREIGN KEY ("appointmentId", "salonId")
      REFERENCES "Appointment"("id", "salonId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RescheduleProposal_professional_tenant_fkey'
  ) THEN
    ALTER TABLE "RescheduleProposal"
      ADD CONSTRAINT "RescheduleProposal_professional_tenant_fkey"
      FOREIGN KEY ("targetProfessionalId", "salonId")
      REFERENCES "Professional"("id", "salonId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RescheduleProposal_requestedById_fkey'
  ) THEN
    ALTER TABLE "RescheduleProposal"
      ADD CONSTRAINT "RescheduleProposal_requestedById_fkey"
      FOREIGN KEY ("requestedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "ServicePricingRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServicePricingRule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ServicePricingRule";
CREATE POLICY tenant_isolation ON "ServicePricingRule"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

ALTER TABLE "RescheduleProposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RescheduleProposal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RescheduleProposal";
CREATE POLICY tenant_isolation ON "RescheduleProposal"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ServicePricingRule" TO app_runtime;
    REVOKE DELETE ON TABLE "RescheduleProposal" FROM app_runtime;
    GRANT SELECT, INSERT, UPDATE ON TABLE "RescheduleProposal" TO app_runtime;
  END IF;
END $$;

ALTER TABLE "Salon"
  ALTER COLUMN "maxBookingLeadDays" SET DEFAULT 60;

COMMIT;
