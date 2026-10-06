# Secretária — Execution E2E V1

> **Registro histórico da primeira tentativa e da correção offline.** A
> revalidação autorizada e a continuação posterior estão documentadas em
> [SECRETARIA_EXECUTION_E2E_V1_REVALIDATION.md](./SECRETARIA_EXECUTION_E2E_V1_REVALIDATION.md).
> Os resultados abaixo são preservados como evidência daquela tentativa;
> não representam o placar atual do Gate.

Gate local iniciado em 25/09/2026. `TOPIC_14_SECRETARY_BRAIN_V1 = COMPLETE`
preservado. Sem Front, Voice, Meta, deploy ou inferências pagas.

## Auditoria anterior à implementação

Base encontrada em `.worktrees/service-create-mvp`, HEAD `9b92138`, com o
Tópico 14 ainda não commitado. Branch deste Gate: `codex/secretary-execution-e2e-v1`.
`origin/master` conferido por fetch; quatro commits à frente da base. Não se
misturaram essas mudanças com a base local. Nenhum push: poderia iniciar Preview.

| Camada | Contrato existente |
| --- | --- |
| Intenção | SDK interpreta; não recebe confirmação nem autoridade para executar |
| ActionPlan V2 | DAG, grupos, revisão e fingerprint; autorização revalidada pelo coordenador |
| Proposal | Registro append-only em AuditLog, UUID, revisão, hash de payload e expiração |
| Confirmation | `confirmActionPlanGroup(plan_ref, revision, group_key, fingerprint)`; filhos bloqueados fora do grupo |
| Executor | `confirmJournalAction`: autoriza, localiza proposal tenant/actor-scoped, lock de draft, revisão/hash, replay, TTL, executor e receipt |
| Services | Front e Secretária chamam `updateCatalogService`; snapshot usa xmin e lock da linha |
| Inventory | Front e Secretária chamam `adjustProductStockReliably`; lock, saldo, auditoria e snapshot revalidado |
| Scheduling | `requestStaffReschedule`, `cancelAppointmentReliably`, `createVisit`; mesmas autoridades da agenda |
| Transação | `withTenant` abre transação/GUC; receipt e mutation no mesmo commit |
| Dependência atômica | `confirmActionBatch` executa cancel→create no mesmo tx; falha propaga rollback |
| Independentes | Cada unidade tem transação própria; falha não desfaz irmãos já confirmados |
| Communication | Outbox transacional; despacho posterior exclusivamente `FakeCommunicationProvider`, idempotente |
| Conversação | Mensagens determinísticas derivadas do receipt; texto livre do modelo não é comprovante |

Já existem integrações de domínio e testes V2 com doubles. Falta evidência
integrada dos grupos V2 com PostgreSQL, preservação global da baseline e matriz
consolidada deste Gate. Não se criarão operações paralelas de negócio.

Ponto de investigação: métricas e registro do plano são escritos após o commit
de negócio. Uma falha técnica nesse ponto deve preservar o resultado confirmado.
A sessão/grupo continua volátil; replay durável é por proposal no journal.

## Ambiente e limites

Somente banco sintético `everflair_service_mvp`, `127.0.0.1:55441`, cluster
`everflair-service-mvp-dumpcheck-20260924-uxbaseline/data`. Runtime
`mvp_service_runtime`, sem SUPERUSER/BYPASSRLS. Preflight, dump, SHA-256,
RLS/FORCE e probes de isolamento obrigatórios antes da bateria.
Fixtures novas exclusivas; histórico anterior preservado. Rede externa bloqueada.
Resultados e snapshots locais em `packages/salon-secretary/evaluation/results/`.

## Resultado

**`SECRETARY_EXECUTION_E2E_V1 = NOT_VALIDATED` — STOP no caso de confirmação
obsoleta.** Foram 2 casos PASS, 1 FAIL e 17 não executados. O runner encerrou
imediatamente (`--bail=1`). Após a parada, somente diagnóstico/correção offline,
checks de código e captura/backup somente leitura. Nenhuma segunda bateria real.

