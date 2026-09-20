-- Read only. Save counts and encrypted backup before applying migration.sql.
SELECT current_database(), current_user;
SELECT count(*) AS users FROM "User";
SELECT count(*) AS clients FROM "ClientProfile";
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
WHERE oid IN ('"ClientProfile"'::regclass, '"Membership"'::regclass);
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_runtime';
DO $$ BEGIN
  IF to_regclass('public."AuthIdentity"') IS NOT NULL THEN
    RAISE EXCEPTION 'Identity schema already exists: inspect it; do not reapply';
  END IF;
END $$;
