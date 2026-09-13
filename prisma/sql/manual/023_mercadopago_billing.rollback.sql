-- Recovery: stop new contracts, preserve webhook processing until remote renewals
-- have been explicitly reconciled/cancelled. Deploy the prior application only
-- after arranging manual billing coverage. Never drop invoices or paid history.
-- This read-only inventory changes nothing and is safe to rehearse in CI.
SELECT "providerStatus", count(*) AS contracts, count("paidThrough") AS paid_contracts
FROM "BillingSubscription" GROUP BY "providerStatus";
