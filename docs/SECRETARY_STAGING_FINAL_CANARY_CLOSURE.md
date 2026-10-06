# Secretária — fechamento staging e canário condicionado

## Atualização — 26/09/2026, 00:45 BRT

O fechamento histórico abaixo permanece registrado. A bateria subsequente de
áudio automatizado foi **NOT_VALIDATED**, com STOP de segurança: "domingo"
produziu proposal executável para sábado, 03/10, sem confirmation enviada.
Zero mutation inesperada; staging novamente OFF e reconciliado. Production não
acessada. Regressão local mais recente: 2.642 PASS/290 arquivos, lint, TS e build
PASS. Teste físico continua REQUIRES_HUMAN_VALIDATION, sem espera por fala humana
nesta rodada. [Relatório completo e bloqueios](./SECRETARY_AUTOMATED_VOICE_V1.md).

## Estado atual — 25/09/2026, 21:15 BRT (26/09, 00:15Z)

**SECRETARY_STAGING_OPERATIONAL = VALIDATED.** Staging final, HARD_BLOCK,
desligamento, isolamento, observabilidade e regressão concluídos. A próxima
etapa depende de informar aparelho físico, sistema operacional e navegador.
Produção NÃO acessada nesta retomada; nenhum audit/deploy/canary produtivo.

Marcos preservados:

- TOPIC_14_SECRETARY_BRAIN_V1 = COMPLETE
- SECRETARY_EXECUTION_E2E_V1 = VALIDATED
- SECRETARY_FRONT_VOICE_UX_V1 = VALIDATED
- REAL_DEVICE_VOICE_V1 = NOT_VALIDATED
- SECRETARY_STAGING_REAL_DEVICE_PILOT_READINESS = NOT_VALIDATED
- READY_FOR_CONTROLLED_PILOT = NO

### Candidato e escopo

Retomada no checkout existente, branch `codex/secretary-final-staging-canary`;
HEAD `9b92138ec7665342b60e1ddc210f04ccfa611c84` mais candidato não commitado.
Os **1.281 arquivos** do manifest da release foram comparados por SHA-256 com
a fonte local testada: **zero diferença**. Manifest
`806223edd36bb72e38a10a4ff2d3ea87be1bb998c0d19f1dd21da608a0ecdf54`,
BUILD_ID remoto `XYqNZnD8YqIYPSOKdaUWB`. Nenhum código do produto foi alterado
nesta retomada. Foram usados apenas harnesses de verificação e documentação.

`git fetch origin master` PASS; referência observada
`a663bdbd3a40d9d5e39ab8de0c3a801125755c49`. Não houve merge/promoção dessa
referência nem PR deste fechamento. Integração, CI e candidato imutável exato
continuam obrigatórios antes de promoção, após o gate físico.

### HARD_BLOCK reconciliation — PASS

Executado `closure-observe.cjs proposal hard-block`, resultado às
`2026-09-25T23:56:26.450Z`. Comparação dos 62 conjuntos de linhas: **zero
mutation de negócio e zero alteração indireta**. Somente seis AuditLogs
técnicos previstos, todos do tenant A/owner A: MODEL_CALL_STARTED,
MODEL_CALL_FINISHED, SKILLS_LOADED, OPERATIONS_PREPARED, DIRECT_LUNA e DRAFT.
Zero confirmação enviada neste caso, zero CONFIRMED/proposal/override.

Plano `7e5a9df1-dc71-4909-9bb3-b6be16aeaf57`, revisão 2, ação
`agendamento_fabio`: DOMAIN_CONFLICT, avaliação BACKEND, sem proposal_ref,
grupo NEEDS_REVIEW e Confirmar desabilitado na UI previamente observada.
O fechamento de 27/09 cobre o horário solicitado; o preview pede outro horário,
sem inventar disponibilidade. `dependencies`/`depends_on` vazios e preservados;
nenhuma ação dependente executada. Este caso isolado não prova uma cadeia
dependente nova; a cobertura automatizada existente permaneceu PASS.

STAGING_HARD_BLOCK = PASS.

### Final OFF e isolamento — PASS

Preflight repetido contra DB `everflair_billing_staging`, system ID
`7682424799483236389`, diretório `/var/lib/postgresql/data`, runtime
`app_runtime` sem SUPERUSER/BYPASSRLS. Redis `redis-http`/`redis:6379` interno.
RLS/FORCE/policies preservados. Leitura tenant-scoped A/B e ausência de contexto
verificadas em Appointment, Product, Service, ClientProfile, AuditLog e
NotificationOutbox. Nenhum uso do Preview Vercel compartilhado.

