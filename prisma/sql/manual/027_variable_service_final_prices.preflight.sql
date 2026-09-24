BEGIN TRANSACTION READ ONLY;
SELECT current_database(), current_user, inet_server_addr(), inet_server_port();
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'AppointmentService'
  AND column_name IN ('priceCents', 'priceType', 'priceNote', 'finalPriceCents', 'finalPriceReason')
ORDER BY column_name;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public."AppointmentService"'::regclass
  AND conname IN ('AppointmentService_price_terms_check', 'AppointmentService_final_price_check');
SELECT relrowsecurity, relforcerowsecurity FROM pg_class
WHERE oid = 'public."AppointmentService"'::regclass;
SELECT count(*) AS service_snapshots FROM public."AppointmentService";
COMMIT;
