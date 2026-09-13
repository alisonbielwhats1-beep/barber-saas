# Troca de planos — 13/09/2026

Implementação solicitada pelo responsável após a publicação do PR #101.
Branch `codex/mercadopago-plan-changes`. Ainda não publicada nem habilitada.

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
- Uma troca confirmada pendente por salão, com índice único e lock por tenant.
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

Em 13/09, 60 testes PostgreSQL passaram no banco sintético isolado
`billing_changes_full_20260913`, com as migrations reais 023/024/025 e runtime
sem BYPASSRLS. Incluem todas as 12 combinações de aumento entre os quatro planos
nos dois ciclos, upgrades sucessivos, pagamento duplicado, estorno, recuperação
de POST/PUT perdido, cotação/OWNER/tenant, invitação pendente e renovação agendada.
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

Compra completa de upgrade no provedor e autorização do ciclo futuro ainda
dependem da sessão do comprador fictício. CI/Preview e publicação ainda
pendentes. Resultados de testes simulados não comprovam uma cobrança externa.

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
