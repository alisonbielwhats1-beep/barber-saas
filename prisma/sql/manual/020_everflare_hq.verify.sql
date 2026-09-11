DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['hq_accounts','hq_leads','hq_customers','hq_opportunities','hq_subscriptions','hq_payments','hq_activities','hq_followups','hq_support_tickets','hq_bugs','hq_feature_requests','hq_bug_customers','hq_feature_request_customers','hq_feedbacks'] LOOP
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'RLS incompleta: %',t; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND cmd IN ('ALL','DELETE')) THEN RAISE EXCEPTION 'Policy destrutiva: %',t; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hq_activities' AND cmd='UPDATE') THEN RAISE EXCEPTION 'Timeline mutável'; END IF;
END $$;

