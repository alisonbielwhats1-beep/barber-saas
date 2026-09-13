DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['BillingSubscription','BillingCharge','BillingEvent','BillingInbox','BillingQueue'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname=t AND relnamespace='public'::regnamespace AND relrowsecurity AND relforcerowsecurity) THEN
   RAISE EXCEPTION 'Missing FORCE RLS on %',t;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_table_privilege('anon',format('%I',t),'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected anon grant'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') AND has_table_privilege('authenticated',format('%I',t),'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected authenticated grant'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='BillingSubscription_one_current') THEN RAISE EXCEPTION 'Missing current contract constraint'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('BillingSubscription_salonId_fkey','BillingCharge_salonId_subscriptionId_fkey','BillingEvent_salonId_subscriptionId_fkey','BillingInbox_salonId_subscriptionId_fkey','BillingQueue_salonId_subscriptionId_fkey')) <> 5 THEN RAISE EXCEPTION 'Missing tenant foreign keys'; END IF;
END $$;
