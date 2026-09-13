-- Populated predecessor: never run against production.
DO $$ BEGIN
 IF current_database() <> 'salon_schema_ci' THEN RAISE EXCEPTION 'Synthetic CI database required'; END IF;
END $$;
INSERT INTO "Salon" (id,name,slug,"updatedAt") VALUES ('ci-preserve025','Synthetic billing preservation','ci-preserve025',CURRENT_TIMESTAMP);
INSERT INTO "BillingSubscription" (id,"salonId","requestKey",fingerprint,"catalogVersion","planCode",cycle,"amountCents","agendaLimit","intervalMonths",mode,"collectorId","payerEmail","legacyPlan","providerId","providerStatus","paidThrough","updatedAt")
VALUES ('25000000-0000-4000-8000-000000000001','ci-preserve025','ci-before025','synthetic','2026-09-13','TEAM_PLUS','MONTHLY',9990,5,1,'test','123','preserve025@example.test','FREE','ci-provider025','authorized','2026-10-13T00:00:00Z',CURRENT_TIMESTAMP);
INSERT INTO "BillingCharge" (id,"salonId","subscriptionId","providerInvoiceId","providerPaymentId","amountCents","periodStart","periodEnd",status,"paidAt","providerUpdatedAt")
VALUES ('25000000-0000-4000-8000-000000000002','ci-preserve025','25000000-0000-4000-8000-000000000001','ci-invoice025','ci-payment025',9990,'2026-09-13T00:00:00Z','2026-10-13T00:00:00Z','approved','2026-09-13T00:00:00Z',CURRENT_TIMESTAMP);
INSERT INTO "BillingEvent" (id,"salonId","subscriptionId",key,type,detail)
VALUES ('25000000-0000-4000-8000-000000000003','ci-preserve025','25000000-0000-4000-8000-000000000001','ci-event025','PAYMENT_UPDATED','Synthetic predecessor retained');
