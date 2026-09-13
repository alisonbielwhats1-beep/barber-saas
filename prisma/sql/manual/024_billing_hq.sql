-- Additive Mercado Pago projection. Apply only after 020 and 023, backup and authorization.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
SELECT pg_advisory_xact_lock(hashtextextended('migration:024',0));
ALTER TABLE "BillingSubscription" ADD COLUMN IF NOT EXISTS "nextPaymentAt" timestamptz(3);
ALTER TABLE "BillingCharge" ADD COLUMN IF NOT EXISTS "refundedCents" integer NOT NULL DEFAULT 0;
ALTER TABLE hq_accounts ADD COLUMN IF NOT EXISTS "billingSalonId" text;
ALTER TABLE hq_subscriptions ADD COLUMN IF NOT EXISTS "billingSubscriptionId" uuid,
 ADD COLUMN IF NOT EXISTS "billingState" text, ADD COLUMN IF NOT EXISTS "billingPaidThrough" timestamptz(3), ADD COLUMN IF NOT EXISTS "billingAgendaLimit" integer;
ALTER TABLE hq_payments ADD COLUMN IF NOT EXISTS "billingChargeId" uuid,
 ADD COLUMN IF NOT EXISTS "billingUpdatedAt" timestamptz(3), ADD COLUMN IF NOT EXISTS "billingStatus" text;
