-- Rollback estrutural seguro: remove apenas o indice criado, sem tocar nos dados.

BEGIN;

DROP INDEX IF EXISTS "ProductSale_productId_salonId_idx";

COMMIT;
