-- Fase 015 — avaliações verificadas de clientes.
-- Aplicar somente após este preflight, backup adequado, rollback conhecido e
-- autorização explícita. A avaliação só é criada pelo servidor para um
-- atendimento COMPLETED do próprio cliente.

BEGIN;

DO $$
BEGIN
  CREATE TYPE "ClientReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ClientReview" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" VARCHAR(500),
  "status" "ClientReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
  "moderatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientReview_appointmentId_clientId_key"
  ON "ClientReview" ("appointmentId", "clientId");
CREATE INDEX IF NOT EXISTS "ClientReview_salonId_status_createdAt_idx"
  ON "ClientReview" ("salonId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ClientReview_salonId_rating_createdAt_idx"
  ON "ClientReview" ("salonId", "rating", "createdAt");
CREATE INDEX IF NOT EXISTS "ClientReview_clientId_createdAt_idx"
  ON "ClientReview" ("clientId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClientReview_rating_check'
  ) THEN
    ALTER TABLE "ClientReview"
      ADD CONSTRAINT "ClientReview_rating_check"
      CHECK ("rating" BETWEEN 1 AND 5);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClientReview_salonId_fkey'
  ) THEN
    ALTER TABLE "ClientReview"
      ADD CONSTRAINT "ClientReview_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClientReview_appointment_tenant_fkey'
  ) THEN
    ALTER TABLE "ClientReview"
      ADD CONSTRAINT "ClientReview_appointment_tenant_fkey"
      FOREIGN KEY ("appointmentId", "salonId")
      REFERENCES "Appointment"("id", "salonId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClientReview_client_tenant_fkey'
  ) THEN
    ALTER TABLE "ClientReview"
      ADD CONSTRAINT "ClientReview_client_tenant_fkey"
      FOREIGN KEY ("clientId", "salonId")
      REFERENCES "ClientProfile"("id", "salonId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "ClientReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientReview" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClientReview";
CREATE POLICY tenant_isolation ON "ClientReview"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

-- A role já existente precisa receber acesso também quando esta fase é
-- aplicada depois do script geral de criação do app_runtime.
GRANT SELECT, INSERT, UPDATE ON TABLE "ClientReview" TO app_runtime;
REVOKE DELETE ON TABLE "ClientReview" FROM app_runtime;

COMMIT;
