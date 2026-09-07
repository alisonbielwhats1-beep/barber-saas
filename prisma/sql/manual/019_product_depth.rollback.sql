-- Non-destructive application rollback: retain private history, dependent links,
-- resource exclusion and triggers. Previous code ignores the additive columns.
-- Never remove guards while any services require physical resources.
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN
 IF to_regclass('"CareEntry"') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='resource_no_overlap') THEN RAISE EXCEPTION '019: safe rollback requires additive schema and resource guard'; END IF;
END $$;
COMMIT;
