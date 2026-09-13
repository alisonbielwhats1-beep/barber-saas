SELECT current_database(), current_user, inet_server_addr(), inet_server_port();
DO $$ BEGIN
 IF to_regclass('public."Payment"') IS NULL OR to_regclass('public."FlexibleWaitlist"') IS NULL OR to_regprocedure('public.app_current_salon()') IS NULL THEN RAISE EXCEPTION 'Predecessor incompleto'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Runtime privilegiado'; END IF;
END $$;
SELECT count(*) AS payments,coalesce(sum("amountCents"),0) AS received_cents FROM "Payment";
SELECT count(*) AS service_items FROM "AppointmentService";
