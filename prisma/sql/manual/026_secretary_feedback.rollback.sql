-- Rollback of 026. Feedback rows are owner opinions and optional conversation text (personal data): export them first
-- only if the owner asked to keep them. Turn SALON_SECRETARY_FEEDBACK off before running this.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:026_secretary_feedback',0));
SELECT count(*) AS feedback_rows, count(*) FILTER (WHERE "transcript" IS NOT NULL) AS with_transcript FROM "SecretaryFeedback";
DROP TABLE IF EXISTS "SecretaryFeedback";
DROP FUNCTION IF EXISTS public.secretary_feedback_immutable();
COMMIT;
