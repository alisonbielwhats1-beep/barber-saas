-- Rollback não destrutivo de vendas avulsas.
-- O código anterior ignora a tabela nova. Mantê-la preserva todo o histórico
-- financeiro criado depois do rollout e permite roll-forward sem perda.

BEGIN;

-- Nenhuma operação estrutural é necessária. O deploy do código anterior é o
-- rollback e não consulta ProductSale. As permissões permanecem prontas para
-- um roll-forward sem janela adicional de banco.

COMMIT;
