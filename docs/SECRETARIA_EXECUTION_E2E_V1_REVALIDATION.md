# Secretária Execution E2E V1 — revalidação e continuação

Data: 25/09/2026. Worktree `.worktrees/service-create-mvp`, branch
`codex/secretary-execution-e2e-v1`, base `9b92138`. Resultado operacional:
**20/20 PASS**, incluindo os dois PASS históricos, que não foram repetidos.
**`SECRETARY_EXECUTION_E2E_V1 = VALIDATED`**.
`STALE_CONFIRMATION_FIX = VALIDATED`. Checks finais PASS, registrados abaixo.
`TOPIC_14_SECRETARY_BRAIN_V1 = COMPLETE` permanece inalterado.

## Revalidação R$80 → R$90 e recuperação pós-commit

Fixture nova: Massagem custa R$100. “Altera a Massagem para R$80” produz
proposal; “Na verdade R$90” mantém o mesmo draft, aumenta revisão do draft e
do plano, troca proposal e hash. A aprovação antiga recebe `CONFIRMATION_STALE`;
a tentativa pelo journal antigo recebe `REVISION_CONFLICT`. Ambas deixam
o preço em R$100, sem receipt de sucesso e sem mutation operacional.

Somente a nova confirmação altera R$100→R$90. Receipt real contém o ID do
serviço e 9000 centavos. Repetição pelo grupo não altera dados; replay pelo
journal retorna `duplicate=true`. Snapshots de todas as tabelas confirmam
zero segunda mutation. Evidência: execução `10-57-30-148Z`, caso 3.

No caso 18, a baixa 10→8 e o receipt commitam na mesma transação. Uma falha
injetada **depois do commit**, em `persistInventoryMetrics`, preserva `DONE`
e receipt; expõe `POST_COMMIT_TELEMETRY_UNAVAILABLE` separadamente. Replay de
grupo e reconciliação pelo journal retornam o mesmo receipt, saldo 8 e um
único `STOCK_ADJUSTED`.

`confirmJournalAction` reautoriza, relê proposal/revisão/hash sob lock e
consulta o registro CONFIRMED **antes** do executor. A regressão offline
`secretary-journal-reconciliation.test.ts` simula resposta perdida depois
da aplicação: a nova chamada relê o receipt, não invoca a mutation outra vez,
e continua negando acesso quando a autorização é revogada. Não foi necessário
criar outra autoridade ou alterar o journal existente.

Somente após os casos 3 e 18 passarem, a continuação foi iniciada automaticamente.
Todas as fixtures posteriores também são novas; nenhuma fixture anterior foi
resetada, reaproveitada ou apagada.

## Arquitetura e escopo implementado

`ActionPlan → grupo/revisão/fingerprint → proposal durável → confirmação
autenticada → executor → withTenant/commit → receipt → resposta determinística`.
Luna não recebe autoridade de confirmação. Nesta bateria, o modelo foi
`ScriptedServicesModel`; nenhuma inferência paga foi necessária.

As autoridades continuam as mesmas do Front: `updateCatalogService`,
`adjustProductStockReliably`, `requestStaffReschedule`,
`cancelAppointmentReliably` e `createVisit`. Proposal, draft, receipt e
auditoria usam o journal existente. Cancel→create usa uma única transação;
ações independentes usam transações próprias. Comunicação persiste Outbox e
despacha exclusivamente pelo `FakeCommunicationProvider`.

Nesta retomada foram alterados apenas harness, regressões, launcher e
documentação. As correções de encaminhamento/invalidação e telemetria em
`salon-secretary.ts` já estavam prontas offline e agora foram comprovadas no
PostgreSQL. Não houve mudança de schema, migrations, RLS, permissões, regras
de negócio, JEV ou cérebro do Tópico 14.

## Placar final por caso

Mutation abaixo é o efeito da Secretária; alterações preparatórias controladas
estão separadas nos snapshots. “Negado”/“sem sucesso” são resultados esperados,
portanto o caso é PASS. `—` significa que não houve execução para repetir.

