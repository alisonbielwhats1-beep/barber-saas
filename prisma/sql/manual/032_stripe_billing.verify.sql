-- Read-only checks after 032_stripe_billing.sql.
DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='provider' AND is_nullable='NO'
   AND column_default LIKE '''mercadopago''%' AND table_name IN ('BillingSubscription','SecretaryCreditPurchase')) <> 2 THEN RAISE EXCEPTION 'Missing provider columns'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('BillingSubscription_provider_check','SecretaryCreditPurchase_provider_check')) <> 2 THEN RAISE EXCEPTION 'Missing provider checks'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgname='billing_provider_immutable' AND tgrelid IN ('public."BillingSubscription"'::regclass,'public."SecretaryCreditPurchase"'::regclass)) <> 2 THEN RAISE EXCEPTION 'Missing immutable provider guard'; END IF;
 IF EXISTS(SELECT 1 FROM "BillingSubscription" WHERE "provider" NOT IN ('mercadopago','stripe')) OR EXISTS(SELECT 1 FROM "SecretaryCreditPurchase" WHERE "provider" NOT IN ('mercadopago','stripe')) THEN RAISE EXCEPTION 'Unexpected provider'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public."BillingCustomer"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'Missing customer FORCE RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public."BillingCustomer"'::regclass AND tgname='billing_customer_immutable') THEN RAISE EXCEPTION 'Missing append-only customer guard'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='BillingCustomer_salonId_provider_mode_accountId_key') THEN RAISE EXCEPTION 'Missing one-customer index'; END IF;
 -- Same referential actions as the Prisma relation (Restrict, Cascade), so the schema does not drift.
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='BillingCustomer_salonId_fkey' AND confdeltype='r' AND confupdtype='c') THEN RAISE EXCEPTION 'Unexpected customer foreign key'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE tablename='BillingCustomer') <> 2 THEN RAISE EXCEPTION 'Unexpected customer policies'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') AND (has_table_privilege('app_runtime','"BillingCustomer"','UPDATE') OR has_table_privilege('app_runtime','"BillingCustomer"','DELETE')) THEN
  RAISE EXCEPTION 'Runtime may change customers';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_table_privilege('anon','"BillingCustomer"','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected anon grant'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') AND has_table_privilege('authenticated','"BillingCustomer"','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected authenticated grant'; END IF;
END $$;
SELECT 'VERIFY_OK' AS result;
