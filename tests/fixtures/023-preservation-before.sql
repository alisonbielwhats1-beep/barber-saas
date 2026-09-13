CREATE TABLE receipts023_preservation AS
SELECT 'Payment' AS entity,id,to_jsonb(p)-'recordedAt'-'extraServices'-'surchargeCents'-'adjustmentReason' AS snapshot FROM "Payment" p
UNION ALL SELECT 'AppointmentService',"appointmentId"||':'||position::text,to_jsonb(s) FROM "AppointmentService" s
UNION ALL SELECT 'FlexibleWaitlist',id,to_jsonb(w)-'serviceIds' FROM "FlexibleWaitlist" w;
