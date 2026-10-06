-- Production only, after 027_secretary_state.sql and its verify, BEFORE 027_secretary_state.schedule.sql. Installs pg_cron
-- (offered by Supabase, not installed in Production on 05/10/2026) so the retention purge of 027 runs every 30 minutes as the
-- maintenance role. Same identity checks as 027_secretary_state.production.preflight.sql. Never without the owner's ok.
-- Undo (only if no other job uses it): SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'secretary-%';
-- then DROP EXTENSION pg_cron.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'postgres' OR current_user <> 'postgres'
   OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator')) <> 2
   OR NOT EXISTS (SELECT 1 FROM public."Salon" WHERE "id" = '541fc7a6-4bde-4df4-83c7-79f854dc944f' AND "slug" = 'everflair-apresentacao') THEN
  RAISE EXCEPTION '027 production cron: not the EverFlair Production project as postgres';
 END IF;
 IF to_regclass('public."SecretaryConversation"') IS NULL THEN
  RAISE EXCEPTION '027 production cron: apply 027_secretary_state.sql (and its verify) first';
 END IF;
END $$;
-- Supabase installs pg_cron in pg_catalog; its jobs live in the cron schema.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';
COMMIT;
