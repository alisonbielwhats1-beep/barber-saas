-- Additive. Run the companion preflight first, on the identified destination.
-- Owner decision 09/10/2026: Stripe (card, Apple Pay, Google Pay) alongside Mercado Pago, for subscriptions and Secretária packs.
-- Existing rows become 'mercadopago' through the column default (no table rewrite, no change to their terms or history).
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:032_stripe_billing',0));

ALTER TABLE "BillingSubscription" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'mercadopago';
ALTER TABLE "SecretaryCreditPurchase" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'mercadopago';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='BillingSubscription_provider_check') THEN
  ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_provider_check" CHECK ("provider" IN ('mercadopago','stripe'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='SecretaryCreditPurchase_provider_check') THEN
  ALTER TABLE "SecretaryCreditPurchase" ADD CONSTRAINT "SecretaryCreditPurchase_provider_check" CHECK ("provider" IN ('mercadopago','stripe'));
 END IF;
END $$;

-- A contract or purchase is reconciled only with the provider that created it: the provider never changes afterwards.
CREATE OR REPLACE FUNCTION public.billing_provider_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW."provider" IS DISTINCT FROM OLD."provider" THEN RAISE EXCEPTION 'Billing provider is immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS billing_provider_immutable ON "BillingSubscription";
CREATE TRIGGER billing_provider_immutable BEFORE UPDATE OF "provider" ON "BillingSubscription" FOR EACH ROW EXECUTE FUNCTION public.billing_provider_immutable();
DROP TRIGGER IF EXISTS billing_provider_immutable ON "SecretaryCreditPurchase";
CREATE TRIGGER billing_provider_immutable BEFORE UPDATE OF "provider" ON "SecretaryCreditPurchase" FOR EACH ROW EXECUTE FUNCTION public.billing_provider_immutable();

-- One provider customer per salon, account and mode (a test customer never pays live). Created once, never changed.
CREATE TABLE IF NOT EXISTS "BillingCustomer" (
  "id" UUID PRIMARY KEY,
  "salonId" TEXT NOT NULL REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('mercadopago','stripe')),
  "mode" TEXT NOT NULL CHECK ("mode" IN ('test','live')),
  "accountId" TEXT NOT NULL CHECK (char_length("accountId") BETWEEN 1 AND 100),
  "customerId" TEXT NOT NULL UNIQUE CHECK (char_length("customerId") BETWEEN 1 AND 100),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "BillingCustomer_salonId_provider_mode_accountId_key" ON "BillingCustomer"("salonId","provider","mode","accountId");
CREATE OR REPLACE FUNCTION public.billing_customer_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Billing customers are append-only'; END $$;
DROP TRIGGER IF EXISTS billing_customer_immutable ON "BillingCustomer";
CREATE TRIGGER billing_customer_immutable BEFORE UPDATE OR DELETE ON "BillingCustomer" FOR EACH ROW EXECUTE FUNCTION public.billing_customer_immutable();

-- Tenant isolation, same contract as the other billing tables (023): writes need the billing lock's flag.
ALTER TABLE "BillingCustomer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingCustomer" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "BillingCustomer" FROM PUBLIC;
DROP POLICY IF EXISTS billing_read ON "BillingCustomer";
CREATE POLICY billing_read ON "BillingCustomer" FOR SELECT USING ("salonId"=current_setting('app.current_salon',true) OR public.hq_is_admin());
DROP POLICY IF EXISTS billing_insert ON "BillingCustomer";
CREATE POLICY billing_insert ON "BillingCustomer" FOR INSERT WITH CHECK ("salonId"=current_setting('app.current_salon',true) AND current_setting('app.billing_write',true)='enabled');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "BillingCustomer" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "BillingCustomer" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
  REVOKE ALL ON "BillingCustomer" FROM app_runtime;
  GRANT SELECT,INSERT ON "BillingCustomer" TO app_runtime;
 END IF;
END $$;
COMMIT;
