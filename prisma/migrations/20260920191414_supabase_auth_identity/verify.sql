DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = '"AuthIdentity"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'Identity RLS missing';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name IN ('User', 'ClientProfile') AND column_name = 'authIdentityId') <> 2 THEN
    RAISE EXCEPTION 'Identity mapping missing';
  END IF;
END $$;
SELECT count(*) AS users FROM "User";
SELECT count(*) AS clients FROM "ClientProfile";
