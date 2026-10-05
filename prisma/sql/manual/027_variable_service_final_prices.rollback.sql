-- Non-destructive rollback: revert the application and retain final prices.
-- Removing columns would erase accepted service prices and understate reports.
BEGIN TRANSACTION READ ONLY;
SELECT count(*) AS finalized_services FROM public."AppointmentService"
WHERE "finalPriceCents" IS NOT NULL;
COMMIT;
