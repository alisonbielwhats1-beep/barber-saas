-- Minimal production-compatible baseline used only by PostgreSQL integration
-- tests. It represents the tables touched by the invite migrations immediately
-- before 20260728220000_fase_1_security_invites.

CREATE TYPE "Role" AS ENUM (
  'SUPER_ADMIN',
  'OWNER',
  'MANAGER',
  'PROFESSIONAL',
  'RECEPTIONIST'
);
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "passwordHash" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Salon" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "logoUrl" TEXT,
  "address" TEXT,
  "phone" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "plan" "Plan" NOT NULL DEFAULT 'FREE',
  "openMinutes" INTEGER NOT NULL DEFAULT 540,
  "closeMinutes" INTEGER NOT NULL DEFAULT 1140,
  "cancelPolicyHours" INTEGER NOT NULL DEFAULT 2,
  "noShowFeeCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Salon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Salon_slug_key" ON "Salon"("slug");

-- Estrutura mínima para validar também a migration aditiva de recuperação de
-- senha no mesmo banco descartável. Os testes de convite não leem esta tabela.
CREATE TABLE "ClientProfile" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Membership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Membership_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Membership_userId_salonId_key"
  ON "Membership"("userId", "salonId");
CREATE INDEX "Membership_salonId_idx" ON "Membership"("salonId");

CREATE TABLE "Professional" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bio" TEXT,
  "colorHex" TEXT,
  "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "monthlyGoalCents" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Professional_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Professional_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Professional_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Professional_userId_key" ON "Professional"("userId");
CREATE INDEX "Professional_salonId_idx" ON "Professional"("salonId");

CREATE TABLE "Service" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "durationMin" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "costCents" INTEGER NOT NULL DEFAULT 0,
  "category" TEXT,
  "imageUrl" TEXT,
  "colorHex" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Service_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Service_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Service_salonId_idx" ON "Service"("salonId");

CREATE TABLE "ProfessionalService" (
  "professionalId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  CONSTRAINT "ProfessionalService_pkey"
    PRIMARY KEY ("professionalId", "serviceId"),
  CONSTRAINT "ProfessionalService_professionalId_fkey"
    FOREIGN KEY ("professionalId") REFERENCES "Professional"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProfessionalService_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
