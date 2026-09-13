-- Additive. Run the companion preflight first, on the identified destination.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:025_billing_plan_changes',0));
CREATE TABLE IF NOT EXISTS "BillingPlanChange" (
  "id" UUID PRIMARY KEY,
  "salonId" TEXT NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "requestKey" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('UPGRADE','SCHEDULED','CYCLE')),
  "state" TEXT NOT NULL DEFAULT 'QUOTED' CHECK ("state" IN ('QUOTED','PREPARING','AWAITING_PAYMENT','APPLYING','SCHEDULED','APPLIED','CANCEL_REQUESTED','CANCELLED','EXPIRED','REVIEW')),
  "fromTerms" JSONB NOT NULL CHECK (jsonb_typeof("fromTerms")='object'),
  "toTerms" JSONB NOT NULL CHECK (jsonb_typeof("toTerms")='object'),
  "amountDueCents" INTEGER NOT NULL CHECK ("amountDueCents">=0),
  "periodStart" TIMESTAMPTZ(3) NOT NULL,
  "periodEnd" TIMESTAMPTZ(3) NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "quotedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3),
  "creationStartedAt" TIMESTAMPTZ(3),
  "preferenceId" TEXT UNIQUE,
  "checkoutUrl" TEXT,
  "providerPaymentId" TEXT UNIQUE,
  "paidAt" TIMESTAMPTZ(3),
  "activatedAt" TIMESTAMPTZ(3),
  "providerStartedAt" TIMESTAMPTZ(3),
  "providerSyncedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "replacementSubscriptionId" UUID UNIQUE REFERENCES "BillingSubscription"("id") ON DELETE RESTRICT,
  "lastError" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BillingPlanChange_salonId_subscriptionId_fkey" FOREIGN KEY ("salonId","subscriptionId") REFERENCES "BillingSubscription"("salonId","id") ON DELETE RESTRICT,
  CONSTRAINT "BillingPlanChange_replacement_tenant_fkey" FOREIGN KEY ("salonId","replacementSubscriptionId") REFERENCES "BillingSubscription"("salonId","id") ON DELETE RESTRICT,
  CHECK ("periodStart" < "periodEnd" AND "quotedAt" < "expiresAt" AND "expiresAt" <= "periodEnd"),
  CHECK (("kind"='UPGRADE' AND "amountDueCents">0) OR ("kind"<>'UPGRADE' AND "amountDueCents"=0))
);
CREATE UNIQUE INDEX IF NOT EXISTS "BillingPlanChange_salonId_requestKey_key" ON "BillingPlanChange"("salonId","requestKey");
CREATE INDEX IF NOT EXISTS "BillingPlanChange_salonId_subscriptionId_quotedAt_idx" ON "BillingPlanChange"("salonId","subscriptionId","quotedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "BillingPlanChange_one_pending" ON "BillingPlanChange"("salonId")
 WHERE "state" IN ('PREPARING','AWAITING_PAYMENT','APPLYING','SCHEDULED','CANCEL_REQUESTED','REVIEW');

CREATE OR REPLACE FUNCTION public.billing_change_preserve_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Billing change history cannot be deleted'; END IF;
 IF ROW(OLD."salonId",OLD."subscriptionId",OLD."requestKey",OLD."actorUserId",OLD."kind",OLD."fromTerms",OLD."toTerms",OLD."amountDueCents",OLD."periodStart",OLD."periodEnd",OLD."effectiveAt",OLD."quotedAt",OLD."expiresAt")
 IS DISTINCT FROM ROW(NEW."salonId",NEW."subscriptionId",NEW."requestKey",NEW."actorUserId",NEW."kind",NEW."fromTerms",NEW."toTerms",NEW."amountDueCents",NEW."periodStart",NEW."periodEnd",NEW."effectiveAt",NEW."quotedAt",NEW."expiresAt") THEN
  RAISE EXCEPTION 'Billing change quote is immutable';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS billing_change_preserve_quote ON "BillingPlanChange";
CREATE TRIGGER billing_change_preserve_quote BEFORE UPDATE OR DELETE ON "BillingPlanChange" FOR EACH ROW EXECUTE FUNCTION public.billing_change_preserve_quote();
ALTER TABLE "BillingPlanChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingPlanChange" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "BillingPlanChange" FROM PUBLIC;
DROP POLICY IF EXISTS billing_read ON "BillingPlanChange";
CREATE POLICY billing_read ON "BillingPlanChange" FOR SELECT USING ("salonId"=current_setting('app.current_salon',true) OR public.hq_is_admin());
DROP POLICY IF EXISTS billing_insert ON "BillingPlanChange";
CREATE POLICY billing_insert ON "BillingPlanChange" FOR INSERT WITH CHECK ("salonId"=current_setting('app.current_salon',true) AND current_setting('app.billing_write',true)='enabled');
DROP POLICY IF EXISTS billing_update ON "BillingPlanChange";
CREATE POLICY billing_update ON "BillingPlanChange" FOR UPDATE USING ("salonId"=current_setting('app.current_salon',true) AND current_setting('app.billing_write',true)='enabled') WITH CHECK ("salonId"=current_setting('app.current_salon',true) AND current_setting('app.billing_write',true)='enabled');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "BillingPlanChange" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "BillingPlanChange" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
  REVOKE ALL ON "BillingPlanChange" FROM app_runtime;
  GRANT SELECT,INSERT,UPDATE ON "BillingPlanChange" TO app_runtime;
 END IF;
END $$;
COMMIT;
