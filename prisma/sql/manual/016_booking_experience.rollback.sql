-- Rollback seguro da fase 016.
-- Não apaga regras, propostas, eventos ou histórico. Antes de um rollback
-- operacional, interrompa o uso das novas rotas e preserve os dados para uma
-- reversão planejada; remover essas tabelas destruiria decisões do cliente.

BEGIN;

ALTER TABLE "Salon"
  ALTER COLUMN "maxBookingLeadDays" SET DEFAULT 90;

COMMIT;
