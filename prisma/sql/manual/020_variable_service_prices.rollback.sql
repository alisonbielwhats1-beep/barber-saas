-- Não remover colunas nem sobrescrever condições já informadas a clientes.
-- Antes de ativar FROM, o código anterior pode ser restaurado mantendo colunas.
-- Depois de usar FROM, corrigir por roll-forward: código antigo exibiria os
-- valores iniciais como fixos. Suspender novas reservas variáveis até corrigir.
BEGIN TRANSACTION READ ONLY;
SELECT 'Service' AS object, count(*) AS variable_records FROM public."Service" WHERE "priceType" = 'FROM'
UNION ALL SELECT 'AppointmentService', count(*) FROM public."AppointmentService" WHERE "priceType" = 'FROM';
COMMIT;
