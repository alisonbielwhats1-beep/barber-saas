-- Rollback of 033_stripe_billing.sql. Refused once anything was created through Stripe: those contracts, purchases and
-- customers are financial history tied to live provider objects. To stop selling, set STRIPE_CHECKOUT_PAUSED=true
-- (renewals and cancellations keep working) and keep this schema.
-- The "provider" columns, their checks and immutability triggers are kept on purpose: application versions from 033 on
-- read them and earlier ones ignore them, so dropping them could only break a running deploy (every billing read and
-- booking). Revert the application before running this file: it removes "BillingCustomer", which Stripe code writes.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:033_stripe_billing',0));
DO $$ BEGIN
 IF to_regclass('public."BillingCustomer"') IS NOT NULL AND EXISTS(SELECT 1 FROM "BillingCustomer") THEN
  RAISE EXCEPTION 'Billing customers exist: keep 033, pause the Stripe checkout instead';
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='BillingSubscription' AND column_name='provider')
  AND EXISTS(SELECT 1 FROM "BillingSubscription" WHERE "provider" <> 'mercadopago') THEN
  RAISE EXCEPTION 'Stripe subscriptions exist: keep 033, pause the Stripe checkout instead';
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryCreditPurchase' AND column_name='provider')
  AND EXISTS(SELECT 1 FROM "SecretaryCreditPurchase" WHERE "provider" <> 'mercadopago') THEN
  RAISE EXCEPTION 'Stripe purchases exist: keep 033, pause the Stripe checkout instead';
 END IF;
END $$;
DROP TABLE IF EXISTS "BillingCustomer";
DROP FUNCTION IF EXISTS public.billing_customer_immutable();
COMMIT;
