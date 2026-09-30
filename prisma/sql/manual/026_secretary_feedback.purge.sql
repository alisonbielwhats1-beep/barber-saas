-- Maintenance only, never the runtime: deletes owner feedback past its 90-day retention ("expiresAt"). Idempotent.
-- FORCE RLS applies to the table owner too, so only a role that bypasses RLS (superuser, or a BYPASSRLS maintenance role)
-- can see the rows to delete; any other role fails closed here before deleting anything. The read policy already hides
-- expired rows from the runtime. Run it daily (026_secretary_feedback.schedule.sql) before SALON_SECRETARY_FEEDBACK is on.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('maintenance:secretary_feedback_purge',0));
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Feedback purge must run as the maintenance role (FORCE RLS hides the rows from any other role)';
 END IF;
END $$;
DELETE FROM "SecretaryFeedback" WHERE "expiresAt" < now();
SELECT count(*) AS expired_left FROM "SecretaryFeedback" WHERE "expiresAt" < now();
COMMIT;
