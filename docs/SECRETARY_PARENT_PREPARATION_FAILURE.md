# Confirmação após falha de preparação

Revisão local de 27/09/2026, sem API paga nem mutation de domínio.

## Causa reproduzida

Em um plano com duas ações prontas, a continuação incrementava a revisão antes
de interpretar uma correção. Quando a interpretação falhava, o token anterior
ficava stale, mas as propostas dos filhos e suas avaliações READY sobreviviam.
A projeção conseguia criar um novo grupo confirmável com esses dados antigos.
A reprodução independente alcançou dois executores simulados.

A evidência anterior à correção permanece em
`.demo/inventory-independent-temporal-review-before-generic.json`, SHA-256
`bbf978283111403fab8dcb3eb06820671d490dbd1c50df3ab264d256a3aab4e7`.
Esse achado não foi ocultado nos números da Golden, que é outra bateria.

## Transição corrigida

`preparePlanSafely` envolve a preparação do turno automático, a construção de
um novo plano candidato, a retomada e a seleção. Em uma falha propagada, retira
primeiro todas as propostas das unidades afetadas, depois substitui suas
avaliações por um estado não confirmável. A revisão anterior continua inválida.

`failActionUnit` aplica a mesma retirada nas falhas tratadas por unidade. Não
altera ações DONE, drafts, revisões persistidas, recibos ou dependências. A
projeção conserva os campos efetivamente aceitos pelo adapter; falhar nessa
projeção também não restaura prontidão. Se o turno aponta uma operação específica,
as unidades independentes não afetadas permanecem preservadas.

A retirada inclui a mensagem de preparação, mesmo quando o adapter já havia
removido a proposta antes de lançar a exceção. Isso impede que uma ação sem
proposta continue exibindo instrução para confirmar.

Planos novos ainda não publicados também passam por essa transição. Falhas
de auditoria depois da preparação não deixam suas propostas executáveis.
Recibos de execução já confirmada seguem o tratamento existente de observabilidade
após commit e não são desfeitos por este fluxo.

## Validação

A regressão permanente `src/lib/__tests__/secretary-parent-preparation-failure.test.ts`
examina tokens antigos e novos, contexto preservado, DONE/recibos, falhas de
schema, timeout, reparo e auditoria, além das fronteiras NEW/ADD/PATCH/RESUME.
As capturas anteriores a cada correção de runtime continuam em `.demo`.
O relatório final consolidará a execução definitiva; este documento descreve a
correção, não declara staging pronta.
