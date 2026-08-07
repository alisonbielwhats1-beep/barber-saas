-- Preflight somente leitura para vendas avulsas de produtos.
-- Execute primeiro em ambiente descartável ou homologação.

SELECT
  COUNT(*) AS total_products,
  COUNT(*) FILTER (WHERE stock < 0) AS products_with_negative_stock,
  MIN(stock) AS minimum_stock,
  MAX(stock) AS maximum_stock
FROM "Product";

SELECT
  to_regprocedure('public.app_current_salon()') IS NOT NULL
    AS app_current_salon_exists;

SELECT id, "salonId", name, stock
FROM "Product"
WHERE stock < 0
ORDER BY "salonId", id;

SELECT
  COUNT(*) AS duplicate_product_tenant_pairs
FROM (
  SELECT id, "salonId"
  FROM "Product"
  GROUP BY id, "salonId"
  HAVING COUNT(*) > 1
) AS duplicates;

SELECT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime'
) AS app_runtime_exists;
