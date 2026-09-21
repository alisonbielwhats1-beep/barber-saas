# Troca de planos — 13/09/2026

Atualização de 20/09/2026: consulta somente leitura confirmou código produtivo
`13cb2a333a66`, tabela `BillingPlanChange` presente e flag de trocas habilitada.
As afirmações abaixo de não publicação são históricas. Esta auditoria não aplicou
migrations. A correção de seleção pendente está documentada em
`ASSINATURAS_E_LIMPEZA_HQ_2026-09-20.md` e ainda não foi publicada.

Implementação solicitada pelo responsável após a publicação do PR #101.
Branch `codex/mercadopago-plan-changes`. Ainda não publicada nem habilitada.

## Ampliação: cancelamento livre e período pago

Pedido posterior do responsável: deixar o cancelamento claro e validar acesso
até o vencimento original. Configurações → Meu plano passa a mostrar “Gerenciar ou cancelar
assinatura”. No portal, “Cancelar renovação” abre uma confirmação com data/hora
exata no fuso do salão, sem motivo obrigatório ou contato com suporte. O OWNER
também encontra esse portal na tela de acesso suspenso, sem desbloquear operação.

O pedido sob lock de tenant inclui todas as assinaturas substitutas vinculadas,
mesmo em revisão ou já promovidas após uma página antiga ter sido aberta. Cada
uma recebe intenção durável e fila própria. Cancelar cobranças tem prioridade
sobre conciliação de troca de plano. A UI diferencia disponível, pendente e
confirmado considerando a cadeia inteira; cancelar a antiga não significa que
a futura foi encerrada. Um preço conhecido remanescente em uma recorrência
cancelada não invalida a leitura das faturas históricas, que continuam conferidas
individualmente por período e termos imutáveis.

Regressões PostgreSQL cobrem todos os quatro planos nos dois ciclos, adicionais
no Max, contratação no dia 13 e cancelamento no dia 20, acesso até o último
milissegundo pago e expiração sem carência. Incluem duplicidade de clique,
OWNER/tenant, suspensão, checkout pausado, resposta perdida, redução/upgrade
pendentes e substituta anual autorizada em SCHEDULED/REVIEW. A cadeia fica
pendente enquanto qualquer recorrência aguarda confirmação do provedor.

Rodada local: 80 integrações PostgreSQL e seis testes do provider passaram;
1.036 testes unitários/componentes, lint, TypeScript e build passaram. Nova validação
CI/Preview, capturas de cancelamento em 320/390/1280 px e acesso do OWNER suspenso
pertencem ao commit desta ampliação e terão resultado registrado no PR #105.
Sem nova migration além da 025 já preparada, ainda não aplicada em Production.

Conferência externa em 13/09: repetição do cancelamento da cadeia fictícia
`0bf9337100f845cd854999e6cc24bcd2` / `23558ea405944f5cbe4ae4017d7dc78e` manteve
ambas canceladas no Mercado Pago e zero faturas na substituta. A indicação local
ficou PENDING enquanto faltava registrar o GET da substituta e passou a CANCELLED
após sua conciliação, preservando cinco agendas, duas cobranças históricas e
paidThrough `2026-10-13T17:42:29Z`. Nenhuma nova compra ou cobrança real.

## Decisão comercial confirmada

- Todos os planos pagos podem passar para uma capacidade maior, incluindo
  Individual, Essencial, Equipe 5/10 e adicionais acima de dez agendas.
- No mesmo ciclo, upgrade libera capacidade após pagamento da diferença
  proporcional ao período restante, preservando o vencimento.
- Reduções e mudanças mensal/anual entram no próximo vencimento. A capacidade
  precisa comportar profissionais ativos e convites pendentes.
- O proprietário revisa preço, cobrança imediata, recorrência e data antes de
  confirmar. Nenhuma aprovação administrativa integra a contratação nova.
- Histórico, suspensão administrativa, cancelamento e períodos pagos permanecem.

## Implementação

O código publicado impede uma segunda contratação vigente. Os termos originais
de `BillingSubscription` são usados para conferir todas as faturas; sobrescrevê-los
diretamente faria pagamentos antigos falharem na reconciliação.

A tabela aditiva `BillingPlanChange` persiste origem, destino, preço, período,
expiração da cotação e estado. Os termos originais nunca são sobrescritos;
faturas antigas são conferidas contra a revisão válida na sua data de débito.
`currentTerms` fornece a última capacidade paga ao painel, limites e HQ.

- Cotação pelo servidor por até 15 minutos, em centavos inteiros. A diferença
  usa o valor efetivamente contratado e o tempo restante do período pago,
  arredondando para cima no máximo um centavo. Novo upgrade parte do último
  plano pago. Nenhum adicional concede outro mês ou ano.
