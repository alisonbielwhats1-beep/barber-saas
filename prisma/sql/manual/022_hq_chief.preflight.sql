SELECT current_database(), current_user, inet_server_addr();
DO $$ BEGIN
 IF to_regprocedure('public.hq_is_admin()') IS NULL OR to_regclass('public.hq_accounts') IS NULL THEN RAISE EXCEPTION 'HQ 020 ausente'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Runtime privilegiado'; END IF;
END $$;
SELECT tablename,policyname FROM pg_policies WHERE tablename='hq_agent_runs';
