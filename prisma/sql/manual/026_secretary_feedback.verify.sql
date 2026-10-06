DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public."SecretaryFeedback"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'Missing feedback FORCE RLS'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='SecretaryFeedback') <> 2 THEN RAISE EXCEPTION 'Unexpected feedback policies'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public."SecretaryFeedback"'::regclass AND tgname='secretary_feedback_immutable') THEN RAISE EXCEPTION 'Missing immutable feedback guard'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."SecretaryFeedback"'::regclass AND conname='SecretaryFeedback_transcript_consent') THEN RAISE EXCEPTION 'Missing transcript consent check'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryFeedback' AND column_name='expiresAt' AND column_default IS NOT NULL) THEN RAISE EXCEPTION 'Missing retention default'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='SecretaryFeedback' AND policyname='secretary_feedback_read' AND cmd='SELECT' AND qual LIKE '%expiresAt%now()%') THEN RAISE EXCEPTION 'Read policy shows expired feedback'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe runtime role'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') AND (has_table_privilege('app_runtime','"SecretaryFeedback"','UPDATE') OR has_table_privilege('app_runtime','"SecretaryFeedback"','DELETE')) THEN RAISE EXCEPTION 'Runtime may change feedback'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_table_privilege('anon','"SecretaryFeedback"','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected anon grant'; END IF;
 IF has_table_privilege('public','"SecretaryFeedback"','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected PUBLIC grant'; END IF;
END $$;
