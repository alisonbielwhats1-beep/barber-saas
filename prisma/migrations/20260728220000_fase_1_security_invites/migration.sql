-- Fase 1 — persistência e atomicidade dos convites.
-- Migration preparada localmente. NÃO foi aplicada em nenhum banco.

-- Estado explícito: NULL significa que a aplicação ainda não registrou a
-- configuração bem-sucedida de uma senha. Não há backfill por mera existência
-- do User, pois isso repetiria a inferência insegura corrigida nesta migration.
ALTER TABLE "User"
  ADD COLUMN "passwordSetAt" TIMESTAMP(3);

CREATE TABLE "UserInvite" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "createdById" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT true,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserInvite_tokenHash_key" ON "UserInvite"("tokenHash");
CREATE UNIQUE INDEX "UserInvite_salonId_normalizedEmail_pending_key"
  ON "UserInvite"(
    "salonId",
    lower(btrim("email"))
  )
  WHERE "usedAt" IS NULL;
CREATE INDEX "UserInvite_salonId_expiresAt_idx" ON "UserInvite"("salonId", "expiresAt");
CREATE INDEX "UserInvite_email_usedAt_idx" ON "UserInvite"("email", "usedAt");
CREATE INDEX "UserInvite_userId_usedAt_idx" ON "UserInvite"("userId", "usedAt");

ALTER TABLE "UserInvite"
  ADD CONSTRAINT "UserInvite_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserInvite"
  ADD CONSTRAINT "UserInvite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserInvite"
  ADD CONSTRAINT "UserInvite_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase Data API: sem policy, anon/authenticated não conseguem atravessar
-- RLS. O backend Prisma preserva o acesso do dono da tabela/BYPASSRLS porque
-- não usamos FORCE ROW LEVEL SECURITY nem revogamos privilégios de CURRENT_USER.
ALTER TABLE "UserInvite" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "UserInvite" FROM anon, authenticated;
