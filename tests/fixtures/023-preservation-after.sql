DO $$ BEGIN
 IF EXISTS(
  WITH after_rows AS (
   SELECT 'Payment' AS entity,id,to_jsonb(p)-'recordedAt'-'extraServices'-'surchargeCents'-'adjustmentReason' AS snapshot FROM "Payment" p
   UNION ALL SELECT 'AppointmentService',"appointmentId"||':'||position::text,to_jsonb(s) FROM "AppointmentService" s
   UNION ALL SELECT 'FlexibleWaitlist',id,to_jsonb(w)-'serviceIds' FROM "FlexibleWaitlist" w
  ) SELECT * FROM receipts023_preservation EXCEPT SELECT * FROM after_rows
 ) THEN RAISE EXCEPTION '023 alterou dados predecessores'; END IF;
 IF EXISTS(SELECT 1 FROM "Payment" WHERE "recordedAt"<>"paidAt" OR "extraServices"<>'[]'::jsonb OR "surchargeCents"<>0) THEN RAISE EXCEPTION 'Backfill de recebimento divergente'; END IF;
END $$;
