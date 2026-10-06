-- Read-only. 029 must be applied; 030 renames "requests" to "units" (idempotent: a re-run finds "units" already there).
SELECT current_database(),current_user,inet_server_addr(),inet_server_port();
DO $$ BEGIN
 IF to_regclass('public."SecretaryCreditLedger"') IS NULL OR to_regclass('public."SecretaryCreditPurchase"') IS NULL THEN RAISE EXCEPTION '029 missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe runtime role'; END IF;
END $$;
SELECT (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='SecretaryCreditLedger' AND column_name IN ('requests','units','freeUnits')) AS ledger_columns,
 (SELECT count(*) FROM "SecretaryCreditLedger") AS ledger_rows, (SELECT count(*) FROM "SecretaryCreditPurchase") AS purchases;
