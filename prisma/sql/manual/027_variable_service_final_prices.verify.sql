BEGIN TRANSACTION READ ONLY;
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'AppointmentService'
  AND column_name IN ('finalPriceCents', 'finalPriceReason') ORDER BY column_name;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public."AppointmentService"'::regclass
  AND conname = 'AppointmentService_final_price_check';
SELECT relrowsecurity, relforcerowsecurity FROM pg_class
WHERE oid = 'public."AppointmentService"'::regclass;
SELECT count(*) AS service_snapshots,
       count(*) FILTER (WHERE "finalPriceCents" IS NOT NULL) AS finalized_services
FROM public."AppointmentService";
COMMIT;
