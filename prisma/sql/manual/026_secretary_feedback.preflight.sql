-- Read-only. Identify the destination before applying 026 (expected locally: 127.0.0.1:55441/everflair_service_mvp).
SELECT current_database(),current_user,inet_server_addr(),inet_server_port();
DO $$ BEGIN
 IF to_regclass('public."Salon"') IS NULL OR to_regclass('public."User"') IS NULL THEN
  RAISE EXCEPTION 'Salon/User predecessors missing';
 END IF;
 IF to_regprocedure('public.app_current_salon()') IS NULL OR to_regprocedure('public.app_current_user()') IS NULL THEN
  RAISE EXCEPTION 'RLS helper functions app_current_salon()/app_current_user() missing';
 END IF;
 IF to_regclass('public."BillingPlanChange"') IS NULL THEN
  RAISE EXCEPTION 'Manual migration 025 not applied';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Unsafe runtime role';
 END IF;
END $$;
SELECT to_regclass('public."SecretaryFeedback"') AS existing_feedback_table;
