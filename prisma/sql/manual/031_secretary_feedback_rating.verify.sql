DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryFeedback' AND column_name='rating' AND is_nullable='NO' AND column_default LIKE '%BAD%') THEN RAISE EXCEPTION 'Missing rating column'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."SecretaryFeedback"'::regclass AND conname='SecretaryFeedback_rating') THEN RAISE EXCEPTION 'Missing rating check'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public."SecretaryFeedback"'::regclass AND tgname='secretary_feedback_immutable') THEN RAISE EXCEPTION 'Missing immutable feedback guard'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='SecretaryFeedback') <> 2 THEN RAISE EXCEPTION 'Unexpected feedback policies'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') AND (has_table_privilege('app_runtime','"SecretaryFeedback"','UPDATE') OR has_table_privilege('app_runtime','"SecretaryFeedback"','DELETE')) THEN RAISE EXCEPTION 'Runtime may change feedback'; END IF;
END $$;
SELECT 'VERIFY_OK' AS result;
