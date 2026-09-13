-- Read-only recovery inventory. Pause new requests, retain processing and history.
-- Do not disable the change processor while confirmed changes exist.
SELECT "state","kind",count(*) FROM "BillingPlanChange" GROUP BY "state","kind";
SELECT "id","subscriptionId","replacementSubscriptionId","state","paidAt","providerSyncedAt" FROM "BillingPlanChange"
 WHERE "confirmedAt" IS NOT NULL AND "state" NOT IN ('CANCELLED','EXPIRED','APPLIED');
