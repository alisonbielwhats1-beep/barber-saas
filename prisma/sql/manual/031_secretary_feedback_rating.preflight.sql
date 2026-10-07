-- Read-only. Identify the destination before applying 031 (expected: the database where 026 was applied).
SELECT current_database(),current_user,inet_server_addr(),inet_server_port();
DO $$ BEGIN
 IF to_regclass('public."SecretaryFeedback"') IS NULL THEN
  RAISE EXCEPTION 'Manual migration 026 (SecretaryFeedback) not applied';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Unsafe runtime role';
 END IF;
END $$;
SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryFeedback' AND column_name='rating') AS existing_rating_column,
 (SELECT count(*) FROM "SecretaryFeedback") AS existing_rows;
