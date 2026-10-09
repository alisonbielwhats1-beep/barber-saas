BEGIN READ ONLY;
SELECT current_database(),current_user,inet_server_addr(),inet_server_port();
SELECT to_regclass('public."Salon"') AS salon, to_regclass('public."SalonPlanGrant"') AS existing_grants,
 to_regprocedure('public.hq_is_admin()') AS admin_policy;
SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN
 ('public."Salon"'::regclass,'public.hq_accounts'::regclass);
SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='app_runtime';
COMMIT;
