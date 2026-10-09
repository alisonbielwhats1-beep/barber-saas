-- Read-only. Identify the destination and confirm the predecessors before 033_stripe_billing.sql.
SELECT current_database(),current_user,inet_server_addr(),inet_server_port();
DO $$ BEGIN
 IF to_regclass('public."Salon"') IS NULL OR to_regprocedure('public.hq_is_admin()') IS NULL THEN
  RAISE EXCEPTION 'Salon table or hq_is_admin() missing';
 END IF;
 IF to_regclass('public."BillingSubscription"') IS NULL OR to_regclass('public."BillingPlanChange"') IS NULL THEN RAISE EXCEPTION 'Billing 023/025 predecessors missing'; END IF;
 IF to_regclass('public."SecretaryCreditPurchase"') IS NULL THEN RAISE EXCEPTION 'Secretary credits 029 predecessor missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryCreditPurchase' AND column_name='units') THEN RAISE EXCEPTION 'Secretary credit units 030 predecessor missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe runtime role'; END IF;
END $$;
-- Expected before: no "provider" columns and no "BillingCustomer" (first application), or all present (re-run is idempotent).
SELECT (SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.columns
  WHERE table_schema='public' AND column_name='provider' AND table_name IN ('BillingSubscription','SecretaryCreditPurchase')) AS provider_columns,
 to_regclass('public."BillingCustomer"') AS customer_table,
 (SELECT count(*) FROM "BillingSubscription") AS subscriptions, (SELECT count(*) FROM "SecretaryCreditPurchase") AS purchases;
