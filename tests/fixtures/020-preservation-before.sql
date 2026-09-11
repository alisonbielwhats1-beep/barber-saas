CREATE SCHEMA IF NOT EXISTS migration020_test;
REVOKE ALL ON SCHEMA migration020_test FROM PUBLIC;
CREATE TABLE migration020_test.records AS
SELECT 'Service'::text AS kind, id, to_jsonb(s) AS payload FROM public."Service" s
UNION ALL SELECT 'AppointmentService', jsonb_build_array("appointmentId", position)::text, to_jsonb(s) FROM public."AppointmentService" s;
CREATE TABLE migration020_test.security AS
SELECT oid, relrowsecurity, relforcerowsecurity, relacl::text AS acl FROM pg_class
WHERE oid IN ('public."Service"'::regclass, 'public."AppointmentService"'::regclass);