| Caso | Esperado | Resultado | Mutation | Idempotency | Receipt | Segurança |
| --- | --- | --- | --- | --- | --- | --- |
| 1 · Service A, histórico | R$100→80 | PASS preservado | Só preço/updatedAt | Grupo + journal | Serviço confirmado | PASS |
| 2 · Gate, histórico | Ausente/forjada/revisão/bypass negados | PASS preservado | Zero | — | Sem falso sucesso | PASS |
| 3 · Correção R$80→90 | Aprovação antiga inválida | PASS | Só nova proposta: R$100→90 | Grupo + journal | Serviço R$90 | PASS |
| 4 · Expiração | TTL bloqueia execução | PASS | Zero | — | FAILED_SAFE, sem sucesso | PASS |
| 5 · Estoque C | 10→8, nunca 6 | PASS | Uma baixa de 2 | Double click + replay concorrente | Mesmo receipt_ref | PASS |
| 6 · Agenda B | Amanda 10h→11h | PASS após fix do harness | Só horário/versão/updatedAt + evento/Outbox | Journal | Appointment correto | PASS |
| 7 · Independentes D | Confirmar somente grupo aprovado | PASS | Serviço + estoque; novo serviço em outro grupo | Grupos separados | Mapeados por ação | PASS |
| 8 · Dependência E | Cancelar Amanda e criar Fábio | PASS | A→B no mesmo tx | Journal batch | CANCELLED + CONFIRMED | PASS |
| 9 · Falha transacional | Falha após create desfaz A/B | PASS | Zero após rollback | — | A FAILED_SAFE, B/C bloqueados | PASS |
| 10 · Fan-out F | Cancel→create + mensagem dependente | PASS | Batch + Outbox fake | Replay sem novo despacho | QUEUED, entrega simulada | PASS |
| 11 · TOCTOU | Slot ocupado depois da proposal | PASS | Zero da Secretária | — | FAILED_SAFE, sem sucesso | PASS |
| 12 · Partial failure | A SUCCESS / B FAILED / C SUCCESS | PASS | Só serviços A/C | Replay sem repetir A/C | PARTIAL_FAILURE e receipts A/C | PASS |
| 13 · Papel/tenant | Negar papel e tenant incorretos | PASS | Zero; cross-tenant update count=0 | Autoriza antes do replay | Negado | PASS |
| 14 · Validação | Preço negativo rejeitado | PASS | Zero | — | Nenhuma proposal executável | PASS |
| 15 · Papel revogado | Reautorizar ao executar | PASS | Zero da Secretária | — | FORBIDDEN | PASS |
| 16 · Catálogo stale | Detectar preço concorrente | PASS | Zero da Secretária | — | FAILED_SAFE, mantém R$110 externo | PASS |
| 17 · Provedor fake falha | Preservar commit sem alegar envio | PASS | Batch + Outbox; zero entrega externa | Um intento/uma tentativa fake | QUEUED + delivery FAILED | PASS |
| 18 · Pós-commit | Telemetria não falseia commit | PASS | Estoque 10→8 uma vez | Grupo + journal/reconciliação | Sucesso + aviso técnico | PASS |
| 19 · Overlap | Permissão, motivo, conflito e confirmação | PASS após fix da fixture | Cancel→create overbooked | Chaves do batch | Sucesso + audit de override | PASS |
| 20 · HARD_BLOCK | Fechamento nunca executa override | PASS | Zero da Secretária | — | Sem proposal; PLAN_NOT_READY | PASS |

Placar consolidado: **PASS 20; FUNCTIONAL_FAILURE_SAFE 0; SAFETY_FAILURE 0;
UNKNOWN 0; NOT_EXECUTED 0**. Este é o estado final por caso, não um apagamento
das tentativas anteriores. Histórico preservado: **1 SAFETY_FAILURE** na
primeira tentativa stale, antes da correção; **2 FUNCTIONAL_FAILURE_SAFE** do
harness nesta retomada, corrigidas conforme limite autorizado. Nenhum PASS
foi reexecutado; somente os casos afetados 6 e 19 foram revalidados.

