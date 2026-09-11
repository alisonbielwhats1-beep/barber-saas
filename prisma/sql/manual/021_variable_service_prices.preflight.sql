BEGIN TRANSACTION READ ONLY;
SELECT current_database(), current_user, inet_server_addr(), inet_server_port();
SELECT 'Service' AS object, count(*) AS rows FROM public."Service"
UNION ALL SELECT 'AppointmentService', count(*) FROM public."AppointmentService";
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('Service', 'AppointmentService')
AND column_name IN ('priceCents', 'priceType', 'priceNote') ORDER BY table_name, column_name;
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, p.polname, pg_get_expr(p.polqual, p.polrelid) AS using_expression
FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE c.oid IN ('public."Service"'::regclass, 'public."AppointmentService"'::regclass);
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid IN ('public."Service"'::regclass, 'public."AppointmentService"'::regclass);
COMMIT;
