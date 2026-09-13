DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public."BillingPlanChange"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'Missing change FORCE RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='BillingPlanChange_one_pending') THEN RAISE EXCEPTION 'Missing pending change uniqueness'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public."BillingPlanChange"'::regclass AND contype='f') <> 3 THEN RAISE EXCEPTION 'Missing change foreign keys'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public."BillingPlanChange"'::regclass AND tgname='billing_change_preserve_quote') THEN RAISE EXCEPTION 'Missing immutable quote guard'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe runtime role'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_table_privilege('anon','"BillingPlanChange"','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected anon grant'; END IF;
END $$;
