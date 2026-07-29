-- Fluxo de convites por e-mail.
-- Seguro para o estado de produção atual: UserInvite já existe, nenhum objeto
-- é recriado e o convite legado fica marcado como falha de envio (não enviado).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InviteDeliveryStatus') THEN
    CREATE TYPE "InviteDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InviteEventType') THEN
    CREATE TYPE "InviteEventType" AS ENUM (
      'CREATED', 'SENT', 'SEND_FAILED', 'RESENT', 'REVOKED', 'ACCEPTED'
    );
  END IF;
END
$$;

ALTER TABLE "UserInvite"
  ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveryStatus" "InviteDeliveryStatus" NOT NULL DEFAULT 'SENDING',
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastSendAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sendAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastErrorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "pendingBio" TEXT,
  ADD COLUMN IF NOT EXISTS "pendingColorHex" TEXT,
  ADD COLUMN IF NOT EXISTS "pendingCommissionPct" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "pendingMonthlyGoalCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "pendingServiceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- O único convite legado nunca passou por um provedor real.
UPDATE "UserInvite"
SET
  "deliveryStatus" = 'FAILED',
  "lastErrorCode" = 'LEGACY_NOT_SENT'
WHERE
  "sentAt" IS NULL
  AND "sendAttempts" = 0
  AND "usedAt" IS NULL;

DROP INDEX IF EXISTS "UserInvite_salonId_normalizedEmail_pending_key";
CREATE UNIQUE INDEX IF NOT EXISTS "UserInvite_salonId_normalizedEmail_pending_key"
  ON "UserInvite"("salonId", lower(btrim("email")))
  WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;

DROP INDEX IF EXISTS "UserInvite_salonId_expiresAt_idx";
CREATE INDEX IF NOT EXISTS "UserInvite_salonId_usedAt_revokedAt_expiresAt_idx"
  ON "UserInvite"("salonId", "usedAt", "revokedAt", "expiresAt");

CREATE TABLE IF NOT EXISTS "UserInviteEvent" (
  "id" TEXT NOT NULL,
  "inviteId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "type" "InviteEventType" NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserInviteEvent_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'UserInviteEvent_inviteId_fkey'
  ) THEN
    ALTER TABLE "UserInviteEvent"
      ADD CONSTRAINT "UserInviteEvent_inviteId_fkey"
      FOREIGN KEY ("inviteId") REFERENCES "UserInvite"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'UserInviteEvent_actorUserId_fkey'
  ) THEN
    ALTER TABLE "UserInviteEvent"
      ADD CONSTRAINT "UserInviteEvent_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "UserInviteEvent_inviteId_createdAt_idx"
  ON "UserInviteEvent"("inviteId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserInviteEvent_actorUserId_idx"
  ON "UserInviteEvent"("actorUserId");

ALTER TABLE "UserInviteEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "UserInviteEvent" FROM anon, authenticated;