Treze probes autenticadas no mesmo candidato: uma abertura admitida sem
inferência; seis recusas para owner B/recepcionista A; três recusas após remover
owner A da admissão; três recusas com flag global OFF. Mensagem em conversa
existente e confirmation já existente foram bloqueadas após remoção.
Admissão ausente retorna SECRETARY_NOT_AVAILABLE; global OFF retorna a recusa
BACKEND_FAILURE do contrato atual, com `ok:false`. HTTP 200 de Server Action
não foi tratado como autorização. Comparação integral before/after: **62
tabelas idênticas**, nenhum AuditLog novo ou chamada paga nova nos controles.

Configurações privadas ON/OFF foram arquivadas e ambas regravadas OFF; chave,
project e preload de paid calls retirados das configurações ativas. Sete flags
false: ENABLED, FRONT_ENABLED, VOICE_ENABLED, ALLOW_PAID_CALLS,
JEV_ROUTER_ENABLED, MULTI_ACTION_V2_ENABLED e SCHEDULING_OVERLAP_ENABLED
(todas com prefixo `SALON_SECRETARY_`). `allowed_actors=[]`.

UI de Serviços autenticada verificada sem entrada da Secretária, com Massagem
R$100. Runtime encerrado às `2026-09-26T00:04:15.598Z`: porta 3001 livre;
tentativas de mensagem e confirmação deram conexão recusada. Demo 3000
preservada. O runtime permanece desligado enquanto aguardamos o aparelho.

### Observabilidade e custos — PASS

80 AuditLogs pertencem somente ao tenant A/owner A. Dez pares STARTED/FINISHED
com status SUCCEEDED, request/response/call/run/session IDs e usage disponível;
dez registros DIRECT_LUNA, zero retry, zero JEV. Duas continuações usam sessão
filha, ligada ao pai por `OPERATIONS_PREPARED.operations[].operation_ref`.
O harness inicialmente supôs igualdade direta entre os IDs; BEFORE preservado
e join corrigido usando essa relação explícita já auditada, sem mudar produto
ou aceitar correlação apenas por proximidade temporal.

As cinco confirmações operacionais foram ligadas a proposal/draft/revisão,
ActionPlan/ação, estado DONE e entidade correta. Estoque possui receipt_ref;
Serviços/Agenda usam proposal_ref e entidade para ligar recibo e auditoria.
Receipts e refresh visual estão comprovados nos casos operacionais anteriores.
Latência do router: 1.526,91–7.096,35 ms; HTTP do provider: 1.468,20–6.971,74 ms.
Não há medição numérica de latência do refresh visual nem de STT físico.

Usage agregado das mesmas dez chamadas: input 27.407; output 3.150; total
30.557; cached input 14.675; cache write 10.597; reasoning 1.222 (subconjunto
do output, não somar novamente). São as três chamadas iniciais mais sete da
continuação operacional anterior, **zero nova chamada paga neste fechamento**.

| Custo | Registro |
|---|---|
| STAGING_COST | Estimativa conservadora do journal: US$0,005000875; dez tentativas/dez sucessos, limite preservado de 20 |
| REAL_DEVICE_COST | 0; NOT_EXECUTED |
| PRODUCTION_CANARY_COST | 0; NOT_EXECUTED |
| Fatura real | NOT_QUERIED; a estimativa não é valor faturado |

### Timeout e regressão final — PASS

Falha anterior preservada em `staging-closure-tests.log`: 2.635 PASS + um
timeout, 5.433 ms para limite de 5.000 ms no teste de fronteira de imports em
`src/lib/__tests__/jev-evaluation.test.ts:200`. Classificação **FLAKE de
temporização**: varredura síncrona local, sem assert falhando, sem provider/DB;
mesma fonte e mesmo timeout passaram isoladamente e depois na suíte completa.
O mecanismo exato da lentidão inicial não foi demonstrado; não afirmar causa
específica de infraestrutura. Nenhum timeout, expected ou regra foi alterado.

| Comando | Resultado desta execução |
|---|---|
| `npm test -- --maxWorkers=2 src/lib/__tests__/jev-evaluation.test.ts -t 'only Router V1 imports audited pure primitives'` | exit 0; 1 PASS, 78 skipped; 1 arquivo; 33,09 s total |
| `npm test -- --maxWorkers=2` | exit 0; **2.636 PASS / 288 arquivos**, 167,92 s; início 21:04:40 BRT |
| `npm run lint` | exit 0; sem diagnósticos |
| `npx tsc --noEmit --incremental false` | exit 0; sem diagnósticos |
| `npm run build` | exit 0 via `node scripts/build-secretary-front-local.cjs`; compilação 38,0 s, 61 páginas estáticas |

