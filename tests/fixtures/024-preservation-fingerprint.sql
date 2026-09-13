-- Ignore only the newly added nullable columns; all existing values must match.
SELECT format(
 'SELECT %L, count(*), md5(coalesce(string_agg(md5((to_jsonb(t) - ARRAY[''billingSalonId'',''billingSubscriptionId'',''billingState'',''billingPaidThrough'',''billingAgendaLimit'',''billingChargeId'',''billingUpdatedAt'',''billingStatus'',''billingEventId'',''nextPaymentAt'',''refundedCents'',''billingRefundedCents''])::text), '''' ORDER BY md5((to_jsonb(t) - ARRAY[''billingSalonId'',''billingSubscriptionId'',''billingState'',''billingPaidThrough'',''billingAgendaLimit'',''billingChargeId'',''billingUpdatedAt'',''billingStatus'',''billingEventId'',''nextPaymentAt'',''refundedCents'',''billingRefundedCents''])::text)), '''')) FROM public.%I t;',
 tablename, tablename
)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename
\gexec
