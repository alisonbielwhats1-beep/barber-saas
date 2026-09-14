-- Dados pessoais informados pelo estabelecimento permanecem pendentes até o
-- profissional aceitar o convite e criar a própria conta.
ALTER TABLE "UserInvite"
  ADD COLUMN "pendingPhone" TEXT,
  ADD COLUMN "pendingAvatarUrl" TEXT;
