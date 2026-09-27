BEGIN TRANSACTION READ ONLY;
SELECT current_database(), current_user, inet_server_addr(), inet_server_port();
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'Salon'
  AND column_name IN ('coverUrl', 'coverShowName')
ORDER BY column_name;
SELECT relrowsecurity, relforcerowsecurity FROM pg_class
WHERE oid = 'public."Salon"'::regclass;
SELECT count(*) AS salons, count("coverUrl") AS salons_with_cover FROM public."Salon";
COMMIT;