## Duas autocorreções controladas do harness

1. **Diff de AppointmentService (caso 6).** O teste esperava um insert líquido
   e tentava identificar a linha por `id`. O schema usa chave composta
   `(appointmentId, position)`; a autoridade manual apaga/regrava o mesmo
   snapshot durante uma remarcação. Before/after eram exatamente iguais.
   Causa: confusão entre instruções SQL e diff líquido de registros. O teste
   agora exige preservação integral desse snapshot, sem permitir delete,
   insert ou mudança de campo. Regressão reproduz a falha antiga e rejeita
   mudança real de duração. Nenhuma mutation indevida foi constatada.
2. **Consentimento de overlap da fixture (caso 19).** O modelo sintético
   retornava `override_requested=true` para uma frase que não cumpria o
   contrato publicado de grounding. Reproduzido offline:
   `OVERRIDE_INTENT_NOT_GROUNDED`, antes de qualquer execução. A fixture
   passou a dizer explicitamente “Pode encaixar”, preservando o motivo.
   Guard, regex, permissões e expected de segurança não mudaram. O caso
   HARD_BLOCK usa a mesma entrada válida para comprovar o bloqueio do domínio.

Total: **2 novos bugs independentes, ambos no harness; 0 novos bugs de
produto**. Não houve terceiro bug operacional nem ampliação de escopo.
Regressões direcionadas: 28 PASS inicialmente; observador corrigido 9 PASS;
observador/consentimento + T21 30 PASS.

## Mutations, atomicidade e isolamento

Ambiente único: PostgreSQL 16 local, `127.0.0.1:55441/everflair_service_mvp`,
cluster `everflair-service-mvp-dumpcheck-20260924-uxbaseline/data`. Runtime
`mvp_service_runtime` sem SUPERUSER/BYPASSRLS, 19 tabelas RLS/FORCE verificadas.
Probes positivos de leitura no tenant e zero visibilidade sem contexto;
papel negado, tenant falso e outro tenant real foram testados. Nenhum grant,
policy ou autenticação foi alterado.

A retomada inteira, incluindo fixtures dos dois testes corrigidos, adicionou
25 tenants sintéticos (20 fixtures de tentativas + 5 sentinelas), 50 usuários,
50 memberships/clientes/produtos, 25 profissionais, 50 vínculos e 175 jornadas.

Mutations operacionais confirmadas: 3 mudanças de preço, 2 serviços novos,
3 baixas de estoque, 2 remarcações de horário (caso 6 antes/depois do fix do
harness), 4 cancelamentos e 4 novos agendamentos dependentes. Replays não
produziram segunda mutation. Preparações concorrentes controladas: três
appointments adicionais, um ajuste de estoque para 1, um preço para R$110,
uma revogação de papel e um fechamento de salão. Todas estão identificadas
como `controlled-*` nos snapshots.

Contagens globais antes/depois da retomada:

| Tabela | Antes | Depois | Explicação |
| --- | ---: | ---: | --- |
| Appointment | 85 | 117 | 25 fixtures + 3 concorrentes + 4 criações confirmadas |
| AppointmentService | 85 | 114 | 25 fixtures + 4 criações; remarcação preserva snapshot |
| AppointmentEvent | 0 | 10 | 2 remarcações + 4 pares cancel/create |
| Service | 404 | 456 | 50 fixtures + 2 criações confirmadas |
| Product | 140 | 190 | 50 fixtures; baixas alteram saldo, não criam linhas |
| AuditLog | 991 | 1200 | 209 registros técnicos/operacionais, com tenant/actor |
| NotificationOutbox | 0 | 22 | 20 eventos da agenda + 2 comunicações fake |

No rollback injetado depois de `createVisit`, cancelamento, criação, eventos,
Outbox e receipt foram todos desfeitos. O appointment original ficou
exatamente igual à baseline. A criação dependente e a mensagem ficaram
`BLOCKED_BY_DEPENDENCY`; provedor não chamado. Para independentes, A/C
commitam e B falha com segurança; plano final `PARTIAL_FAILURE`, nunca DONE.

