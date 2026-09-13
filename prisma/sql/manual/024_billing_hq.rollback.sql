-- Operational rollback: disable MERCADOPAGO_HQ_SYNC_ENABLED, retain webhook/worker.
-- Deploy prior application only after arranging financial reconciliation.
-- Never drop the source links, payments or history. Read-only recovery inventory:
SELECT provider,status,count(*) FROM hq_subscriptions WHERE "billingSubscriptionId" IS NOT NULL GROUP BY provider,status;