## Incidente e autocorreção

1. Caso A: Massagem R$100→R$80, confirmação por grupo, receipt e replays PASS.
2. Gate: entradas ausentes/forjadas/revisão incorreta e bypass do filho bloqueados.
3. Correção: “Na verdade R$90.” foi ignorada, porque `sendActionPlanTurn` só
   encaminhava mensagens a unidades com campos faltantes. A unidade única
   READY_FOR_CONFIRMATION não era selecionada; revisão, draft e proposal
   antigos continuavam válidos. A confirmação antiga executou R$80.

Isso é uma falha real da invalidação da confirmação. Não foi escrita sem
invocar a confirmação, nem alteração para R$90 sem proposal; foi execução de
uma intenção antiga que já deveria ter sido revogada. O observador independente
acusou a alteração inesperada na fixture e interrompeu a bateria. Condição de
parada da seção 27 do pedido aplicada; não se classificou como PASS.

Fonte corrigida: `src/lib/salon-secretary.ts`. Uma única unidade pronta e
ainda não executada pode receber correção pelo caminho de draft já existente;
a revisão do grupo muda antes de interpretar, e a proposal é refeita pelo
backend. Nenhum parser, prompt, permissão, RLS ou regra de negócio foi alterado.
Teste offline reproduziu o problema e passou após o fix, conferindo o mesmo
draft, o preço corrigido, recusa da aprovação antiga e execução apenas da nova.
A resposta sintética de continuação foi também completada com os campos
nullable exigidos pelo schema publicado; expected e assertions não relaxados.

Outro bug reproduzido antes da bateria: falha do registro técnico do plano
após commit propagava erro apesar de receipt confirmado. A correção separa
telemetria pós-commit do resultado operacional e expõe
`execution_warnings=[POST_COMMIT_TELEMETRY_UNAVAILABLE]`. O journal CONFIRMED
e a auditoria de negócio permanecem obrigatórios na transação. O mesmo cuidado
cobre métricas de Inventory, Scheduling, batch e Communication. Regressão
offline PASS; o caso PostgreSQL dessa correção não chegou a executar.

**As correções não foram revalidadas em PostgreSQL após o STOP.** Não se
reabriu o Tópico 14 nem se reexecutou x90–x94. Não se autoriza execução pelo
texto “sim”: confirmação continua sendo uma chamada autenticada separada.

## Matriz da entrega (25 itens)

