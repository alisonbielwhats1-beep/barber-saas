-- Registro confiável de vendas avulsas de produtos.
-- Migration aditiva: não altera nem remove vendas/agendamentos existentes.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.app_current_salon()') IS NULL THEN
    RAISE EXCEPTION 'app_current_salon() ausente; aplique a base de RLS antes';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Product_id_salonId_key'
      AND conrelid = '"Product"'::regclass
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_id_salonId_key" UNIQUE (id, "salonId");
  END IF;
END $$;

CREATE TABLE "ProductSale" (
  id                  TEXT NOT NULL,
  "salonId"           TEXT NOT NULL,
  "productId"         TEXT NOT NULL,
  quantity            INTEGER NOT NULL,
  "priceCentsUnit"    INTEGER NOT NULL,
  "costCentsUnit"     INTEGER NOT NULL,
  "soldByUserId"      TEXT NOT NULL,
  "idempotencyKey"    TEXT NOT NULL,
  "soldAt"            TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductSale_pkey" PRIMARY KEY (id),
  CONSTRAINT "ProductSale_quantity_check" CHECK (quantity > 0),
  CONSTRAINT "ProductSale_price_check" CHECK ("priceCentsUnit" >= 0),
  CONSTRAINT "ProductSale_cost_check" CHECK ("costCentsUnit" >= 0),
  CONSTRAINT "ProductSale_product_tenant_fkey"
    FOREIGN KEY ("productId", "salonId")
    REFERENCES "Product"(id, "salonId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductSale_salon_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductSale_salonId_idempotencyKey_key"
    UNIQUE ("salonId", "idempotencyKey")
);

CREATE INDEX "ProductSale_salonId_soldAt_idx"
  ON "ProductSale" ("salonId", "soldAt");
CREATE INDEX "ProductSale_productId_soldAt_idx"
  ON "ProductSale" ("productId", "soldAt");

ALTER TABLE "ProductSale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductSale" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ProductSale"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

REVOKE ALL ON TABLE "ProductSale" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "ProductSale" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "ProductSale" FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON TABLE "ProductSale" TO app_runtime;
  END IF;
END $$;

COMMIT;
