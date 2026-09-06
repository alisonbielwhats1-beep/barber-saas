-- Aditiva. Executar somente após preflight, backup e autorização do ambiente.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "checkedInAt" timestamptz(3);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "checkedInById" text;

CREATE TABLE IF NOT EXISTS "ProfessionalOpening" (
  "id" text PRIMARY KEY,
  "salonId" text NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE,
  "professionalId" text NOT NULL,
  "dateKey" varchar(10) NOT NULL,
  "startMinutes" integer NOT NULL,
  "endMinutes" integer NOT NULL,
  "reason" text NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfessionalOpening_professionalId_salonId_fkey" FOREIGN KEY ("professionalId", "salonId") REFERENCES "Professional"("id", "salonId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProfessionalOpening_salonId_professionalId_dateKey_idx" ON "ProfessionalOpening"("salonId", "professionalId", "dateKey");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"ProfessionalOpening"'::regclass AND conname = 'ProfessionalOpening_valid_interval') THEN
    ALTER TABLE "ProfessionalOpening" ADD CONSTRAINT "ProfessionalOpening_valid_interval" CHECK (
      "startMinutes" >= 0 AND "startMinutes" < "endMinutes" AND "endMinutes" <= 1440
      AND length(trim("reason")) BETWEEN 3 AND 200
      AND "dateKey" ~ '^\d{4}-\d{2}-\d{2}$' AND to_char("dateKey"::date, 'YYYY-MM-DD') = "dateKey"
    );
  END IF;
END $$;

ALTER TABLE "ProfessionalOpening" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfessionalOpening" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "professional_opening_tenant" ON "ProfessionalOpening";
CREATE POLICY "professional_opening_tenant" ON "ProfessionalOpening"
  USING ("salonId" = app_current_salon()) WITH CHECK ("salonId" = app_current_salon());
REVOKE ALL ON "ProfessionalOpening" FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON "ProfessionalOpening" FROM %I', role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ProfessionalOpening" TO app_runtime;
  END IF;
END $$;
COMMIT;