| # | Entrega | Evidência/estado deste Gate |
| --- | --- | --- |
| 1–2 | Arquitetura e existente | Mapeados na auditoria acima; autoridades compartilhadas confirmadas por código |
| 3 | Implementado | Harness local, preflight/dump, observador exato, 20 casos E2E, regressões e duas correções determinísticas |
| 4 | Confirmation flow | Grupo real executou A; entradas inválidas e bypass bloqueados no caso 2 |
| 5 | Stale confirmation | FAIL real; causa e fix offline comprovados; revalidação real pendente |
| 6 | Idempotência | Grupo e journal de serviço PASS; estoque/concorrência preparados, não executados |
| 7 | service.change | PASS: R$100→R$80, só preço e updatedAt, demais registros preservados |
| 8 | Appointment | Caso 10h→11h preparado, não executado |
| 9 | Inventory | Caso 10→8/double click/retry preparado, não executado |
| 10 | Multi-action | Grupos 2+1 preparados; regressão offline existente; E2E não executado |
| 11 | Dependencies | cancel→create e fan-out message preparados, não executados |
| 12 | Atomicity | Injeção de falha após create para provar rollback de A/B/eventos/Outbox/receipt preparada, não executada |
| 13 | Partial failure | A SUCCESS/B FAILED/C SUCCESS preparado, não executado |
| 14 | Permissions | Preflight/runtime restrito PASS; casos de papel/revogação/cross-tenant preparados, não executados |
| 15 | Receipts | Receipt de serviço real persistido, ligado à proposal/draft e conferido por leitura; demais pendentes |
| 16 | AuditLogs | Caso A confirmou tenant, actor, timestamp, proposal/draft e referência de plano; antes na proposal, depois no receipt |
| 17 | Snapshots | 63 tabelas observadas; hashes antes/depois por etapa, dumps antes/depois do STOP; linhas históricas preservadas |
| 18 | Testes novos | 20 E2E preparados; 8 testes do observador e 2 regressões de runtime adicionados |
| 19 | Suíte geral | Resultado final registrado abaixo; não inclui `.integration.test.ts` |
| 20 | Lint/TS/build | Resultado final registrado abaixo |
| 21 | Bugs | Correção ignorada em unidade pronta; erro técnico pós-commit falseava o resultado; ambos corrigidos offline |
| 22 | Limitações | 17 E2E não executados; correção stale sem revalidação real; grupos/sessões voláteis, idempotência durável por proposal |
| 23 | Rollback | Flags OFF, delta de fonte preservado em backup; não restaurar/apagar banco nem histórico automaticamente |
| 24 | Flags | V2/overlap/paid/JEV OFF; `.env.local` com hash idêntico ao fechamento x94 |
| 25 | Veredito | NOT_VALIDATED; execução suspensa pela condição de parada do responsável |

Overlap e HARD_BLOCK têm casos preparados usando o adapter manual publicado;
não foram executados. A falha fake de comunicação e a revalidação de slot,
catálogo e papel também estão preparadas. Nenhuma dessas linhas é uma alegação
de aprovação PostgreSQL.

## Evidências locais e mutations observadas

Diretório (ignorado pelo Git):
`packages/salon-secretary/evaluation/results/execution-e2e/2026-09-25T10-28-23-287Z/`.

- `preflight.json` / `database-preflight.json`: identidade, runtime restrito,
  dump verificado e 19 tabelas com RLS/FORCE; probe positivo no tenant
  sentinela e zero Product visível sem contexto.
- `global-baseline.json`, `case-*-baseline.json`, `case-*-*.json`:
  hashes SHA-256, contagens e diferenças dos registros sintéticos por etapa.
- `case-1-receipts.json`: resultado, confirmação persistida e audit do plano.
- `incident-readonly.json`: Service e dez AuditLogs da fixture do caso 3;
  preço persistido 8000, mesmo draft revisão 1 e mesma proposal antiga.
- `global-final.json`: todas as linhas da baseline anterior preservadas;
  zero chamadas externas e flags finais OFF. Isso não apaga a falha da fixture.
- `test.log`: 2 PASS, 1 FAIL; parada antes dos 17 casos restantes.

Dump antes das fixtures: SHA-256
`735374e76118bc1537a849ee4b1489f3b98afbb4ce2751c0ed4532c27f97e002`.
Dump somente leitura após STOP: SHA-256
`1bd73d19a96f4f064fcbfb3b425ec51447abd2beee5575893e98541d21b16679`.
`.env.local`: SHA-256
`7548c4ec20d910575fe635e03c9e3e067fd8187741752630ac481909b7b1a5d8`,
igual ao fechamento anterior x94.

Preparação: quatro tenants novos (sentinela + três casos), oito usuários,
oito memberships, oito clientes, oito serviços, oito produtos, quatro
profissionais, oito vínculos, 28 jornadas, quatro appointments e quatro
snapshots de serviço. Durante os casos: **duas alterações de preço** (caso A
esperada; caso stale indevida) e 26 AuditLogs técnicos/operacionais no total.
AuditLog 965→991; Outbox e pagamentos inalterados. Nenhum histórico anterior,
tenant alheio, schema, migration, RLS ou grant foi modificado.

