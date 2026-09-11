DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.hq_agent_runs'::regclass AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'RLS ausente'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE tablename='hq_agent_runs')<>3 THEN RAISE EXCEPTION 'Policies divergentes'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.hq_agent_runs'::regclass AND contype='f') THEN RAISE EXCEPTION 'FK ausente'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_name='hq_agent_runs' AND grantee IN ('PUBLIC','anon','authenticated')) THEN RAISE EXCEPTION 'Grant publico indevido'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_name='hq_agent_runs' AND grantee='app_runtime' AND privilege_type='DELETE') THEN RAISE EXCEPTION 'DELETE indevido'; END IF;
END $$;
SELECT count(*) AS preserved_runs FROM public.hq_agent_runs;

