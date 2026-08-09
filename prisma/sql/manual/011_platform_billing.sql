-- Controle manual das mensalidades do SaaS.
-- Migration aditiva: não altera pagamentos de atendimentos e não apaga dados.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PlatformInvoiceEventType" AS ENUM ('CREATED', 'MARKED_PAID', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PlatformInvoice" (
  id TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  reference TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "dueDate" DATE NOT NULL,
  "paidDate" DATE,
  status "PlatformInvoiceStatus" NOT NULL DEFAULT 'OPEN',
  "paymentMethod" "PaymentMethod",
  notes TEXT,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY (id),
  CONSTRAINT "PlatformInvoice_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"(id) ON DELETE RESTRICT,
  CONSTRAINT "PlatformInvoice_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"(id) ON DELETE SET NULL,
  CONSTRAINT "PlatformInvoice_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "User"(id) ON DELETE SET NULL,
  CONSTRAINT "PlatformInvoice_amount_positive_check" CHECK ("amountCents" > 0),
  CONSTRAINT "PlatformInvoice_paid_state_check" CHECK (
    (status = 'PAID' AND "paidDate" IS NOT NULL)
    OR (status <> 'PAID' AND "paidDate" IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS "PlatformInvoiceEvent" (
  id TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "actorUserId" TEXT,
  type "PlatformInvoiceEventType" NOT NULL,
  "previousStatus" "PlatformInvoiceStatus",
  "newStatus" "PlatformInvoiceStatus" NOT NULL,
  reason TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformInvoiceEvent_pkey" PRIMARY KEY (id),
  CONSTRAINT "PlatformInvoiceEvent_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "PlatformInvoice"(id) ON DELETE RESTRICT,
  CONSTRAINT "PlatformInvoiceEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformInvoice_salonId_reference_key"
  ON "PlatformInvoice" ("salonId", reference);
CREATE INDEX IF NOT EXISTS "PlatformInvoice_salonId_dueDate_idx"
  ON "PlatformInvoice" ("salonId", "dueDate");
CREATE INDEX IF NOT EXISTS "PlatformInvoice_status_dueDate_idx"
  ON "PlatformInvoice" (status, "dueDate");
CREATE INDEX IF NOT EXISTS "PlatformInvoiceEvent_invoiceId_createdAt_idx"
  ON "PlatformInvoiceEvent" ("invoiceId", "createdAt");

ALTER TABLE "PlatformInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformInvoice" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PlatformInvoiceEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformInvoiceEvent" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_admin_invoices_select ON "PlatformInvoice";
CREATE POLICY platform_admin_invoices_select ON "PlatformInvoice"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user() AND "platformRole" = 'SUPER_ADMIN'
    )
  );

DROP POLICY IF EXISTS platform_admin_invoices_insert ON "PlatformInvoice";
CREATE POLICY platform_admin_invoices_insert ON "PlatformInvoice"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user() AND "platformRole" = 'SUPER_ADMIN'
    )
  );

DROP POLICY IF EXISTS platform_admin_invoices_update ON "PlatformInvoice";
CREATE POLICY platform_admin_invoices_update ON "PlatformInvoice"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user() AND "platformRole" = 'SUPER_ADMIN'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user() AND "platformRole" = 'SUPER_ADMIN'
    )
  );

DROP POLICY IF EXISTS platform_admin_invoice_events_select ON "PlatformInvoiceEvent";
CREATE POLICY platform_admin_invoice_events_select ON "PlatformInvoiceEvent"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user() AND "platformRole" = 'SUPER_ADMIN'
    )
  );

DROP POLICY IF EXISTS platform_admin_invoice_events_insert ON "PlatformInvoiceEvent";
CREATE POLICY platform_admin_invoice_events_insert ON "PlatformInvoiceEvent"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE id = app_current_user() AND "platformRole" = 'SUPER_ADMIN'
    )
  );

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "PlatformInvoice", "PlatformInvoiceEvent" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "PlatformInvoice", "PlatformInvoiceEvent" FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE "PlatformInvoice" TO app_runtime';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE "PlatformInvoiceEvent" TO app_runtime';
  END IF;
END $$;

COMMIT;
