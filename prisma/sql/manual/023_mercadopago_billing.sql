-- Additive automatic billing; does not apply or depend on manual billing 011.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:023',0));
-- CreateTable
CREATE TABLE IF NOT EXISTS "BillingSubscription" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "catalogVersion" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "agendaLimit" INTEGER NOT NULL,
    "intervalMonths" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "mode" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "payerEmail" TEXT NOT NULL,
    "legacyPlan" "Plan" NOT NULL,
    "providerId" TEXT,
    "providerStatus" TEXT NOT NULL DEFAULT 'pending',
    "providerUpdatedAt" TIMESTAMPTZ(3),
    "checkoutUrl" TEXT,
    "creationStartedAt" TIMESTAMPTZ(3),
    "cancelRequestedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "paidThrough" TIMESTAMPTZ(3),
    "delinquentSince" TIMESTAMPTZ(3),
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMPTZ(3),
    "invoiceOffset" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BillingCharge" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "providerInvoiceId" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "providerUpdatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BillingCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BillingEvent" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BillingInbox" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BillingInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BillingQueue" (
    "subscriptionId" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "BillingQueue_pkey" PRIMARY KEY ("subscriptionId")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BillingSubscription_providerId_key" ON "BillingSubscription"("providerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingSubscription_salonId_current_idx" ON "BillingSubscription"("salonId", "current");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BillingSubscription_salonId_requestKey_key" ON "BillingSubscription"("salonId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BillingSubscription_salonId_id_key" ON "BillingSubscription"("salonId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BillingCharge_providerInvoiceId_key" ON "BillingCharge"("providerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BillingCharge_providerPaymentId_key" ON "BillingCharge"("providerPaymentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingCharge_salonId_subscriptionId_periodStart_idx" ON "BillingCharge"("salonId", "subscriptionId", "periodStart");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingEvent_salonId_createdAt_idx" ON "BillingEvent"("salonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BillingEvent_subscriptionId_key_key" ON "BillingEvent"("subscriptionId", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingInbox_salonId_subscriptionId_processedAt_idx" ON "BillingInbox"("salonId", "subscriptionId", "processedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingQueue_nextAttemptAt_leaseUntil_idx" ON "BillingQueue"("nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BillingQueue_salonId_subscriptionId_key" ON "BillingQueue"("salonId", "subscriptionId");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingSubscription_salonId_fkey') THEN
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingCharge_salonId_subscriptionId_fkey') THEN
ALTER TABLE "BillingCharge" ADD CONSTRAINT "BillingCharge_salonId_subscriptionId_fkey" FOREIGN KEY ("salonId", "subscriptionId") REFERENCES "BillingSubscription"("salonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingEvent_salonId_subscriptionId_fkey') THEN
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_salonId_subscriptionId_fkey" FOREIGN KEY ("salonId", "subscriptionId") REFERENCES "BillingSubscription"("salonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingInbox_salonId_subscriptionId_fkey') THEN
ALTER TABLE "BillingInbox" ADD CONSTRAINT "BillingInbox_salonId_subscriptionId_fkey" FOREIGN KEY ("salonId", "subscriptionId") REFERENCES "BillingSubscription"("salonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingQueue_salonId_subscriptionId_fkey') THEN
ALTER TABLE "BillingQueue" ADD CONSTRAINT "BillingQueue_salonId_subscriptionId_fkey" FOREIGN KEY ("salonId", "subscriptionId") REFERENCES "BillingSubscription"("salonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
END IF; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "BillingSubscription_one_current" ON "BillingSubscription" ("salonId") WHERE current;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='billing_contract_valid') THEN
 ALTER TABLE "BillingSubscription" ADD CONSTRAINT billing_contract_valid CHECK (
  "amountCents">0 AND "agendaLimit">0 AND "agendaLimit"<=110 AND currency='BRL'
  AND mode IN ('test','live') AND "planCode" IN ('INDIVIDUAL','TEAM','TEAM_PLUS','TEAM_MAX')
  AND ((cycle='MONTHLY' AND "intervalMonths"=1) OR (cycle='ANNUAL' AND "intervalMonths"=12))
  AND "invoiceOffset">=0);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='billing_charge_valid') THEN
 ALTER TABLE "BillingCharge" ADD CONSTRAINT billing_charge_valid CHECK ("amountCents">0 AND "periodEnd">"periodStart");
 END IF;
END $$;

ALTER TABLE "BillingSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingSubscription" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "BillingSubscription" FROM PUBLIC;
DROP POLICY IF EXISTS billing_read ON "BillingSubscription";
CREATE POLICY billing_read ON "BillingSubscription" FOR SELECT USING ("salonId" = current_setting('app.current_salon', true) OR public.hq_is_admin());
DROP POLICY IF EXISTS billing_insert ON "BillingSubscription";
CREATE POLICY billing_insert ON "BillingSubscription" FOR INSERT WITH CHECK ("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled');
DROP POLICY IF EXISTS billing_update ON "BillingSubscription";
CREATE POLICY billing_update ON "BillingSubscription" FOR UPDATE USING ("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled') WITH CHECK ("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "BillingSubscription" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "BillingSubscription" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
 REVOKE ALL ON "BillingSubscription" FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON "BillingSubscription" TO app_runtime;
 END IF;
END $$;

ALTER TABLE "BillingCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingCharge" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "BillingCharge" FROM PUBLIC;
DROP POLICY IF EXISTS billing_read ON "BillingCharge";
CREATE POLICY billing_read ON "BillingCharge" FOR SELECT USING ("salonId" = current_setting('app.current_salon', true) OR public.hq_is_admin());
DROP POLICY IF EXISTS billing_insert ON "BillingCharge";
CREATE POLICY billing_insert ON "BillingCharge" FOR INSERT WITH CHECK ("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled');
DROP POLICY IF EXISTS billing_update ON "BillingCharge";
CREATE POLICY billing_update ON "BillingCharge" FOR UPDATE USING ("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled') WITH CHECK ("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "BillingCharge" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "BillingCharge" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
 REVOKE ALL ON "BillingCharge" FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON "BillingCharge" TO app_runtime;
 END IF;
END $$;

ALTER TABLE "BillingEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingEvent" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "BillingEvent" FROM PUBLIC;
DROP POLICY IF EXISTS billing_read ON "BillingEvent";
CREATE POLICY billing_read ON "BillingEvent" FOR SELECT USING ("salonId" = current_setting('app.current_salon', true) OR public.hq_is_admin());
DROP POLICY IF EXISTS billing_insert ON "BillingEvent";
CREATE POLICY billing_insert ON "BillingEvent" FOR INSERT WITH CHECK ("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "BillingEvent" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "BillingEvent" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
 REVOKE ALL ON "BillingEvent" FROM app_runtime;
 GRANT SELECT, INSERT ON "BillingEvent" TO app_runtime;
 END IF;
END $$;

ALTER TABLE "BillingInbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingInbox" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "BillingInbox" FROM PUBLIC;
DROP POLICY IF EXISTS billing_read ON "BillingInbox";
CREATE POLICY billing_read ON "BillingInbox" FOR SELECT USING ("salonId" = current_setting('app.current_salon', true) OR public.hq_is_admin());
DROP POLICY IF EXISTS billing_insert ON "BillingInbox";
CREATE POLICY billing_insert ON "BillingInbox" FOR INSERT WITH CHECK ("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled');
DROP POLICY IF EXISTS billing_update ON "BillingInbox";
CREATE POLICY billing_update ON "BillingInbox" FOR UPDATE USING ("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled') WITH CHECK ("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "BillingInbox" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "BillingInbox" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
 REVOKE ALL ON "BillingInbox" FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON "BillingInbox" TO app_runtime;
 END IF;
END $$;

ALTER TABLE "BillingQueue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingQueue" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "BillingQueue" FROM PUBLIC;
DROP POLICY IF EXISTS billing_read ON "BillingQueue";
CREATE POLICY billing_read ON "BillingQueue" FOR SELECT USING ("salonId" = current_setting('app.current_salon', true) OR current_setting('app.billing_dispatch',true)='enabled' OR public.hq_is_admin());
DROP POLICY IF EXISTS billing_insert ON "BillingQueue";
CREATE POLICY billing_insert ON "BillingQueue" FOR INSERT WITH CHECK (("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled') OR current_setting('app.billing_dispatch',true)='enabled');
DROP POLICY IF EXISTS billing_update ON "BillingQueue";
CREATE POLICY billing_update ON "BillingQueue" FOR UPDATE USING (("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled') OR current_setting('app.billing_dispatch',true)='enabled') WITH CHECK (("salonId" = current_setting('app.current_salon', true) AND current_setting('app.billing_write',true)='enabled') OR current_setting('app.billing_dispatch',true)='enabled');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "BillingQueue" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "BillingQueue" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
 REVOKE ALL ON "BillingQueue" FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON "BillingQueue" TO app_runtime;
 END IF;
END $$;
COMMIT;
