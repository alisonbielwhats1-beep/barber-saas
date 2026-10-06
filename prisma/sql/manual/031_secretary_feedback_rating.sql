-- Additive. Run the companion preflight first, on the identified destination. Never Production without approval.
-- Owner decision 06/10/2026: "Boa resposta" next to "Não era isso", for future training. Each feedback row says whether the
-- owner rated the reply GOOD or BAD. Rows stored before this migration were all "Não era isso", so the default is BAD.
-- Adding a column with a constant default does not rewrite the table nor fire the immutable UPDATE trigger.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:031_secretary_feedback_rating',0));
ALTER TABLE "SecretaryFeedback" ADD COLUMN IF NOT EXISTS "rating" TEXT NOT NULL DEFAULT 'BAD';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."SecretaryFeedback"'::regclass AND conname='SecretaryFeedback_rating') THEN
  ALTER TABLE "SecretaryFeedback" ADD CONSTRAINT "SecretaryFeedback_rating" CHECK ("rating" IN ('GOOD','BAD'));
 END IF;
END $$;
COMMIT;
