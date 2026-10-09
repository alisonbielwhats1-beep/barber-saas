BEGIN READ ONLY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public."SalonPlanGrant"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN
 RAISE EXCEPTION 'Plan grant RLS missing'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='SalonPlanGrant')<>3 THEN
 RAISE EXCEPTION 'Plan grant policies missing'; END IF;
 IF has_table_privilege('app_runtime','public."SalonPlanGrant"','DELETE') OR
 has_column_privilege('app_runtime','public."SalonPlanGrant"','endsAt','UPDATE') THEN
 RAISE EXCEPTION 'Runtime can rewrite grant history'; END IF;
 IF NOT has_table_privilege('app_runtime','public."SalonPlanGrant"','SELECT') OR
 NOT has_table_privilege('app_runtime','public."SalonPlanGrant"','INSERT') OR
 NOT has_column_privilege('app_runtime','public."SalonPlanGrant"','revokedAt','UPDATE') THEN
 RAISE EXCEPTION 'Runtime grant privileges missing'; END IF;
END $$;
COMMIT;