O launcher possui trava persistente `execution-e2e/STOP.json` e não tem opção
de bypass. A retomada exige revisão/liberação explícita da parada; não basta
repetir o comando nem transformar o resultado antigo em aprovação.

## Checks finais

| Comando | Resultado final |
| --- | --- |
| `npm test -- --maxWorkers=2` | PASS: 2.526 testes, 281 arquivos, 150,93 s |
| `npm run lint` | PASS, exit 0 |
| `npx tsc --noEmit --incremental false` | PASS, exit 0 |
| `npm run build` | PASS, exit 0, Next.js 15.5.25 |
| `node scripts/run-secretary-execution-e2e.cjs` | STOP/exit 1: 2 PASS, 1 FAIL, 17 não executados |

Build usou fonte simulada local e segredo NextAuth sintético somente no
processo, com flags OFF e URL de banco loopback deliberadamente inacessível
(porta 1). Não dependeu de banco produtivo nem autorizou deploy. Logs em
`results/execution-{suite,lint,types,build}-final.log`.

A primeira suíte geral encontrou a nova regressão stale ainda vermelha
(2.525 PASS/1 FAIL); após correção, a suíte final passou integralmente.
Uma checagem TypeScript intermediária incluiu backups `.ts` como fontes;
os backups foram renomeados para `.ts.txt`, sem alterar o código preservado.
A checagem final está limpa. Resultados de erro não foram apagados.

Não houve CI remoto/schema-smoke: nenhuma mudança de schema e nenhum
push/PR, evitando deploy de Preview. Regressões offline incluem ActionPlan,
drafts/grupos, seis Skills, Scheduling/Communication, Router e idempotência;
isso não substitui as integrações de banco suspensas.

## Arquivos deste delta

- `src/lib/salon-secretary.ts`: encaminhamento da correção em unidade única
  pronta, invalidação pelo caminho existente e resultado pós-commit preservado.
- `src/lib/__tests__/secretary-action-plan-runtime.test.ts`: duas regressões
  reproduzidas antes do fix e aprovadas depois.
- `src/lib/__tests__/secretary-execution-e2e.integration.test.ts`: 20 cenários
  para o coordenador real e PostgreSQL, sem mock das operações de negócio;
  somente modelo/provedor fake e injeções explícitas de falha nos cenários próprios.
- `src/test/secretary-execution-evidence.ts`: snapshot independente das 63
  tabelas, hashes e allowlist exata de linhas/colunas/quantidades.
- `src/lib/__tests__/secretary-execution-evidence.test.ts`: 8 verificações do
  observador, incluindo cross-tenant, campo indevido, delete e insert inesperados.
- `scripts/run-secretary-execution-e2e.cjs`: ambiente exclusivamente local,
  dump obrigatório, sanitização do ambiente e trava persistente após falha.
- `docs/SECRETARIA_EXECUTION_E2E_V1.md` e `docs/STATUS_ATUAL.md`: entrega,
  incidente, limites e registro canônico.

Todo o restante mostrado por `git status` precede este Gate. Não há commit,
push ou PR deste delta; não publicar o worktree inteiro como se fosse só ele.

## Rollback e próxima ação

O dump e as fixtures são preservados para inspeção. Não houve reset, remoção
ou restauração após a falha. Para reverter código, comparar apenas o delta
deste Gate com `results/execution-source-before/*.txt`, preservando todo o
trabalho anterior não commitado. Manter flags OFF e descartar sessões em
memória; não reutilizar confirmações antigas. Qualquer restauração de banco
exige destino descartável explicitamente identificado e uma decisão própria.

Próxima ação técnica: revalidar primeiro o caso stale corrigido em fixture
nova; depois executar os 17 restantes, mantendo a evidência original FAIL.
**FRONT + VOICE UX não foi iniciado e seu plano não foi liberado**, pois o
pedido condiciona essa preparação à validação do Gate. Meta e deploy seguem
fora do escopo. `TOPIC_14_SECRETARY_BRAIN_V1 = COMPLETE` preservado.
