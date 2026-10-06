-- Additive. Run the companion preflight first, on the identified destination.
-- Owner decision 06/10/2026: the Secretária's prepaid requests (pedidos), bought in packs through Mercado Pago (Pix or card).
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:029_secretary_credits',0));

CREATE TABLE IF NOT EXISTS "SecretaryCreditLedger" (
  "id" UUID PRIMARY KEY,
  "seq" BIGSERIAL NOT NULL UNIQUE,
  "salonId" TEXT NOT NULL REFERENCES "Salon"("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('PURCHASE','GRANT','USAGE','REVERSAL')),
  "requests" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "baseAfter" INTEGER NOT NULL CHECK ("baseAfter" >= 0),
  "requestKey" TEXT NOT NULL CHECK (char_length("requestKey") BETWEEN 1 AND 200),
  "purchaseId" UUID,
  "providerPaymentId" TEXT,
  "actorUserId" TEXT,
  "reason" TEXT CHECK ("reason" IS NULL OR char_length("reason") <= 200),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Credits add, debits take away; a request is debited one at a time.
  CHECK (("kind" IN ('PURCHASE','GRANT') AND "requests" > 0) OR ("kind" = 'REVERSAL' AND "requests" < 0) OR ("kind" = 'USAGE' AND "requests" = -1)),
  CHECK ("kind" NOT IN ('PURCHASE','REVERSAL') OR ("purchaseId" IS NOT NULL AND "providerPaymentId" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "SecretaryCreditLedger_salonId_requestKey_key" ON "SecretaryCreditLedger"("salonId","requestKey");
CREATE INDEX IF NOT EXISTS "SecretaryCreditLedger_salonId_seq_idx" ON "SecretaryCreditLedger"("salonId","seq");
CREATE INDEX IF NOT EXISTS "SecretaryCreditLedger_salonId_kind_createdAt_idx" ON "SecretaryCreditLedger"("salonId","kind","createdAt");
-- One purchase credit per payment.
CREATE UNIQUE INDEX IF NOT EXISTS "SecretaryCreditLedger_one_purchase_per_payment" ON "SecretaryCreditLedger"("providerPaymentId") WHERE "kind" = 'PURCHASE';

CREATE TABLE IF NOT EXISTS "SecretaryCreditPurchase" (
  "id" UUID PRIMARY KEY,
  "salonId" TEXT NOT NULL REFERENCES "Salon"("id") ON DELETE RESTRICT,
  "requestKey" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "packCode" TEXT NOT NULL CHECK ("packCode" IN ('P15','P25','P40')),
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
  "requests" INTEGER NOT NULL CHECK ("requests" > 0),
  "state" TEXT NOT NULL DEFAULT 'CREATED' CHECK ("state" IN ('CREATED','AWAITING_PAYMENT','PAID','EXPIRED','REFUNDED','REVIEW')),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "creationStartedAt" TIMESTAMPTZ(3),
  "preferenceId" TEXT UNIQUE,
  "checkoutUrl" TEXT,
  "providerPaymentId" TEXT UNIQUE,
  "paidAt" TIMESTAMPTZ(3),
  "refundedCents" INTEGER NOT NULL DEFAULT 0 CHECK ("refundedCents" >= 0 AND "refundedCents" <= "amountCents"),
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CHECK ("createdAt" < "expiresAt")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SecretaryCreditPurchase_salonId_requestKey_key" ON "SecretaryCreditPurchase"("salonId","requestKey");
CREATE INDEX IF NOT EXISTS "SecretaryCreditPurchase_salonId_createdAt_idx" ON "SecretaryCreditPurchase"("salonId","createdAt");
CREATE INDEX IF NOT EXISTS "SecretaryCreditPurchase_state_createdAt_idx" ON "SecretaryCreditPurchase"("state","createdAt");
ALTER TABLE "SecretaryCreditLedger" DROP CONSTRAINT IF EXISTS "SecretaryCreditLedger_purchase_fkey";
ALTER TABLE "SecretaryCreditLedger" ADD CONSTRAINT "SecretaryCreditLedger_purchase_fkey" FOREIGN KEY ("purchaseId") REFERENCES "SecretaryCreditPurchase"("id") ON DELETE RESTRICT;

-- The ledger is history: never changed, never deleted.
CREATE OR REPLACE FUNCTION public.secretary_credit_ledger_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Secretary credit ledger is append-only'; END $$;
DROP TRIGGER IF EXISTS secretary_credit_ledger_immutable ON "SecretaryCreditLedger";
CREATE TRIGGER secretary_credit_ledger_immutable BEFORE UPDATE OR DELETE ON "SecretaryCreditLedger" FOR EACH ROW EXECUTE FUNCTION public.secretary_credit_ledger_immutable();
-- A purchase's quote never changes, and a purchase is never deleted.
CREATE OR REPLACE FUNCTION public.secretary_credit_purchase_preserve_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Secretary credit purchases cannot be deleted'; END IF;
 IF ROW(OLD."salonId",OLD."requestKey",OLD."actorUserId",OLD."packCode",OLD."amountCents",OLD."requests",OLD."expiresAt",OLD."createdAt")
 IS DISTINCT FROM ROW(NEW."salonId",NEW."requestKey",NEW."actorUserId",NEW."packCode",NEW."amountCents",NEW."requests",NEW."expiresAt",NEW."createdAt") THEN
  RAISE EXCEPTION 'Secretary credit purchase quote is immutable';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS secretary_credit_purchase_preserve_quote ON "SecretaryCreditPurchase";
CREATE TRIGGER secretary_credit_purchase_preserve_quote BEFORE UPDATE OR DELETE ON "SecretaryCreditPurchase" FOR EACH ROW EXECUTE FUNCTION public.secretary_credit_purchase_preserve_quote();

-- Tenant isolation. Writes need the credit lock's flag (src/lib/secretary-credits.ts: creditLock). The billing dispatch scope
-- (scheduled reconciliation) reads only purchases still waiting for payment, and updates only those.
ALTER TABLE "SecretaryCreditLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecretaryCreditLedger" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SecretaryCreditPurchase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecretaryCreditPurchase" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "SecretaryCreditLedger" FROM PUBLIC;
REVOKE ALL ON "SecretaryCreditPurchase" FROM PUBLIC;
DROP POLICY IF EXISTS credit_read ON "SecretaryCreditLedger";
CREATE POLICY credit_read ON "SecretaryCreditLedger" FOR SELECT USING ("salonId"=current_setting('app.current_salon',true) OR public.hq_is_admin());
DROP POLICY IF EXISTS credit_insert ON "SecretaryCreditLedger";
CREATE POLICY credit_insert ON "SecretaryCreditLedger" FOR INSERT WITH CHECK ("salonId"=current_setting('app.current_salon',true) AND current_setting('app.credit_write',true)='enabled');
DROP POLICY IF EXISTS credit_read ON "SecretaryCreditPurchase";
CREATE POLICY credit_read ON "SecretaryCreditPurchase" FOR SELECT USING ("salonId"=current_setting('app.current_salon',true) OR public.hq_is_admin()
 OR (current_setting('app.billing_dispatch',true)='enabled' AND "state"='AWAITING_PAYMENT'));
DROP POLICY IF EXISTS credit_insert ON "SecretaryCreditPurchase";
CREATE POLICY credit_insert ON "SecretaryCreditPurchase" FOR INSERT WITH CHECK ("salonId"=current_setting('app.current_salon',true) AND current_setting('app.credit_write',true)='enabled');
DROP POLICY IF EXISTS credit_update ON "SecretaryCreditPurchase";
CREATE POLICY credit_update ON "SecretaryCreditPurchase" FOR UPDATE USING ("salonId"=current_setting('app.current_salon',true) AND current_setting('app.credit_write',true)='enabled')
 WITH CHECK ("salonId"=current_setting('app.current_salon',true) AND current_setting('app.credit_write',true)='enabled');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "SecretaryCreditLedger","SecretaryCreditPurchase" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "SecretaryCreditLedger","SecretaryCreditPurchase" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
  REVOKE ALL ON "SecretaryCreditLedger","SecretaryCreditPurchase" FROM app_runtime;
  GRANT SELECT,INSERT ON "SecretaryCreditLedger" TO app_runtime;
  GRANT USAGE ON SEQUENCE "SecretaryCreditLedger_seq_seq" TO app_runtime;
  GRANT SELECT,INSERT,UPDATE ON "SecretaryCreditPurchase" TO app_runtime;
 END IF;
END $$;
COMMIT;