O wrapper de build executa literalmente `npm run build` com flags OFF, sem
credenciais válidas, DB deliberadamente inalcançável e fonte Google fixture;
nenhum acesso produtivo. O aviso de compatibilidade futura do config loader
do Vite não afetou exit/status. Os números do isolado NÃO foram somados à suíte.
Logs `packages/salon-secretary/evaluation/results/staging-final-{full-tests,
timeout-isolated,lint,typescript,build}.log`; correspondência de fonte em
`staging-final-source-match.json`.

### Resultado e próximo checkpoint

| Critério | Resultado |
|---|---|
| Staging final | PASS |
| HARD_BLOCK reconciliation | PASS |
| Final OFF | PASS |
| Regression | PASS |
| Real-device STT | NOT_EXECUTED; aparelho/OS/navegador pendentes |
| Voice multi-turn | NOT_EXECUTED |
| Pilot readiness | NO |
| Production audit | NOT_EXECUTED |
| Production deploy OFF | NOT_EXECUTED |
| Production health | NOT_EXECUTED |
| Canary isolation | NOT_EXECUTED em Production; PASS no staging |
| Read-only smoke | NOT_EXECUTED em Production |
| Controlled mutation | NOT_EXECUTED em Production |
| Idempotency | PASS no staging; NOT_EXECUTED em Production |
| Final reconciliation | PASS no staging; NOT_EXECUTED em Production |
| Safety | PASS; SAFETY_FAILURE=0, UNEXPECTED_MUTATIONS=0 |

Agenda, Produtos, Serviços, receipts, refresh, stale, replay, multi-action,
HARD_BLOCK, tenant isolation, RLS/FORCE, observabilidade, OFF e regressão PASS.
Estado sintético final: Amanda 26/09 às 11h, Massagem R$100, Shampoo X 10 un;
um AppointmentEvent e duas notificações INTERNAL previstos, zero efeito externo.
Não houve mutation operacional nesta retomada final.

Evidências privadas remotas no diretório citado abaixo, incluindo
`closure-hard-block-result.json`, `final-controls-result.json`,
`final-controls-stop-result.json`, `final-off-ui.txt`,
`final-observability-result.json` e snapshots. Resumo sanitizado e hashes em
[SECRETARY_STAGING_FINAL_EVIDENCE.json](./SECRETARY_STAGING_FINAL_EVIDENCE.json).

Próximo passo: receber aparelho/OS/navegador; preparar janela de voz somente no
staging e entregar URL/instruções exatas. Exigir STT, mesma conversa/ActionPlan,
edição de transcript e proposta visual. Não declarar READY antes disso.

## Histórico preservado — checkpoint anterior interrompido

O texto abaixo descreve o checkpoint anterior e foi superado pelas evidências
datadas acima. A autenticação voltou a funcionar nesta retomada; não há bloqueio
de credencial atual. Produção continua condicionada aos gates físicos.

### Evidências da retomada anterior

Mesmo candidato Linux e Codespace privado documentados em
`SECRETARY_STAGING_ORIGIN_RESUME.md`. Nenhum serviço pago novo criado.
Preflight passou: DB everflair_billing_staging, system ID 7682424799483236389,
runtime app_runtime sem SUPERUSER/BYPASSRLS, RLS/FORCE nas tabelas verificadas,
isolamento A/B e acesso sem contexto bloqueado, Redis interno isolado.
Snapshot adicional `closure-before.json`, SHA-256
`0ab0d13b67d904343e18e56744012f96336ae16fcee519f9181ecf9f6eb2e155`.
Journal de custo preservado, limite total de 20 tentativas, sem reset.

O launcher inicialmente recusou ENV: a configuração OFF não contém o preload
de budget nem a chave dedicada. O harness foi corrigido para restaurar somente
os quatro campos dedicados da configuração privada arquivada e validar antes
de lançar. Nenhum bypass do guard; primeira tentativa não lançou runtime ON.

Após uma interrupção da tarefa, o Codespace estava parando e a primeira proposta
de Agenda já havia expirado. Reconciliação comprovou zero mutation; preflight
foi refeito e uma proposta vigente foi preparada. Histórico foi preservado.

