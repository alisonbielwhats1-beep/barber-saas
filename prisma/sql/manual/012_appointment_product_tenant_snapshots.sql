-- AppointmentProduct tenant-aware + snapshots de produto/moeda.
--
-- Migration aditiva. Aplicar somente após o preflight retornar zero anomalias,
-- em banco descartável/homologação e com autorização explícita para cada
-- ambiente. Não executar em Production como teste.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AppointmentProduct" ap
    JOIN "Appointment" a ON a.id = ap."appointmentId"
    JOIN "Product" p ON p.id = ap."productId"
    WHERE a."salonId" <> p."salonId"
  ) THEN
    RAISE EXCEPTION '012 bloqueada: AppointmentProduct possui vínculo cross-tenant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "AppointmentProduct" ap
    LEFT JOIN "Appointment" a ON a.id = ap."appointmentId"
    LEFT JOIN "Product" p ON p.id = ap."productId"
    WHERE a.id IS NULL OR p.id IS NULL
  ) THEN
    RAISE EXCEPTION '012 bloqueada: AppointmentProduct possui órfão';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Payment" payment
    LEFT JOIN "Appointment" a ON a.id = payment."appointmentId"
    LEFT JOIN "Salon" salon ON salon.id = a."salonId"
    WHERE salon.id IS NULL
  ) THEN
    RAISE EXCEPTION '012 bloqueada: Payment não consegue resolver o salão';
  END IF;
END $$;

ALTER TABLE "AppointmentProduct"
  ADD COLUMN IF NOT EXISTS "salonId" TEXT,
  ADD COLUMN IF NOT EXISTS "productName" TEXT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "currency" TEXT;

-- O histórico é preenchido com o catálogo e a configuração vigentes no
-- instante do backfill. A partir desta migration, o código grava snapshots
-- explícitos no momento da reserva/recebimento.
UPDATE "AppointmentProduct" ap
SET
  "salonId" = a."salonId",
  "productName" = p.name,
  "currency" = salon.currency
FROM "Appointment" a, "Product" p, "Salon" salon
WHERE a.id = ap."appointmentId"
  AND p.id = ap."productId"
  AND salon.id = a."salonId";

UPDATE "Payment" payment
SET "currency" = salon.currency
FROM "Appointment" a
JOIN "Salon" salon ON salon.id = a."salonId"
WHERE a.id = payment."appointmentId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AppointmentProduct"
    WHERE "salonId" IS NULL OR "productName" IS NULL OR "currency" IS NULL
  ) THEN
    RAISE EXCEPTION '012 bloqueada: backfill de AppointmentProduct incompleto';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Payment"
    WHERE "currency" IS NULL
  ) THEN
    RAISE EXCEPTION '012 bloqueada: backfill de Payment incompleto';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Product_id_salonId_key'
      AND conrelid = '"Product"'::regclass
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class index_rel
    JOIN pg_index index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_rel.relname = 'Product_id_salonId_key'
      AND index_meta.indrelid = '"Product"'::regclass
      AND index_meta.indisunique
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_id_salonId_key" UNIQUE (id, "salonId");
  END IF;
END $$;

ALTER TABLE "AppointmentProduct"
  DROP CONSTRAINT IF EXISTS "AppointmentProduct_appointmentId_fkey",
  DROP CONSTRAINT IF EXISTS "AppointmentProduct_productId_fkey";

ALTER TABLE "AppointmentProduct"
  ALTER COLUMN "salonId" SET NOT NULL,
  ALTER COLUMN "productName" SET NOT NULL,
  ALTER COLUMN "currency" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AppointmentProduct_appointment_tenant_fkey'
      AND conrelid = '"AppointmentProduct"'::regclass
  ) THEN
    ALTER TABLE "AppointmentProduct"
      ADD CONSTRAINT "AppointmentProduct_appointment_tenant_fkey"
      FOREIGN KEY ("appointmentId", "salonId")
      REFERENCES "Appointment" (id, "salonId")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AppointmentProduct_product_tenant_fkey'
      AND conrelid = '"AppointmentProduct"'::regclass
  ) THEN
    ALTER TABLE "AppointmentProduct"
      ADD CONSTRAINT "AppointmentProduct_product_tenant_fkey"
      FOREIGN KEY ("productId", "salonId")
      REFERENCES "Product" (id, "salonId")
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE "Payment"
  ALTER COLUMN "currency" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "AppointmentProduct_salonId_appointmentId_idx"
  ON "AppointmentProduct" ("salonId", "appointmentId");
CREATE INDEX IF NOT EXISTS "AppointmentProduct_salonId_productId_idx"
  ON "AppointmentProduct" ("salonId", "productId");

ALTER TABLE "AppointmentProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentProduct" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AppointmentProduct";
CREATE POLICY tenant_isolation ON "AppointmentProduct"
  USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());

COMMIT;