Disponibilidade foi revalidada após um concorrente ocupar 11h. Catálogo e
papel também foram alterados de forma controlada entre proposal e confirmação,
com execução negada. Overlap confirmou `isOverbooked=true`, reason exata,
`APPOINTMENT_OVERRIDE_CREATE`, actor e `SLOT_TAKEN`. Fechamento resultou em
`CONFLICT_HARD_BLOCK`, sem proposal e sem execução.

## Receipts, auditoria e evidência durável

Receipts vêm exclusivamente do executor. Serviços relacionam proposal/draft
ao ID e preço final; estoque inclui receipt_ref/saldo; batch lista key,
operation, appointment_ref e outcome por ação. ActionPlan relaciona os
resultados a action keys; AuditLog do plano preserva plan_ref. Antes aparece
na proposal/snapshot, depois no receipt e leitura independente. Journal
CONFIRMED comprova tenant, actor, timestamp, revisão e proposal correspondente.
Não foi inventado um novo contrato de receipt.

Falhas esperadas têm status/issue e ausência de receipt de sucesso; mensagens
conversacionais e resultados por ação foram persistidos. `QUEUED` significa
intenção no Outbox, não entrega real: o cenário de falha fake mantém
`delivery.status=FAILED`, `external_delivery=false` e mensagem correspondente.

Raiz de evidências: `packages/salon-secretary/evaluation/results/execution-e2e/`.

| Diretório UTC | Conteúdo |
| --- | --- |
| `2026-09-25T10-28-23-287Z` | Histórico: 2 PASS e incidente stale original |
| `2026-09-25T10-57-30-148Z` | Revalidação 3/18, ambos PASS |
| `2026-09-25T10-57-40-089Z` | 4/5 PASS; diagnóstico do observador no 6 |
| `2026-09-25T10-59-25-615Z` | Revalidação isolada 6 PASS |
| `2026-09-25T10-59-32-430Z` | 7–17 PASS; entrada de consentimento inválida no 19 |
| `2026-09-25T11-01-19-557Z` | Revalidação 19 e caso 20 PASS |

`consolidated-evidence.json` indexa 290 arquivos JSON/log por SHA-256,
histórico de tentativas, placar, latências e hashes de dez dumps da retomada.
Cada fase tem preflight, dump anterior, baseline global, baseline por tenant
com IDs/valores, proposal, pedidos de confirmação com revisão/fingerprint,
respostas/erros, observações antes/depois, AuditLogs, resultados Vitest e
dump final. Observações são salvas **antes** de verificar os efeitos, para
preservar evidência mesmo se o observador falhar. Escrita usa `fsync`.

SHA-256 do dump anterior à revalidação:
`b54d500b1659c6888842bb77ed8c41737b26c6ca68c45ae51bc96e40869adf52`.
SHA-256 do último dump:
`a1716965f62fbf1d5d7a2fa80417a681a46cb280c40242ddcab32a6d35a0fe4b`.
Todos passaram por `pg_restore -l` e reconferência SHA-256. Cada fase confirmou
preservação integral das linhas da baseline anterior; as fixtures históricas,
inclusive a do incidente R$80, permanecem intactas. Dumps não foram restaurados.

## Checks finais, custo e limitações

| Comando | Resultado |
| --- | --- |
| Bateria PostgreSQL selecionada por manifest | 20 casos PASS consolidados; 2 históricos não repetidos |
| `npm test -- --maxWorkers=2` | 2.529 testes / 282 arquivos PASS, 175,81 s |
| `npm run lint` | PASS, exit 0 |
| `npx tsc --noEmit --incremental false` | PASS, exit 0 |
| `npm run build` | PASS, exit 0; Next.js 15.5.25 |

