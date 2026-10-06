-- Rollback of 029_secretary_credits.sql. Purchases and the ledger are financial history: this refuses to drop them once any
-- row exists. To stop selling, set SALON_SECRETARY_CREDITS_ENABLED=false (the history stays).
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:029_secretary_credits',0));
DO $$ BEGIN
 IF to_regclass('public."SecretaryCreditLedger"') IS NOT NULL AND EXISTS(SELECT 1 FROM "SecretaryCreditLedger") THEN
  RAISE EXCEPTION 'Secretary credit ledger has rows: keep the history, turn the flag off instead';
 END IF;
 IF to_regclass('public."SecretaryCreditPurchase"') IS NOT NULL AND EXISTS(SELECT 1 FROM "SecretaryCreditPurchase") THEN
  RAISE EXCEPTION 'Secretary credit purchases exist: keep the history, turn the flag off instead';
 END IF;
END $$;
DROP TABLE IF EXISTS "SecretaryCreditLedger";
DROP TABLE IF EXISTS "SecretaryCreditPurchase";
DROP FUNCTION IF EXISTS public.secretary_credit_ledger_immutable();
DROP FUNCTION IF EXISTS public.secretary_credit_purchase_preserve_quote();
COMMIT;
