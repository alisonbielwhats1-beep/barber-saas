-- Rollback da fase 015.
-- É destrutivo para as avaliações desta fase. Faça export/backup e obtenha
-- autorização antes de executar; não usar para esconder avaliações.

BEGIN;

DROP POLICY IF EXISTS tenant_isolation ON "ClientReview";
ALTER TABLE IF EXISTS "ClientReview" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ClientReview" DISABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS "ClientReview"
  DROP CONSTRAINT IF EXISTS "ClientReview_client_tenant_fkey",
  DROP CONSTRAINT IF EXISTS "ClientReview_appointment_tenant_fkey",
  DROP CONSTRAINT IF EXISTS "ClientReview_salonId_fkey",
  DROP CONSTRAINT IF EXISTS "ClientReview_rating_check";

DROP TABLE IF EXISTS "ClientReview";
DROP TYPE IF EXISTS "ClientReviewStatus";

COMMIT;
