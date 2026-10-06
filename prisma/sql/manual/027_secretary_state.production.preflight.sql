-- Read-only. Production version of 027_secretary_state.preflight.sql (that one accepts only the local disposable cluster or
-- the CI database, and stays as it is). Identifies the EverFlair Production Supabase project before 027 is applied there,
-- keeping every other check of the original. Runbook: docs/SECRETARY_027_PRODUCTION.md. Never apply without the owner's ok.
-- Identity (all must hold): database "postgres" of a Supabase project (roles supabase_admin and authenticator), run as the
-- maintenance role "postgres" (BYPASSRLS, not superuser), and the presentation salon of Production with its exact id
-- (the pilot's salon: a copy of the data elsewhere would not carry this id together with the rest).
BEGIN TRANSACTION READ ONLY;
SELECT current_database(), current_user, inet_server_port(), version();
DO $$ BEGIN
 IF current_database() <> 'postgres' OR current_user <> 'postgres' THEN
  RAISE EXCEPTION '027 production: run on database postgres as the maintenance role postgres';
 END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator')) <> 2 THEN
  RAISE EXCEPTION '027 production: not a Supabase project';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public."Salon" WHERE "id" = '541fc7a6-4bde-4df4-83c7-79f854dc944f' AND "slug" = 'everflair-apresentacao') THEN
  RAISE EXCEPTION '027 production: not the EverFlair Production project (presentation salon id not found)';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres' AND rolbypassrls AND NOT rolsuper) THEN
  RAISE EXCEPTION '027 production: maintenance role postgres without BYPASSRLS (the purge needs it)';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls) THEN
  RAISE EXCEPTION '027 production: runtime role app_runtime missing or unsafe';
 END IF;
 -- The checks of the original preflight, unchanged.
 IF to_regclass('public."Salon"') IS NULL OR to_regclass('public."User"') IS NULL OR to_regclass('public."Membership"') IS NULL THEN
  RAISE EXCEPTION '027: Salon/User/Membership predecessors missing';
 END IF;
 IF to_regprocedure('public.app_current_salon()') IS NULL OR to_regprocedure('public.app_current_user()') IS NULL THEN
  RAISE EXCEPTION '027: RLS helper functions app_current_salon()/app_current_user() missing';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public."Membership"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN
  RAISE EXCEPTION '027: Membership FORCE RLS missing (the alias removal policy reads it)';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'Role' AND e.enumlabel = 'MANAGER') THEN
  RAISE EXCEPTION '027: Role enum without MANAGER';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('app_runtime','mvp_service_runtime','local_app_runtime') AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION '027: unsafe runtime role';
 END IF;
END $$;
-- State before: the three tables (null = not created yet), pg_cron (the purge is scheduled with it) and the objects the
-- rollback would remove.
SELECT to_regclass('public."SecretaryConversation"') AS existing_conversation_table,
  to_regclass('public."SecretaryConversationEvent"') AS existing_event_table,
  to_regclass('public."SecretaryNameAlias"') AS existing_alias_table,
  to_regprocedure('public.secretary_conversation_event_append_only()') AS existing_event_guard,
  EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') AS pg_cron_available,
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AS pg_cron_installed,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r') AS public_tables,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS public_policies;
COMMIT;