ALTER TABLE hq_activities ADD COLUMN IF NOT EXISTS "billingEventId" uuid;
ALTER TABLE hq_payments ADD COLUMN IF NOT EXISTS "billingRefundedCents" integer;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='billing_refund_valid') THEN
  ALTER TABLE "BillingCharge" ADD CONSTRAINT billing_refund_valid CHECK ("refundedCents">=0 AND "refundedCents"<="amountCents");
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='hq_billing_refund_valid') THEN
  ALTER TABLE hq_payments ADD CONSTRAINT hq_billing_refund_valid CHECK ("billingRefundedCents">=0 AND "billingRefundedCents"<="amountCents");
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "hq_accounts_billingSalonId_key" ON hq_accounts("billingSalonId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='hq_accounts_billingSalonId_fkey') THEN
 ALTER TABLE hq_accounts ADD CONSTRAINT "hq_accounts_billingSalonId_fkey" FOREIGN KEY ("billingSalonId") REFERENCES "Salon"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
END IF; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "hq_subscriptions_billingSubscriptionId_key" ON hq_subscriptions("billingSubscriptionId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='hq_subscriptions_billingSubscriptionId_fkey') THEN
 ALTER TABLE hq_subscriptions ADD CONSTRAINT "hq_subscriptions_billingSubscriptionId_fkey" FOREIGN KEY ("billingSubscriptionId") REFERENCES "BillingSubscription"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
END IF; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "hq_payments_billingChargeId_key" ON hq_payments("billingChargeId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='hq_payments_billingChargeId_fkey') THEN
 ALTER TABLE hq_payments ADD CONSTRAINT "hq_payments_billingChargeId_fkey" FOREIGN KEY ("billingChargeId") REFERENCES "BillingCharge"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
END IF; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "hq_activities_billingEventId_key" ON hq_activities("billingEventId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='hq_activities_billingEventId_fkey') THEN
 ALTER TABLE hq_activities ADD CONSTRAINT "hq_activities_billingEventId_fkey" FOREIGN KEY ("billingEventId") REFERENCES "BillingEvent"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
END IF; END $$;
-- Manual charges retain one reference per contract. Provider charges use immutable invoice IDs.
CREATE INDEX IF NOT EXISTS "hq_payments_subscriptionId_reference_idx" ON hq_payments("subscriptionId",reference);
CREATE UNIQUE INDEX IF NOT EXISTS "hq_payments_manual_reference_key" ON hq_payments("subscriptionId",reference) WHERE "billingChargeId" IS NULL;
ALTER TABLE hq_payments DROP CONSTRAINT IF EXISTS "hq_payments_subscriptionId_reference_key";
DROP INDEX IF EXISTS "hq_payments_subscriptionId_reference_key";
DROP POLICY IF EXISTS billing_hq_select ON hq_accounts;
CREATE POLICY billing_hq_select ON hq_accounts FOR SELECT USING ((current_setting('app.billing_hq_sync',true)='enabled' AND ("billingSalonId" = current_setting('app.current_salon',true))));
DROP POLICY IF EXISTS billing_hq_insert ON hq_accounts;
CREATE POLICY billing_hq_insert ON hq_accounts FOR INSERT WITH CHECK ((current_setting('app.billing_hq_sync',true)='enabled' AND ("billingSalonId" = current_setting('app.current_salon',true))));
DROP POLICY IF EXISTS billing_hq_update ON hq_accounts;
CREATE POLICY billing_hq_update ON hq_accounts FOR UPDATE USING ((current_setting('app.billing_hq_sync',true)='enabled' AND ("billingSalonId" = current_setting('app.current_salon',true)))) WITH CHECK ((current_setting('app.billing_hq_sync',true)='enabled' AND ("billingSalonId" = current_setting('app.current_salon',true))));
DROP POLICY IF EXISTS billing_hq_select ON hq_customers;
CREATE POLICY billing_hq_select ON hq_customers FOR SELECT USING ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_accounts a WHERE a.id="accountId" AND a."billingSalonId"=current_setting('app.current_salon',true)))));
DROP POLICY IF EXISTS billing_hq_insert ON hq_customers;
CREATE POLICY billing_hq_insert ON hq_customers FOR INSERT WITH CHECK ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_accounts a WHERE a.id="accountId" AND a."billingSalonId"=current_setting('app.current_salon',true)))));
DROP POLICY IF EXISTS billing_hq_update ON hq_customers;
CREATE POLICY billing_hq_update ON hq_customers FOR UPDATE USING ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_accounts a WHERE a.id="accountId" AND a."billingSalonId"=current_setting('app.current_salon',true))))) WITH CHECK ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_accounts a WHERE a.id="accountId" AND a."billingSalonId"=current_setting('app.current_salon',true)))));
DROP POLICY IF EXISTS billing_hq_select ON hq_subscriptions;
CREATE POLICY billing_hq_select ON hq_subscriptions FOR SELECT USING ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_customers c JOIN hq_accounts a ON a.id=c."accountId" JOIN "BillingSubscription" b ON b."salonId"=a."billingSalonId" WHERE c.id="customerId" AND b.id="billingSubscriptionId" AND a."billingSalonId"=current_setting('app.current_salon',true)))));
DROP POLICY IF EXISTS billing_hq_insert ON hq_subscriptions;
CREATE POLICY billing_hq_insert ON hq_subscriptions FOR INSERT WITH CHECK ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_customers c JOIN hq_accounts a ON a.id=c."accountId" JOIN "BillingSubscription" b ON b."salonId"=a."billingSalonId" WHERE c.id="customerId" AND b.id="billingSubscriptionId" AND a."billingSalonId"=current_setting('app.current_salon',true)))));
DROP POLICY IF EXISTS billing_hq_update ON hq_subscriptions;
CREATE POLICY billing_hq_update ON hq_subscriptions FOR UPDATE USING ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_customers c JOIN hq_accounts a ON a.id=c."accountId" JOIN "BillingSubscription" b ON b."salonId"=a."billingSalonId" WHERE c.id="customerId" AND b.id="billingSubscriptionId" AND a."billingSalonId"=current_setting('app.current_salon',true))))) WITH CHECK ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_customers c JOIN hq_accounts a ON a.id=c."accountId" JOIN "BillingSubscription" b ON b."salonId"=a."billingSalonId" WHERE c.id="customerId" AND b.id="billingSubscriptionId" AND a."billingSalonId"=current_setting('app.current_salon',true)))));
DROP POLICY IF EXISTS billing_hq_select ON hq_payments;
CREATE POLICY billing_hq_select ON hq_payments FOR SELECT USING ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_subscriptions s JOIN "BillingCharge" b ON b."subscriptionId"=s."billingSubscriptionId" WHERE s.id=hq_payments."subscriptionId" AND b.id="billingChargeId" AND b."salonId"=current_setting('app.current_salon',true)))));
DROP POLICY IF EXISTS billing_hq_insert ON hq_payments;
CREATE POLICY billing_hq_insert ON hq_payments FOR INSERT WITH CHECK ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_subscriptions s JOIN "BillingCharge" b ON b."subscriptionId"=s."billingSubscriptionId" WHERE s.id=hq_payments."subscriptionId" AND b.id="billingChargeId" AND b."salonId"=current_setting('app.current_salon',true)))));
DROP POLICY IF EXISTS billing_hq_update ON hq_payments;
CREATE POLICY billing_hq_update ON hq_payments FOR UPDATE USING ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_subscriptions s JOIN "BillingCharge" b ON b."subscriptionId"=s."billingSubscriptionId" WHERE s.id=hq_payments."subscriptionId" AND b.id="billingChargeId" AND b."salonId"=current_setting('app.current_salon',true))))) WITH CHECK ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_subscriptions s JOIN "BillingCharge" b ON b."subscriptionId"=s."billingSubscriptionId" WHERE s.id=hq_payments."subscriptionId" AND b.id="billingChargeId" AND b."salonId"=current_setting('app.current_salon',true)))));
DROP POLICY IF EXISTS billing_hq_select ON hq_activities;
CREATE POLICY billing_hq_select ON hq_activities FOR SELECT USING ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_accounts a WHERE a.id="accountId" AND a."billingSalonId"=current_setting('app.current_salon',true)) AND ("billingEventId" IS NULL OR EXISTS(SELECT 1 FROM "BillingEvent" e WHERE e.id="billingEventId" AND e."salonId"=current_setting('app.current_salon',true))))));
DROP POLICY IF EXISTS billing_hq_insert ON hq_activities;
CREATE POLICY billing_hq_insert ON hq_activities FOR INSERT WITH CHECK ((current_setting('app.billing_hq_sync',true)='enabled' AND (EXISTS(SELECT 1 FROM hq_accounts a WHERE a.id="accountId" AND a."billingSalonId"=current_setting('app.current_salon',true)) AND ("billingEventId" IS NULL OR EXISTS(SELECT 1 FROM "BillingEvent" e WHERE e.id="billingEventId" AND e."salonId"=current_setting('app.current_salon',true))))));
COMMIT;
