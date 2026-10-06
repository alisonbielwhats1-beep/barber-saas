-- Read-only checks after 030_secretary_credit_units.sql.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryCreditLedger' AND column_name='units') THEN RAISE EXCEPTION 'ledger.units missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryCreditLedger' AND column_name='freeUnits') THEN RAISE EXCEPTION 'ledger.freeUnits missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryCreditPurchase' AND column_name='units') THEN RAISE EXCEPTION 'purchase.units missing'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('SecretaryCreditLedger','SecretaryCreditPurchase') AND column_name='requests') THEN RAISE EXCEPTION 'requests still present'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='SecretaryCreditLedger_units_check') THEN RAISE EXCEPTION 'units check missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conname='SecretaryCreditLedger_check') THEN RAISE EXCEPTION 'old request check still present'; END IF;
 IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='SecretaryCreditPurchase_packCode_check')) NOT LIKE '%P80%' THEN RAISE EXCEPTION 'P80 pack missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public."SecretaryCreditLedger"'::regclass AND tgname='secretary_credit_ledger_immutable') THEN RAISE EXCEPTION 'append-only guard missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public."SecretaryCreditLedger"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'ledger FORCE RLS missing'; END IF;
END $$;
SELECT 'VERIFY_OK' AS result;