- Uma troca confirmada em execução por salão, com índice único e lock por tenant.
  Ocorrências históricas REVIEW ficam fora desse índice para não impedir o
  registro de um estorno enquanto existe outra troca. Review bloqueia novos
  pedidos e congela trocas em execução até conferência, preservando o livro.
  Confirmação revalida plano, vencimento e capacidade sob os mesmos locks de
  criação de profissionais/convites. Apenas OWNER pode operar.
- Upgrade cria preferência Checkout Pro exclusiva (`efu:salonId:changeId`).
  Pagamento aprovado exige vendedor, pagador, referência, ambiente, BRL e valor
  corretos. Só então libera capacidade e atualiza o valor da recorrência.
- Redução altera a próxima cobrança e reserva a capacidade menor. O plano
  vigente só muda com a aprovação da primeira fatura do novo período.
- Na mudança de ciclo, cria assinatura pendente com início no vencimento atual,
  encerra e confirma a recorrência antiga e só então exibe o novo checkout.
  Autorização sozinha não libera capacidade. No vencimento, pagamento da
  substituta e cancelamento anterior confirmado permitem promover a nova.
  A UI explica que abandonar a autorização não restaura a recorrência antiga.
- POST de resposta incerta é recuperado pela referência; não é repetido
  cegamente. PUT é confirmado com GET. A fila processa retries e notificações
  fora de ordem, incluindo pagamento que chegou durante uma atualização incerta.
- Pagamento duplicado, estorno, chargeback ou quitação fora da cotação gera
  `REVIEW`, preserva cobranças e sinaliza conferência. Não há reembolso automático.
  Renovação/alteração pode exigir intervenção nessa situação excepcional.
- Notificação tardia de pagamento aprovado dentro do prazo pode ativar uma
  cotação expirada se os termos e o período ainda forem válidos e nenhuma outra
  troca a tiver substituído. Caso contrário, preserva a cobrança para revisão.
- Cancelamento é durável. Cobrança complementar não paga pode ser expirada;
  preço agendado pode ser restaurado antes do vencimento, com confirmação.
  Pagamento aprovado não pode ser desfeito pelo botão de cancelar a troca.

O SDK oficial permite alterar valor/moeda, mas declara frequência e calendário
imutáveis após criação. Mensal/anual exigem nova autorização, com início futuro
e encerramento confirmado da recorrência anterior. Não usar PUT de frequência
sem suporte do provedor.

Fontes consultadas:

