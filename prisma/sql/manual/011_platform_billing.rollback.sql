-- Rollback sem perda de dados.
-- Desativa a escrita pelo aplicativo, mas mantém cobranças e histórico para
-- uma futura reativação ou exportação administrativa.

BEGIN;

DROP POLICY IF EXISTS platform_admin_invoices_select ON "PlatformInvoice";
DROP POLICY IF EXISTS platform_admin_invoices_insert ON "PlatformInvoice";
DROP POLICY IF EXISTS platform_admin_invoices_update ON "PlatformInvoice";
DROP POLICY IF EXISTS platform_admin_invoice_events_select ON "PlatformInvoiceEvent";
DROP POLICY IF EXISTS platform_admin_invoice_events_insert ON "PlatformInvoiceEvent";

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE SELECT, INSERT, UPDATE ON TABLE "PlatformInvoice" FROM app_runtime';
    EXECUTE 'REVOKE SELECT, INSERT ON TABLE "PlatformInvoiceEvent" FROM app_runtime';
  END IF;
END $$;

COMMIT;
