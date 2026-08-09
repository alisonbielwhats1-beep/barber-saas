-- Rollback de compatibilidade, sem apagar status ou histórico.
-- Reverter o código junto deste arquivo faz a versão anterior ignorar os
-- campos novos. O default APPROVED evita que o código antigo crie bloqueios.

BEGIN;

ALTER TABLE "Salon"
  ALTER COLUMN "accessStatus" SET DEFAULT 'APPROVED';

DROP POLICY IF EXISTS salon_platform_admin_update ON "Salon";

DROP POLICY IF EXISTS platform_admin_access_events ON "SalonAccessEvent";
DROP POLICY IF EXISTS platform_admin_insert_access_events ON "SalonAccessEvent";

DROP POLICY IF EXISTS membership_read ON "Membership";
CREATE POLICY membership_read ON "Membership"
  FOR SELECT USING (
    "userId" = app_current_user()
    OR "salonId" = app_current_salon()
  );

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE SELECT, INSERT ON TABLE "SalonAccessEvent" FROM app_runtime';
  END IF;
END $$;

COMMIT;
