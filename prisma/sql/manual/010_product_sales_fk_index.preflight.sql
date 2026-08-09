-- Preflight somente leitura para o indice que cobre a FK multitenant de ProductSale.

SELECT
  to_regclass('public."ProductSale"') AS product_sale_table,
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ProductSale_product_tenant_fkey'
      AND conrelid = 'public."ProductSale"'::regclass
  ) AS tenant_product_fk_exists;
