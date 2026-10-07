-- Rollback of 031: first deploy the code without "rating" (or turn SALON_SECRETARY_FEEDBACK off), then drop the column.
BEGIN;
ALTER TABLE "SecretaryFeedback" DROP CONSTRAINT IF EXISTS "SecretaryFeedback_rating";
ALTER TABLE "SecretaryFeedback" DROP COLUMN IF EXISTS "rating";
COMMIT;
