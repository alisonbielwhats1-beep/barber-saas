-- Schedules the retention purge of 027 (the statements of 027_secretary_state.purge.sql) with pg_cron. Run once, as the
-- maintenance role that bypasses RLS (a pg_cron job runs as the role that scheduled it), on the identified destination,
-- BEFORE turning SALON_SECRETARY_PERSISTED_STATE or SALON_SECRETARY_NAME_ALIASES on. Never Production without approval.
-- Conversation state holds customer names and the owner's words: expired conversations (at most 2 h after they start) are
-- deleted every 30 minutes, whether or not their user ever comes back. Aliases unused for a year, or whose customer was
-- merged or erased, are deleted daily.
-- Without pg_cron (e.g. the local disposable database) it fails closed: schedule 027_secretary_state.purge.sql with the
-- platform's own job runner instead (every 30 minutes). Idempotent (the jobs are replaced by name).
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Schedule the secretary state purge as the maintenance role (FORCE RLS hides the rows from any other role)';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  RAISE EXCEPTION 'pg_cron is not installed: schedule 027_secretary_state.purge.sql with the platform job runner';
 END IF;
 PERFORM cron.schedule('secretary-conversation-purge', '*/30 * * * *', $job$DELETE FROM "SecretaryConversation" WHERE "expiresAt" < now()$job$);
 PERFORM cron.schedule('secretary-name-alias-purge', '23 6 * * *', $job$DELETE FROM "SecretaryNameAlias" a WHERE a."lastUsedAt" < now() - interval '365 days'
  OR (a."kind" = 'customer' AND NOT EXISTS (SELECT 1 FROM "ClientProfile" c WHERE c."id" = a."targetId" AND c."salonId" = a."salonId" AND c."mergedIntoId" IS NULL))$job$);
END $$;
