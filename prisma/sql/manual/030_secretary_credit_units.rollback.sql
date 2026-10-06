-- Rollback of 030 (back to 029's fixed requests). Refused once any usage row carries free allowance or any P80 purchase exists:
-- that history only makes sense in credit units. To stop selling, set SALON_SECRETARY_CREDITS_ENABLED=false instead.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:030_secretary_credit_units',0));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM "SecretaryCreditLedger" WHERE "kind"='USAGE') OR EXISTS(SELECT 1 FROM "SecretaryCreditPurchase" WHERE "packCode"='P80') THEN
  RAISE EXCEPTION 'Credit history in units exists: keep 030, turn the flag off instead';
 END IF;
END $$;
DROP INDEX IF EXISTS "SecretaryCreditLedger_usage_free_idx";
ALTER TABLE "SecretaryCreditLedger" DROP CONSTRAINT IF EXISTS "SecretaryCreditLedger_units_check";
ALTER TABLE "SecretaryCreditLedger" DROP COLUMN IF EXISTS "freeUnits";
ALTER TABLE "SecretaryCreditLedger" RENAME COLUMN "units" TO "requests";
ALTER TABLE "SecretaryCreditLedger" ADD CONSTRAINT "SecretaryCreditLedger_check" CHECK (("kind" IN ('PURCHASE','GRANT') AND "requests" > 0) OR ("kind" = 'REVERSAL' AND "requests" < 0) OR ("kind" = 'USAGE' AND "requests" = -1));
ALTER TABLE "SecretaryCreditPurchase" DROP CONSTRAINT IF EXISTS "SecretaryCreditPurchase_units_check";
ALTER TABLE "SecretaryCreditPurchase" RENAME COLUMN "units" TO "requests";
ALTER TABLE "SecretaryCreditPurchase" ADD CONSTRAINT "SecretaryCreditPurchase_requests_check" CHECK ("requests" > 0);
ALTER TABLE "SecretaryCreditPurchase" DROP CONSTRAINT IF EXISTS "SecretaryCreditPurchase_packCode_check";
ALTER TABLE "SecretaryCreditPurchase" ADD CONSTRAINT "SecretaryCreditPurchase_packCode_check" CHECK ("packCode" IN ('P15','P25','P40'));
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
COMMIT;
