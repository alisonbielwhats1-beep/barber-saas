-- Additive. Apply only after preflight, backup, disposable PostgreSQL test,
-- project identification and explicit authorization for the target environment.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public."AppointmentService" ADD COLUMN IF NOT EXISTS "finalPriceCents" integer;
ALTER TABLE public."AppointmentService" ADD COLUMN IF NOT EXISTS "finalPriceReason" text;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."AppointmentService"'::regclass
      AND conname = 'AppointmentService_final_price_check'
  ) THEN
    ALTER TABLE public."AppointmentService"
      ADD CONSTRAINT "AppointmentService_final_price_check" CHECK (
        ("finalPriceCents" IS NULL AND "finalPriceReason" IS NULL)
        OR (
          "priceType" = 'FROM'
          AND "finalPriceCents" IS NOT NULL
          AND "finalPriceCents" BETWEEN "priceCents" AND 100000000
          AND (
            ("finalPriceCents" = "priceCents" AND "finalPriceReason" IS NULL)
            OR ("finalPriceCents" > "priceCents" AND "finalPriceReason" IS NOT NULL
              AND char_length(btrim("finalPriceReason")) BETWEEN 3 AND 240)
          )
        )
      );
  END IF;
END $$;
COMMIT;
