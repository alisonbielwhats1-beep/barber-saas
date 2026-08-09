-- Aprovação central de novos estabelecimentos.
-- Migration aditiva: preserva salões existentes, que nascem como APPROVED.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPER_ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SalonAccessStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SalonAccessEventType" AS ENUM (
    'REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REACTIVATED', 'PLAN_CHANGED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER';

-- O primeiro default aprova as linhas existentes. Depois do backfill, o
-- default definitivo muda para PENDING, afetando apenas novos cadastros.
ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "accessStatus" "SalonAccessStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "accessRequestedAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "accessReviewedAt" TIMESTAMPTZ(3);

UPDATE "Salon"
SET "accessRequestedAt" = "createdAt" AT TIME ZONE 'UTC'
WHERE "accessRequestedAt" IS NULL;

ALTER TABLE "Salon"
  ALTER COLUMN "accessStatus" SET DEFAULT 'PENDING',
  ALTER COLUMN "accessRequestedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "accessRequestedAt" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "SalonAccessEvent" (
  id TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "actorUserId" TEXT,
  type "SalonAccessEventType" NOT NULL,
  "previousStatus" "SalonAccessStatus",
  "newStatus" "SalonAccessStatus" NOT NULL,
  "previousPlan" "Plan",
  "newPlan" "Plan" NOT NULL,
  reason TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalonAccessEvent_pkey" PRIMARY KEY (id),
  CONSTRAINT "SalonAccessEvent_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"(id) ON DELETE CASCADE,
  CONSTRAINT "SalonAccessEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "SalonAccessEvent_salonId_createdAt_idx"
  ON "SalonAccessEvent" ("salonId", "createdAt");
CREATE INDEX IF NOT EXISTS "SalonAccessEvent_newStatus_createdAt_idx"
  ON "SalonAccessEvent" ("newStatus", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SalonAccessEvent_single_request_key"
  ON "SalonAccessEvent" ("salonId", type)
  WHERE type = 'REQUESTED';
CREATE INDEX IF NOT EXISTS "Salon_accessStatus_accessRequestedAt_idx"
  ON "Salon" ("accessStatus", "accessRequestedAt");

CREATE OR REPLACE FUNCTION app_current_user() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')
$$ LANGUAGE SQL STABLE;

ALTER TABLE "SalonAccessEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalonAccessEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Salon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Salon" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_admin_access_events ON "SalonAccessEvent";
CREATE POLICY platform_admin_access_events ON "SalonAccessEvent"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user()
        AND "platformRole" = 'SUPER_ADMIN'
    )
  );

DROP POLICY IF EXISTS platform_admin_insert_access_events ON "SalonAccessEvent";
CREATE POLICY platform_admin_insert_access_events ON "SalonAccessEvent"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user()
        AND "platformRole" = 'SUPER_ADMIN'
    )
    OR (
      "actorUserId" = app_current_user()
      AND "newStatus" = 'PENDING'
      AND "previousStatus" IS NULL
      AND EXISTS (
        SELECT 1 FROM "Membership"
        WHERE "Membership"."salonId" = "SalonAccessEvent"."salonId"
          AND "Membership"."userId" = app_current_user()
          AND "Membership".role = 'OWNER'
      )
    )
  );

DROP POLICY IF EXISTS salon_platform_admin_update ON "Salon";
CREATE POLICY salon_platform_admin_update ON "Salon"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user()
        AND "platformRole" = 'SUPER_ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user()
        AND "platformRole" = 'SUPER_ADMIN'
    )
  );

-- Mantém o resolvedor de tenants funcionando no painel da plataforma.
DROP POLICY IF EXISTS membership_read ON "Membership";
CREATE POLICY membership_read ON "Membership"
  FOR SELECT USING (
    "userId" = app_current_user()
    OR "salonId" = app_current_salon()
    OR EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user()
        AND "platformRole" = 'SUPER_ADMIN'
    )
  );

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "SalonAccessEvent" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "SalonAccessEvent" FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT ON TABLE "SalonAccessEvent" TO app_runtime';
  END IF;
END $$;

COMMIT;
