-- Additive. Apply only after preflight, backup, disposable PostgreSQL test,
-- project identification and explicit authorization for the target environment.
-- Constant default: PostgreSQL 11+ adds it without rewriting the table, and
-- every existing salon keeps showing its name over the cover.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public."Salon" ADD COLUMN IF NOT EXISTS "coverShowName" boolean NOT NULL DEFAULT true;
COMMIT;
