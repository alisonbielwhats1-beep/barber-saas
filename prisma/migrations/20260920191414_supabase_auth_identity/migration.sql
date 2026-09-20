-- Generated using Supabase CLI; tracked here in the repository's Prisma history.
-- Additive identity mapping. Does not import accounts or remove legacy credentials.
BEGIN;
CREATE TABLE "AuthIdentity" (
  "id" uuid PRIMARY KEY,
  "email" text UNIQUE,
  "sessionVersion" integer NOT NULL DEFAULT 0 CHECK ("sessionVersion" >= 0)
);
ALTER TABLE "AuthIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthIdentity" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "AuthIdentity" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "AuthIdentity" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "AuthIdentity" FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON "AuthIdentity" TO app_runtime;
    CREATE POLICY auth_identity_runtime ON "AuthIdentity" TO app_runtime USING (true) WITH CHECK (true);
  END IF;
END $$;
ALTER TABLE "User" ADD COLUMN "authIdentityId" uuid REFERENCES "AuthIdentity"("id");
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
CREATE UNIQUE INDEX "User_authIdentityId_key" ON "User"("authIdentityId");
ALTER TABLE "ClientProfile" ADD COLUMN "authIdentityId" uuid REFERENCES "AuthIdentity"("id");
CREATE UNIQUE INDEX "ClientProfile_salonId_authIdentityId_key" ON "ClientProfile"("salonId", "authIdentityId");
COMMIT;
