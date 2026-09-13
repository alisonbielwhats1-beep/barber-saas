-- READ ONLY. Operator must identify environment and verify restorable backup before apply.
SELECT current_database(), inet_server_addr(), inet_server_port(), current_user;
DO $$ BEGIN
 IF to_regclass('public."BillingSubscription"') IS NULL OR to_regclass('public.hq_accounts') IS NULL THEN RAISE EXCEPTION 'Requires migrations 020 and 023'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.hq_accounts'::regclass,'public.hq_customers'::regclass,'public.hq_subscriptions'::regclass,'public.hq_payments'::regclass,'public.hq_activities'::regclass) AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN RAISE EXCEPTION 'HQ must have ENABLE/FORCE RLS'; END IF;
END $$;