Suíte geral exclui integrações `.integration.test.ts`; a bateria PostgreSQL
foi executada separadamente. A suíte cobre ActionPlan, drafts/grupos, Tools,
seis Skills, Scheduling, Communication, Router, idempotência e guards. RLS e
tenant isolation foram também verificados no banco real descartável.
Logs: `results/execution-final-{tests,lint,tsc,build}.log`.

A primeira tentativa de build encontrou DLL do Prisma em uso pela suíte
concorrente no Windows (`EPERM`). Após o encerramento dos testes, o build
isolado passou; log inicial preservado em `execution-build-dll-lock.log`.
Não foi necessária mudança de produto. Build usou fonte mock local,
NextAuth sintético, flags OFF e banco loopback inacessível na porta 1.
Não houve schema-smoke remoto: nenhuma alteração de schema neste delta,
nenhum push nem CI/Preview autorizado.

Não houve Luna real: **paid calls=0, custo US$0**, sem latência de inferência
real a reportar. Casos locais aprovados da retomada duraram aproximadamente
0,59–2,62 s por caso, incluindo fixture/observações; não é benchmark de produção.

Esta prova cobre o coordenador/backend/PostgreSQL local, com interpretações
scriptadas e provedor fake. Não cobre UI, voz, Meta, entrega externa nem carga
de produção. Sessões/grupos permanecem em memória; após restart, falham
fechado e a reconciliação durável usa a mesma proposal no journal. A perda de
resposta foi simulada offline; em PostgreSQL foi comprovado o erro técnico
pós-commit e replay real. Não foi injetada perda física de conexão durante COMMIT.

## Rollback e flags

Banco e dumps preservados; nenhuma limpeza/reset. Reverter código exige
apenas o delta deste Gate, preservando o trabalho anterior não commitado.
Backups anteriores em `results/execution-source-before/*.txt`. Não restaurar
dump sobre este banco automaticamente; eventual restauração deve usar outro
destino descartável identificado.

Flags finais de paid calls, JEV Router, Multi-Action V2 e overlap: **false**.
V2 foi ativado apenas por injeção no harness; overlap apenas dentro dos casos
19/20, restaurado após cada teste. Billing/pagamentos/email desabilitados no
processo. `.env.local` não mudou: SHA-256
`7548c4ec20d910575fe635e03c9e3e067fd8187741752630ac481909b7b1a5d8`.
Zero produção, envio externo, pagamento, push, PR, CI remoto ou deploy.
Front, Voice e Meta não foram iniciados.

## Arquivos deste delta e próxima fase

- `scripts/run-secretary-execution-revalidation.cjs`: liberação específica do
  incidente histórico, revalidação 3/18 e continuação automática condicionada.
- `scripts/run-secretary-execution-e2e.cjs`: resultado Vitest JSON e dump final
  por fase, mantendo preflight, sanitização e parada após falha.
- `src/lib/__tests__/secretary-execution-e2e.integration.test.ts`: seleção por
  IDs do manifest, fixtures novas, evidência durável de confirmação/resultado,
  revalidação stale completa, reconciliação e correções dos dois erros do harness.
- `src/test/secretary-execution-evidence.ts`: persistência com fsync.
- `src/lib/__tests__/secretary-execution-evidence.test.ts`: duas regressões
  adicionais para chave composta/consentimento, total 10 testes.
- `src/lib/__tests__/secretary-journal-reconciliation.test.ts`: regressão de
  resposta pós-commit perdida, replay autoritativo e reautorização.
- Documentação de resultado, histórico, status canônico e plano seguinte.

O restante do worktree, inclusive código do Tópico 14, precede esta retomada.
Não foi feito commit do conjunto heterogêneo nem publicação automática.

Próxima fase somente planejada em
[SECRETARY_FRONT_VOICE_UX_V1.md](./SECRETARY_FRONT_VOICE_UX_V1.md).
**SECRETARY_EXECUTION_E2E_V1 = VALIDATED. PARE: implementação da próxima fase
depende de novo pedido; nenhuma ação Front/Voice/Meta/deploy neste Gate.**
