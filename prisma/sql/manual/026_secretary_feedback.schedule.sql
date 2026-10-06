-- Schedules the daily retention purge of "SecretaryFeedback" (the statement of 026_secretary_feedback.purge.sql) with
-- pg_cron. Run once, as the maintenance role that bypasses RLS (a pg_cron job runs as the role that scheduled it), on
-- the identified destination, BEFORE turning SALON_SECRETARY_FEEDBACK on. Never Production without approval.
-- Without pg_cron (e.g. the local disposable database) it fails closed: schedule 026_secretary_feedback.purge.sql with the
-- platform's own job runner instead. Idempotent (the job is replaced by name).
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Schedule the feedback purge as the maintenance role (FORCE RLS hides the rows from any other role)';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  RAISE EXCEPTION 'pg_cron is not installed: schedule 026_secretary_feedback.purge.sql with the platform job runner';
 END IF;
 PERFORM cron.schedule('secretary-feedback-purge', '17 6 * * *', $job$DELETE FROM "SecretaryFeedback" WHERE "expiresAt" < now()$job$);
END $$;
