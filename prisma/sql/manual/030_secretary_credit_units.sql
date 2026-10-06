-- Owner decisions 06/10/2026 (after 029): the Secretária sells CREDIT, not a fixed number of requests. Each request takes its
-- real cost x 10 in units of R$ 0,0001; a monthly free allowance is spent first (recorded per usage row as "freeUnits"); a
-- fourth pack (R$ 80). Structural only: renames "requests" to "units" and widens the checks. The rows written before (the
-- pilot's courtesy) keep their numbers, now read as units. Run 030 preflight first.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:030_secretary_credit_units',0));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryCreditLedger' AND column_name='requests') THEN
  ALTER TABLE "SecretaryCreditLedger" RENAME COLUMN "requests" TO "units";
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryCreditPurchase' AND column_name='requests') THEN
  ALTER TABLE "SecretaryCreditPurchase" RENAME COLUMN "requests" TO "units";
 END IF;
END $$;
ALTER TABLE "SecretaryCreditLedger" ADD COLUMN IF NOT EXISTS "freeUnits" INTEGER NOT NULL DEFAULT 0;

-- Credits add; a reversal takes away; a usage takes paid credit (units <= 0) and/or free allowance (freeUnits > 0).
ALTER TABLE "SecretaryCreditLedger" DROP CONSTRAINT IF EXISTS "SecretaryCreditLedger_check";
ALTER TABLE "SecretaryCreditLedger" DROP CONSTRAINT IF EXISTS "SecretaryCreditLedger_units_check";
ALTER TABLE "SecretaryCreditLedger" ADD CONSTRAINT "SecretaryCreditLedger_units_check" CHECK (
  "freeUnits" >= 0 AND (
   ("kind" IN ('PURCHASE','GRANT') AND "units" > 0 AND "freeUnits" = 0)
   OR ("kind" = 'REVERSAL' AND "units" < 0 AND "freeUnits" = 0)
   OR ("kind" = 'USAGE' AND "units" <= 0 AND ("units" < 0 OR "freeUnits" > 0))));

ALTER TABLE "SecretaryCreditPurchase" DROP CONSTRAINT IF EXISTS "SecretaryCreditPurchase_packCode_check";
ALTER TABLE "SecretaryCreditPurchase" ADD CONSTRAINT "SecretaryCreditPurchase_packCode_check" CHECK ("packCode" IN ('P15','P25','P40','P80'));
ALTER TABLE "SecretaryCreditPurchase" DROP CONSTRAINT IF EXISTS "SecretaryCreditPurchase_requests_check";
ALTER TABLE "SecretaryCreditPurchase" DROP CONSTRAINT IF EXISTS "SecretaryCreditPurchase_units_check";
ALTER TABLE "SecretaryCreditPurchase" ADD CONSTRAINT "SecretaryCreditPurchase_units_check" CHECK ("units" > 0);

-- The month's free allowance is summed per salon and month.
CREATE INDEX IF NOT EXISTS "SecretaryCreditLedger_usage_free_idx" ON "SecretaryCreditLedger"("salonId","createdAt") WHERE "kind" = 'USAGE' AND "freeUnits" > 0;

-- The quote guard follows the renamed column.
CREATE OR REPLACE FUNCTION public.secretary_credit_purchase_preserve_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Secretary credit purchases cannot be deleted'; END IF;
 IF ROW(OLD."salonId",OLD."requestKey",OLD."actorUserId",OLD."packCode",OLD."amountCents",OLD."units",OLD."expiresAt",OLD."createdAt")
 IS DISTINCT FROM ROW(NEW."salonId",NEW."requestKey",NEW."actorUserId",NEW."packCode",NEW."amountCents",NEW."units",NEW."expiresAt",NEW."createdAt") THEN
  RAISE EXCEPTION 'Secretary credit purchase quote is immutable';
 END IF;
 RETURN NEW;
END $$;
COMMIT;
