DO $$ BEGIN
 IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('hq_accounts_billingSalonId_fkey','hq_subscriptions_billingSubscriptionId_fkey','hq_payments_billingChargeId_fkey','hq_activities_billingEventId_fkey'))<>4 THEN RAISE EXCEPTION 'Missing source relations'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'billing_hq_%')<>14 THEN RAISE EXCEPTION 'Missing scoped projection policies'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.hq_accounts'::regclass,'public.hq_customers'::regclass,'public.hq_subscriptions'::regclass,'public.hq_payments'::regclass,'public.hq_activities'::regclass) AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN RAISE EXCEPTION 'RLS not forced'; END IF;
END $$;
