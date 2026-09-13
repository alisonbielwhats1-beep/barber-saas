SELECT current_database(),current_user,inet_server_addr(),inet_server_port();
DO $$ BEGIN
 IF to_regclass('public."BillingSubscription"') IS NULL OR to_regclass('public.hq_subscriptions') IS NULL
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='BillingCharge' AND column_name='refundedCents') THEN
  RAISE EXCEPTION 'Billing 023 / HQ 024 predecessors missing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public."BillingSubscription"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN
  RAISE EXCEPTION 'Billing FORCE RLS missing';
 END IF;
END $$;
SELECT count(*) AS subscriptions FROM "BillingSubscription";
SELECT count(*) AS charges,coalesce(sum("amountCents"),0) AS cents FROM "BillingCharge";
