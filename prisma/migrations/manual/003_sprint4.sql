-- Sprint 4 — Monetizar
-- Rodar no Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- Comanda: desconto e observação no pagamento
ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "discountCents" INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "notes"         TEXT;

-- Lembretes: controle de envio por agendamento
-- Cancelamento: timestamp para relatórios futuros
ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "cancelledAt"    TIMESTAMPTZ;
