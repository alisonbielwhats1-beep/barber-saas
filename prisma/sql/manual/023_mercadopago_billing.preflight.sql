-- Read only. Run only after identifying the target and arranging backup/restore.
DO $$ BEGIN
 IF to_regclass('public."Salon"') IS NULL OR to_regprocedure('public.hq_is_admin()') IS NULL THEN
  RAISE EXCEPTION 'Missing predecessor Salon/HQ 020';
 END IF;
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN
  ('BillingSubscription','BillingCharge','BillingEvent','BillingInbox','BillingQueue')) NOT IN (0,5) THEN
  RAISE EXCEPTION 'Partial billing schema: compare objects before continuing';
 END IF;
END $$;
SELECT current_database(), current_user, count(*) AS salons_preserved FROM "Salon";