- [Gestão de assinaturas](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management)
- [Contrato de atualização do SDK oficial](https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/preApproval/update/types.ts)
- [Início de recorrência no SDK oficial](https://github.com/mercadopago/sdk-go/blob/master/pkg/preapproval/request.go)

## Banco, ativação e recuperação

Migration `025_billing_plan_changes.sql`: tabela, FKs compostas para tenant,
FORCE RLS, permissões delimitadas, índice de pendência e trigger de imutabilidade.
Não altera contratos ou dados existentes. `preflight`, `verify` e `rollback`
acompanham o SQL. Rollback é inventário somente leitura: preservar dados e
reconciliador, pausar novas solicitações; não apagar a tabela.

`MERCADOPAGO_PLAN_CHANGES_ENABLED=true` somente após migration verificada e
homologação. Depois da primeira troca, manter essa flag e código de leitura.
`MERCADOPAGO_PLAN_CHANGES_PAUSED=true` bloqueia cotações/confirmações novas sem
interromper pagamentos, cancelamentos, termos vigentes e reconciliação.
Production ainda não recebeu a migration nem as flags desta entrega.

CI/schema-smoke inclui predecessor populado, backup, restauração, comparação
por fingerprints, aplicação e reaplicação da 025, verificação RLS e suítes PG.
Não usar db push ou SQL de fixtures em Production. Promoção depende de CI,
Preview, homologação e autorização para o SQL aditivo com backup/rollback.

## Evidências obtidas e limites

Em 13/09, 66 testes PostgreSQL passaram no banco sintético isolado
`billing_changes_full_20260913`, com as migrations reais 023/024/025 e runtime
sem BYPASSRLS. Incluem todas as 12 combinações de aumento entre os quatro planos
nos dois ciclos, upgrades sucessivos, pagamento duplicado, estorno, recuperação
de POST/PUT perdido, cotação/OWNER/tenant, convite pendente e renovação agendada.
Matriz pura cobre 64 combinações de plano/ciclo, adicionais até cem, preços
persistidos e meses de 28/29/30/31 dias e anos de 365/366 dias.

A API externa foi consultada apenas com vendedor fictício `3683184919`:
preferências de R$ 0,01 e R$ 37,99 criadas e expiradas com GET confirmatório;
assinatura anual futura `5ca817652cbd4a03ad6bd18b7bc35ef9` criada pendente,
valor alterado de R$ 1.439 para R$ 959 e cancelada com GET confirmatório.
Não houve pagamento nessas sondagens. O provedor trunca início para segundos:
o código arredonda para o próximo segundo para nunca antecipar cobrança.
A busca das preferências retornou zero imediatamente e um resultado após
indexação; retries mantêm a reserva e recuperam o mesmo ID, sem novo POST.

Compra fictícia completa conferida em 13/09, comprador `3683184927`:

- Individual mensal `0bf9337100f845cd854999e6cc24bcd2`, pagamento
  `177860783825`, R$ 59,90 aprovado. PaidThrough `2026-10-13T17:42:29Z`.
- Upgrade para Equipe 5, pagamento `178835370434`, R$ 40 aprovado. Cotação
  `033946b2-7825-47d9-ae60-f549923e78a3` APPLIED, cinco agendas, próxima
  recorrência R$ 99,90, mesmo paidThrough. HQ registra R$ 99,90 recebidos no
  total (59,90 + 40), sem duplicidade.
- Troca futura para Equipe 10 anual: antiga cancelada antes de liberar o link;
  substituta `23558ea405944f5cbe4ae4017d7dc78e` autorizada com início
  `2026-10-13T17:42:29Z`. GET confirmou zero faturas e estado SCHEDULED;
  capacidade vigente continuou cinco. O checkout exibiu início em 13 de outubro.
- Cancelamento da troca futura confirmado no provedor; ambas as recorrências
  fictícias estão canceladas, histórico e período pago preservados.

A resposta externa após pagamento usa `summarized.pending_charge_quantity=null`;
parser corrigido e regressão adicionada. As suítes PG configuram permissões no
mesmo schema; executam sequencialmente para evitar disputa de GRANT entre seus
setups. Isso não reduz os testes de concorrência executados dentro das suítes.

Na versão anterior `b6f3e9b`, lint, TypeScript, 1.034 testes e build passaram,
assim como 66 integrações PostgreSQL + seis testes do provider. CI final
`34773937424` passou integralmente e Preview ficou READY. Revisão visual local teve início de
servidor bloqueado pela revisão automática; jornada dedicada de revisão de
cotação 320/390/1280 px, acessibilidade e capturas foi acrescentada ao CI.
A jornada passou no CI `34772979366` às `18:02:41Z` em `7b054b6`.
A ampliação de cancelamento acima exige novo CI correspondente ao seu commit.
Não foi feita compra real nem esperada uma renovação futura externa. Essa
renovação é exercitada por relógio controlado no PostgreSQL sintético.
Não se declara pagamento externo de todas as combinações apenas por mocks.

## Preflight produtivo e recuperação preparados

Em `2026-09-13T17:57:09Z`, SQL Editor confirmou projeto `barber-saas`, ref
`vshnatkzxdekkvqttvbv`, branch main PRODUCTION, transação `READ ONLY`.
Billing/HQ com FORCE RLS, app_runtime sem superuser/BYPASSRLS, colunas das
023/024 presentes. Zero assinaturas e cobranças; tabela/função 025 ausentes.
Nenhuma migration desta entrega foi aplicada.

Registro de recuperação às `17:58:40Z`: metadados das cinco tabelas Billing,
63 colunas, 13 constraints, 18 índices, 14 policies e 84 grants. Sem dados de
clientes; não é dump completo do projeto nem backup de dados do HQ, que a 025
não modifica. Criptografado e decifrado integralmente em memória para verificação
em `C:/Users/Usuário/.codex/backups/everflair/production-2026-09-13-pr105/`.
Manifesto SHA256 `fc1ec769c1ce02749c729b3a5ed96c7fbc39c0d7076b6a90ffb39b486dfe6261`.
Revalidar o preflight antes de aplicar; preservar a tabela e o reconciliador no
rollback. Aplicação da 025 e promoção aguardam aprovação final após o CI.

## Matriz de verificação

Matriz completa de planos/ciclos/adicionais; preços persistidos anteriores;
centavos e arredondamento; fevereiro/ano bissexto/fim do mês; cotação expirada;
pagamento recusado, pendente, incorreto, estornado e duplicado; concorrência com
renovação/cancelamento; isolamento de tenant e OWNER; capacidade reservada por
convites; recuperação de timeout/429/500; projeção HQ e preservação de faturas.

Testes somente em banco sintético, com RLS. Lint, TypeScript, testes, build,
PostgreSQL, CI/schema-smoke e Preview antes de promoção. Homologação financeira
externa separada dos mocks; registrar apenas os resultados efetivamente obtidos.
Nenhuma compra de teste em Production.
