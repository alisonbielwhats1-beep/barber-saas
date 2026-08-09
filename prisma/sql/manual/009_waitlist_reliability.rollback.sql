-- Rollback compativel e NAO DESTRUTIVO da migration 009.
--
-- O codigo anterior nao preenche os snapshots novos. Este rollback remove
-- apenas a obrigatoriedade dessas colunas e os indices de unicidade que ele nao
-- sabe tratar, preservando todos os valores, estados e FKs tenant-safe.

BEGIN;

-- Validacoes de compatibilidade: falham cedo se a estrutura essencial sumiu.
DO $$ BEGIN
  IF to_regclass('public."WaitlistEntry"') IS NULL THEN
    RAISE EXCEPTION 'WaitlistEntry nao existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WaitlistEntry_appointment_tenant_fkey'
  ) THEN
    RAISE EXCEPTION 'FK tenant-safe de appointment ausente';
  END IF;
END $$;

ALTER TABLE "WaitlistEntry"
  ALTER COLUMN "professionalId" DROP NOT NULL,
  ALTER COLUMN "startAt" DROP NOT NULL,
  ALTER COLUMN "endAt" DROP NOT NULL,
  ALTER COLUMN "timezone" DROP NOT NULL,
  ALTER COLUMN "serviceSnapshots" DROP NOT NULL,
  ALTER COLUMN "priceCents" DROP NOT NULL;

DROP INDEX IF EXISTS "WaitlistEntry_active_client_key";
DROP INDEX IF EXISTS "WaitlistEntry_active_guest_key";

-- Colunas e dados novos permanecem. Uma reaplicacao da 009 preenche eventuais
-- linhas criadas pelo codigo antigo e restaura as garantias de unicidade.

COMMIT;
