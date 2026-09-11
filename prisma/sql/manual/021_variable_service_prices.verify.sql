BEGIN TRANSACTION READ ONLY;
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name IN ('Service', 'AppointmentService') AND column_name IN ('priceType', 'priceNote')) <> 4
    THEN RAISE EXCEPTION '021: expected four price columns'; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('Service_price_terms_check', 'AppointmentService_price_terms_check') AND convalidated) <> 2
    THEN RAISE EXCEPTION '021: missing validated price constraints'; END IF;
  IF EXISTS (SELECT 1 FROM public."Service" WHERE "priceType" NOT IN ('FIXED','FROM'))
    OR EXISTS (SELECT 1 FROM public."AppointmentService" WHERE "priceType" NOT IN ('FIXED','FROM'))
    THEN RAISE EXCEPTION '021: invalid price type'; END IF;
END $$;
COMMIT;
