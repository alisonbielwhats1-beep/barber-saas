-- Additive. Run the companion preflight first, on the identified destination. Never Production without approval.
-- Owner feedback on a Secretary reply ("Não era isso", flag SALON_SECRETARY_FEEDBACK). Raw-SQL table, no Prisma model:
-- the application inserts through $queryRaw inside withTenant (app.current_salon + app.current_user_id).
-- Rows are append-only for the runtime (no UPDATE/DELETE grant; UPDATE refused by trigger) and expire after 90 days:
-- the read policy hides expired rows, and 026_secretary_feedback.purge.sql deletes them. FORCE RLS applies to the table
-- owner too, so the purge runs as a maintenance role that bypasses RLS (never the runtime); schedule it with
-- 026_secretary_feedback.schedule.sql BEFORE turning SALON_SECRETARY_FEEDBACK on.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:026_secretary_feedback',0));
CREATE TABLE IF NOT EXISTS "SecretaryFeedback" (
  "id" UUID PRIMARY KEY,
  "salonId" TEXT NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "sessionId" UUID NOT NULL,
  "turnIndex" INTEGER NOT NULL CHECK ("turnIndex" BETWEEN 0 AND 500),
  "outcomeCodes" JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("outcomeCodes")='array' AND jsonb_array_length("outcomeCodes")<=32),
  "contractVersion" TEXT CHECK ("contractVersion" IS NULL OR "contractVersion" ~ '^[0-9a-f]{64}$'),
  "comment" TEXT CHECK ("comment" IS NULL OR char_length("comment") BETWEEN 1 AND 1000),
  "transcriptConsent" BOOLEAN NOT NULL DEFAULT false,
  "transcript" JSONB CHECK ("transcript" IS NULL OR (jsonb_typeof("transcript")='array' AND jsonb_array_length("transcript") BETWEEN 1 AND 80 AND octet_length("transcript"::text)<=262144)),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '90 days'),
  -- The conversation text exists only with the owner's explicit consent (the checkbox).
  CONSTRAINT "SecretaryFeedback_transcript_consent" CHECK ("transcript" IS NULL OR "transcriptConsent"),
  CONSTRAINT "SecretaryFeedback_retention" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '90 days')
);
CREATE INDEX IF NOT EXISTS "SecretaryFeedback_salonId_createdAt_idx" ON "SecretaryFeedback"("salonId","createdAt");
CREATE INDEX IF NOT EXISTS "SecretaryFeedback_expiresAt_idx" ON "SecretaryFeedback"("expiresAt");

CREATE OR REPLACE FUNCTION public.secretary_feedback_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 RAISE EXCEPTION 'Secretary feedback is immutable';
END $$;
DROP TRIGGER IF EXISTS secretary_feedback_immutable ON "SecretaryFeedback";
CREATE TRIGGER secretary_feedback_immutable BEFORE UPDATE ON "SecretaryFeedback" FOR EACH ROW EXECUTE FUNCTION public.secretary_feedback_immutable();
ALTER TABLE "SecretaryFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecretaryFeedback" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "SecretaryFeedback" FROM PUBLIC;
DROP POLICY IF EXISTS secretary_feedback_read ON "SecretaryFeedback";
CREATE POLICY secretary_feedback_read ON "SecretaryFeedback" FOR SELECT USING ("salonId" = app_current_salon() AND "userId" = app_current_user() AND "expiresAt" > now());
DROP POLICY IF EXISTS secretary_feedback_insert ON "SecretaryFeedback";
CREATE POLICY secretary_feedback_insert ON "SecretaryFeedback" FOR INSERT WITH CHECK ("salonId" = app_current_salon() AND "userId" = app_current_user());
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "SecretaryFeedback" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "SecretaryFeedback" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
  REVOKE ALL ON "SecretaryFeedback" FROM app_runtime;
  GRANT SELECT,INSERT ON "SecretaryFeedback" TO app_runtime;
 END IF;
END $$;
COMMIT;
