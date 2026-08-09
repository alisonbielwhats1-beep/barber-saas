-- Cobre a chave estrangeira composta e acelera buscas por produto dentro do tenant.
-- Migration aditiva: nao altera nem remove dados existentes.

BEGIN;

CREATE INDEX IF NOT EXISTS "ProductSale_productId_salonId_idx"
  ON "ProductSale" ("productId", "salonId");

COMMIT;
