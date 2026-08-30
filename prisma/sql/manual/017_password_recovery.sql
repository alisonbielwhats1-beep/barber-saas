-- Migration aditiva e idempotente. Não remove nem reescreve dados existentes.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "passwordResetExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ClientProfile"
  ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "passwordResetExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "User_passwordResetTokenHash_key"
  ON "User"("passwordResetTokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientProfile_passwordResetTokenHash_key"
  ON "ClientProfile"("passwordResetTokenHash");
