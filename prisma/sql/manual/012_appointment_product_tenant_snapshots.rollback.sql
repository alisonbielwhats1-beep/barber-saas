-- Rollback não destrutivo da migration 012.
--
-- Os dados de venda/reserva e os snapshots não devem ser apagados. Também não
-- existe rollback seguro que remova as colunas NOT NULL e as FKs compostas
-- enquanto uma versão nova do código puder estar escrevendo nelas. Em caso de
-- falha, faça rollback do código para uma versão compatível e depois execute
-- um roll-forward planejado; preserve este schema e os dados para auditoria.

BEGIN;

-- Verificação somente leitura para tornar explícito que o rollback não remove
-- pagamentos, reservas, snapshots, constraints ou histórico.
SELECT
  (SELECT COUNT(*) FROM "AppointmentProduct") AS appointment_product_rows,
  (SELECT COUNT(*) FROM "Payment") AS payment_rows;

COMMIT;
