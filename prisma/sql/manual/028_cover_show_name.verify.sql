BEGIN TRANSACTION READ ONLY;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'Salon' AND column_name = 'coverShowName';
SELECT relrowsecurity, relforcerowsecurity FROM pg_class
WHERE oid = 'public."Salon"'::regclass;
SELECT count(*) AS salons,
       count(*) FILTER (WHERE "coverShowName") AS showing_name,
       count(*) FILTER (WHERE NOT "coverShowName") AS hiding_name
FROM public."Salon";
COMMIT;