| Caso | Resultado comprovado |
|---|---|
| Agenda | PASS: Amanda Souza, Massagem, Tatiana A; 10h→11h, duração/preço preservados; receipt e mesma tela atualizada sem F5 |
| Produtos | PASS: Shampoo X 10→8; receipt e mesma tela atualizada sem F5 |
| Replay | PASS: mesma aprovação pelo transporte autenticado retornou receipt original; zero efeito adicional no snapshot |
| Stale | PASS: R$80→correção R$90; botão antigo desabilitado; backend CONFIRMATION_STALE, zero mutation |
| Nova confirmação | PASS: somente R$90 aplicado; receipt R$100→R$90 e Serviços atualizado sem F5 |
| Multi-action independente | PASS: um grupo, duas ações/receipts; Massagem R$90→R$100 e Shampoo X 8→10; exatamente dois registros atualizados |
| HARD_BLOCK | UI observada: horário fechado de 27/09, revisão necessária e Confirmar desabilitado; reconciliação final NÃO EXECUTADA |
| Demais atores/kill switch | PENDENTE em staging |
| Observabilidade completa | PENDENTE; provider/plan/proposal/confirmation/receipt/latência já observados, demais sinais não consolidados |
| STT físico / multi-turn voz | NOT_EXECUTED; aparelho ainda não informado |
| Production / canary | NOT_EXECUTED |

Mutations de negócio executadas: uma remarcação, uma baixa de estoque, uma
alteração de preço e duas operações de restauração pelo próprio produto.
Preço/estoque retornaram aos valores iniciais; Amanda permanece às 11h.
Comparações completas dos 62 conjuntos de linhas preservaram os demais dados.
Na Agenda, um AppointmentEvent e duas notificações INTERNAL previstas: cliente
sintético e recepcionista sintética; o ator é excluído por businessRecipients.
Nenhuma mensagem externa foi enviada. O status SENT dessas linhas é interno.

### Evidência durável e limites do checkpoint anterior

Diretório remoto privado:
`/workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z`.
Arquivos `closure-*-snapshot.json`, `closure-*-result.json`,
`closure-agenda-ui.json`, `closure-ui-operational-evidence.json`,
`closure-inventory-replay-response.txt`, `closure-stale-rejection-response.txt`.
O replay usou o mesmo confirmSecretaryGroup publicado, signin sintético normal
e os mesmos sessionId/plan/revision/group/fingerprint; não chamou executor direto.
O grupo concluído retorna o receipt já existente (duplicate=false preservado
no receipt original); o snapshot sem nenhum delta é a prova de idempotência.

A última reconciliação concluída é `closure-multi-confirmed-result.json` PASS.
Depois disso, somente o pedido de HARD_BLOCK foi enviado, sem confirmação.
Não promover a observação visual isolada a PASS integral de HARD_BLOCK.
Custos novos devem ser reconciliados no journal antes de reportar total;
estimativa histórica anterior US$0,001578625 não inclui esta retomada.

### Bloqueio de credencial da ferramenta no checkpoint anterior

A revisão automática da ferramenta recusou executar a consulta final porque
o refresh token foi revogado. Foi falha da revisão/autenticação, não classificação
da ação como insegura. Não usar outro transporte para contornar essa revisão.
É necessário renovar login do Codex e então reconciliar antes de continuar.

Último estado conhecido: runtime staging ON somente para fixture A/owner A,
paid calls e Multi-Action ON; voz/JEV/overlap e integrações externas OFF.
**Desligamento final ainda NÃO verificado após o bloqueio.** Não declarar flags
finais OFF. Nenhuma configuração produtiva foi acessada ou alterada.

Regressão geral desta retomada: 2635 PASS / 1 FAIL, 288 arquivos, exit 1; log em
`packages/salon-secretary/evaluation/results/staging-closure-tests.log`.
Uma verificação de varredura de imports excedeu 5s (5433 ms); preservar a falha,
reexecutar somente após encerrar concorrência e depois exigir suíte completa PASS.
Lint e TypeScript concluíram PASS (processo sequencial exit 0) após o bloqueio.
Build final ainda pendente.
Não substituir os PASS históricos por um PASS novo inventado.

SECRETARY_STAGING_REAL_DEVICE_PILOT_READINESS = NOT_VALIDATED

READY_FOR_CONTROLLED_PILOT = NO

PRODUCTION_CANARY_READ_ONLY = NOT_EXECUTED

SECRETARY_PRODUCTION_CANARY_V1 = NOT_EXECUTED
