-- Rollback destrutivo da fase 014.
-- NÃO executar depois de mesclagens reais sem exportação e autorização:
-- removerá a trilha de vínculo e a identidade normalizada.

BEGIN;

ALTER TABLE "ClientProfile"
  DROP CONSTRAINT IF EXISTS "ClientProfile_mergedInto_tenant_fkey";

DROP INDEX IF EXISTS "ClientProfile_salonId_phoneNormalized_idx";
DROP INDEX IF EXISTS "ClientProfile_salonId_mergedIntoId_idx";

ALTER TABLE "ClientProfile"
  DROP COLUMN IF EXISTS "mergedAt",
  DROP COLUMN IF EXISTS "mergedIntoId",
  DROP COLUMN IF EXISTS "phoneNormalized";

COMMIT;
