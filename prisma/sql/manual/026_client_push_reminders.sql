-- Apply only after the read-only preflight, backup, isolated PostgreSQL test,
-- project identification and explicit production authorization.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TYPE public."NotificationChannel" ADD VALUE IF NOT EXISTS 'PUSH';

CREATE TABLE IF NOT EXISTS public."ClientPushSubscription" (
  "id" text NOT NULL PRIMARY KEY,
  "salonId" text NOT NULL,
  "clientId" text NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "revokedAt" timestamptz(3),
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientPushSubscription_salonId_fkey" FOREIGN KEY ("salonId")
    REFERENCES public."Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClientPushSubscription_client_tenant_fkey" FOREIGN KEY ("clientId", "salonId")
    REFERENCES public."ClientProfile"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClientPushSubscription_salonId_endpoint_key"
  ON public."ClientPushSubscription"("salonId", "endpoint");
CREATE INDEX IF NOT EXISTS "ClientPushSubscription_salonId_clientId_revokedAt_idx"
  ON public."ClientPushSubscription"("salonId", "clientId", "revokedAt");

ALTER TABLE public."ClientPushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ClientPushSubscription" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public."ClientPushSubscription"'::regclass AND polname = 'client_push_tenant') THEN
    CREATE POLICY client_push_tenant ON public."ClientPushSubscription"
      USING ("salonId" = app_current_salon())
      WITH CHECK ("salonId" = app_current_salon());
  END IF;
END $$;
REVOKE ALL ON public."ClientPushSubscription" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public."ClientPushSubscription" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public."ClientPushSubscription" FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."ClientPushSubscription" TO app_runtime;
  END IF;
END $$;
COMMIT;
