-- 033 only adds "provider" (default 'mercadopago'): every other value of the billing and credit history must stay identical.
SELECT 'subscriptions',count(*),md5(coalesce(string_agg((row_to_json(t)::jsonb - 'provider')::text,'|' ORDER BY id),'')) FROM "BillingSubscription" t
UNION ALL SELECT 'charges',count(*),md5(coalesce(string_agg(row_to_json(t)::jsonb::text,'|' ORDER BY id),'')) FROM "BillingCharge" t
UNION ALL SELECT 'events',count(*),md5(coalesce(string_agg(row_to_json(t)::jsonb::text,'|' ORDER BY id),'')) FROM "BillingEvent" t
UNION ALL SELECT 'credit_purchases',count(*),md5(coalesce(string_agg((row_to_json(t)::jsonb - 'provider')::text,'|' ORDER BY id),'')) FROM "SecretaryCreditPurchase" t
UNION ALL SELECT 'credit_ledger',count(*),md5(coalesce(string_agg(row_to_json(t)::jsonb::text,'|' ORDER BY id),'')) FROM "SecretaryCreditLedger" t
ORDER BY 1;
