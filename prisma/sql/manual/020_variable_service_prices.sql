-- Aditiva. Executar somente após preflight, backup e autorização do ambiente.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public."Service" ADD COLUMN IF NOT EXISTS "priceType" text NOT NULL DEFAULT 'FIXED';
ALTER TABLE public."Service" ADD COLUMN IF NOT EXISTS "priceNote" text;
ALTER TABLE public."AppointmentService" ADD COLUMN IF NOT EXISTS "priceType" text NOT NULL DEFAULT 'FIXED';
ALTER TABLE public."AppointmentService" ADD COLUMN IF NOT EXISTS "priceNote" text;
-- Constant defaults preserve every legacy record as fixed. Never copy today's
-- catalog into historical reservations. No RLS, grants or prices are changed.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Service', 'AppointmentService'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = table_name || '_price_terms_check' AND conrelid = format('public.%I', table_name)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        ("priceType" = ''FIXED'' AND "priceNote" IS NULL) OR
        ("priceType" = ''FROM'' AND "priceNote" IS NOT NULL AND char_length(btrim("priceNote")) BETWEEN 1 AND 240)
      )', table_name, table_name || '_price_terms_check');
    END IF;
  END LOOP;
END $$;
COMMIT;
