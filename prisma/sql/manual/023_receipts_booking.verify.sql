DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='"WaitlistOffer"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'RLS ausente'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='WaitlistOffer' AND policyname='offer_tenant') THEN RAISE EXCEPTION 'Policy ausente'; END IF;
 IF to_regclass('public."AppointmentService_appointmentId_serviceId_key"') IS NOT NULL THEN RAISE EXCEPTION 'Unicidade antiga ainda ativa'; END IF;
 IF EXISTS(SELECT 1 FROM "Payment" WHERE "recordedAt" IS NULL OR "surchargeCents"<0 OR jsonb_typeof("extraServices")<>'array') THEN RAISE EXCEPTION 'Pagamento inválido'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgname='booking_offer_guard' AND NOT tgisinternal)<>3 THEN RAISE EXCEPTION 'Guardas incompletas'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_name='WaitlistOffer' AND grantee IN ('PUBLIC','anon','authenticated')) THEN RAISE EXCEPTION 'Grant público indevido'; END IF;
END $$;
SELECT count(*) AS payments,coalesce(sum("amountCents"),0) AS received_cents FROM "Payment";
