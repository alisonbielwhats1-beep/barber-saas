-- Preflight somente leitura para cobranças manuais da plataforma.
-- Deve retornar zero linhas. Não altera schema nem dados.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('PlatformInvoice', 'PlatformInvoiceEvent');

SELECT typname
FROM pg_type
WHERE typname IN ('PlatformInvoiceStatus', 'PlatformInvoiceEventType');

-- A migration 010 é pré-requisito.
SELECT required_table
FROM (VALUES ('Salon'), ('User')) AS required(required_table)
WHERE to_regclass('public.' || quote_ident(required_table)) IS NULL;
