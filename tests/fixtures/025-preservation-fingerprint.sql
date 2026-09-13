SELECT 'subscriptions',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "BillingSubscription" t
UNION ALL SELECT 'charges',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "BillingCharge" t
UNION ALL SELECT 'events',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "BillingEvent" t
UNION ALL SELECT 'hq_subscriptions',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM hq_subscriptions t
UNION ALL SELECT 'hq_payments',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM hq_payments t
ORDER BY 1;
