-- Normalize customer identity and retain merge history without deleting rows.
ALTER TABLE "ClientProfile"
  ADD COLUMN IF NOT EXISTS "phoneNormalized" TEXT,
  ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT,
  ADD COLUMN IF NOT EXISTS "mergedAt" TIMESTAMP(3);

UPDATE "ClientProfile"
SET "phoneNormalized" = CASE
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^55[0-9]{10,11}$'
    THEN substring(regexp_replace("phone", '[^0-9]', '', 'g') FROM 3)
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^[0-9]{10,11}$'
    THEN regexp_replace("phone", '[^0-9]', '', 'g')
  ELSE NULL
END
WHERE "phone" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ClientProfile_id_salonId_key"
  ON "ClientProfile"("id", "salonId");

CREATE INDEX IF NOT EXISTS "ClientProfile_salonId_phoneNormalized_idx"
  ON "ClientProfile"("salonId", "phoneNormalized");

CREATE INDEX IF NOT EXISTS "ClientProfile_salonId_mergedIntoId_idx"
  ON "ClientProfile"("salonId", "mergedIntoId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ClientProfile_mergedInto_tenant_fkey'
  ) THEN
    ALTER TABLE "ClientProfile"
      ADD CONSTRAINT "ClientProfile_mergedInto_tenant_fkey"
      FOREIGN KEY ("mergedIntoId", "salonId")
      REFERENCES "ClientProfile"("id", "salonId")
      ON DELETE NO ACTION
      ON UPDATE CASCADE;
  END IF;
END $$;
