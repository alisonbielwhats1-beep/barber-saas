-- Read-only. Identify the destination and confirm the predecessors before 029_secretary_credits.sql.
SELECT current_database(),current_user,inet_server_addr(),inet_server_port();
DO $$ BEGIN
 IF to_regclass('public."Salon"') IS NULL OR to_regprocedure('public.hq_is_admin()') IS NULL THEN
  RAISE EXCEPTION 'Salon table or hq_is_admin() missing';
 END IF;
 IF to_regclass('public."BillingPlanChange"') IS NULL THEN RAISE EXCEPTION 'Billing 025 predecessor missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe runtime role'; END IF;
END $$;
-- Expected before: both NULL (first application) or both present (re-run is idempotent).
SELECT to_regclass('public."SecretaryCreditLedger"') AS ledger, to_regclass('public."SecretaryCreditPurchase"') AS purchase;
