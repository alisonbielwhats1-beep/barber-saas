-- Read-only checks after 029_secretary_credits.sql.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public."SecretaryCreditLedger"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'Missing ledger FORCE RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public."SecretaryCreditPurchase"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'Missing purchase FORCE RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public."SecretaryCreditLedger"'::regclass AND tgname='secretary_credit_ledger_immutable') THEN RAISE EXCEPTION 'Missing append-only guard'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public."SecretaryCreditPurchase"'::regclass AND tgname='secretary_credit_purchase_preserve_quote') THEN RAISE EXCEPTION 'Missing immutable quote guard'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='SecretaryCreditLedger_one_purchase_per_payment') THEN RAISE EXCEPTION 'Missing one-credit-per-payment index'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='SecretaryCreditLedger_salonId_requestKey_key') THEN RAISE EXCEPTION 'Missing idempotency index'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE tablename='SecretaryCreditLedger') <> 2 THEN RAISE EXCEPTION 'Unexpected ledger policies'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE tablename='SecretaryCreditPurchase') <> 3 THEN RAISE EXCEPTION 'Unexpected purchase policies'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') AND (has_table_privilege('app_runtime','"SecretaryCreditLedger"','UPDATE')
  OR has_table_privilege('app_runtime','"SecretaryCreditLedger"','DELETE') OR has_table_privilege('app_runtime','"SecretaryCreditPurchase"','DELETE')) THEN
  RAISE EXCEPTION 'Runtime may change history';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_table_privilege('anon','"SecretaryCreditLedger"','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected anon grant'; END IF;
END $$;
SELECT 'VERIFY_OK' AS result;
