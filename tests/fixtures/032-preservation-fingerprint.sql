SELECT 'subscriptions',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "BillingSubscription" t
UNION ALL SELECT 'charges',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "BillingCharge" t
UNION ALL SELECT 'events',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "BillingEvent" t
UNION ALL SELECT 'hq_subscriptions',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM hq_subscriptions t
UNION ALL SELECT 'hq_payments',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM hq_payments t


UNION ALL SELECT 'Salon',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "Salon" t
UNION ALL SELECT 'ClientProfile',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "ClientProfile" t
UNION ALL SELECT 'Professional',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "Professional" t
UNION ALL SELECT 'Service',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "Service" t
UNION ALL SELECT 'Appointment',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM "Appointment" t
ORDER BY 1;
