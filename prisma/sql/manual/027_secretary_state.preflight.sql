-- Read-only. Identifies the destination before applying 027 and refuses anything but the local disposable cluster
-- (everflair_service_mvp on 127.0.0.1:55441) or the disposable CI database (salon_schema_ci).
BEGIN TRANSACTION READ ONLY;
SELECT current_database(), current_user, inet_server_addr(), inet_server_port();
DO $$ BEGIN
 IF NOT ((current_database() = 'everflair_service_mvp' AND host(inet_server_addr()) = '127.0.0.1' AND inet_server_port() = 55441)
   OR current_database() = 'salon_schema_ci') THEN
  RAISE EXCEPTION '027: only everflair_service_mvp@127.0.0.1:55441 or the CI database salon_schema_ci is allowed';
 END IF;
 IF to_regclass('public."Salon"') IS NULL OR to_regclass('public."User"') IS NULL OR to_regclass('public."Membership"') IS NULL THEN
  RAISE EXCEPTION '027: Salon/User/Membership predecessors missing';
 END IF;
 IF to_regprocedure('public.app_current_salon()') IS NULL OR to_regprocedure('public.app_current_user()') IS NULL THEN
  RAISE EXCEPTION '027: RLS helper functions app_current_salon()/app_current_user() missing';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public."Membership"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN
  RAISE EXCEPTION '027: Membership FORCE RLS missing (the alias removal policy reads it)';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'Role' AND e.enumlabel = 'MANAGER') THEN
  RAISE EXCEPTION '027: Role enum without MANAGER';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('app_runtime','mvp_service_runtime','local_app_runtime') AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION '027: unsafe runtime role';
 END IF;
END $$;
SELECT to_regclass('public."SecretaryConversation"') AS existing_conversation_table,
  to_regclass('public."SecretaryConversationEvent"') AS existing_event_table,
  to_regclass('public."SecretaryNameAlias"') AS existing_alias_table;
COMMIT;
