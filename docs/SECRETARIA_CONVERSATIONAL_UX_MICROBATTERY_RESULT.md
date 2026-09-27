# Conversational UX — microbateria real direcionada

24/09/2026. Branch `codex/conversational-ux-microbattery`, worktree
`service-create-mvp`. **STOPPED_BEFORE_NETWORK: zero inferências.**

A selagem do manifest de execução terminou com exit 1 e
`TARGET_FAIL_CLOSED`. O manifest executivo não foi criado; nenhum caso foi
iniciado. A condição do responsável — parar em divergência de preflight — foi
respeitada. Não houve correção nem repetição da selagem após a falha.

## Placar solicitado

| Caso | Antes | Agora | Perguntas duplicadas | Campos técnicos | Continuidade | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| x41 | FUNCTIONAL_FAILURE conversacional | Não executado | Não medido | Não medido | Não medida | UNKNOWN |
| x42 | FUNCTIONAL_FAILURE conversacional | Não executado | Não medido | Não medido | Não medida | UNKNOWN |
| x44 | FUNCTIONAL_FAILURE conversacional | Não executado | Não medido | Não medido | Não medida | UNKNOWN |
| x46 | FUNCTIONAL_FAILURE conversacional | Não executado | Não medido | Não medido | Não medida | UNKNOWN |
| x49 | FUNCTIONAL_FAILURE conversacional | Não executado | Não medido | Não medido | Não medida | UNKNOWN |

**PASS 0/5; FUNCTIONAL_FAILURE_SAFE 0/5; SAFETY_FAILURE 0/5; UNKNOWN 5/5.**
UNKNOWN significa bloqueado antes da execução, não falha de provider ou Luna.
Os cinco checkpoints são NOT_STARTED. Não se convertem os PASS offline em
resultados reais.

Conversação histórica: **6/10**, preservada. Microbateria pós-fix: **N/A**,
pois 0/10 turnos foram observados. O cálculo futuro considera presença da
pergunta necessária, ausência de duplicação, ausência de pergunta
desnecessária e ausência de vazamento técnico por turno, acompanhado dos
gates estruturais e de segurança; não há denominador observado nesta rodada.
**MINIMUM CLARIFICATION UX: NOT VALIDATED no fluxo real.**

## Preflight: o que foi comprovado

- Quatro hashes do compositor/integração iguais ao plano congelado.
- Mensagens, continuações, oracle, fixtures e fontes antigas não alterados;
  teste de binding passou.
- PostgreSQL local identificado em `127.0.0.1:55441/everflair_service_mvp`.
- Role `mvp_service_runtime` sem SUPERUSER/BYPASSRLS; 19 tabelas com RLS/FORCE.
- Prechecks de isolamento dos cinco tenants passaram.
- Cinco snapshots preliminares integralmente iguais ao final histórico,
  inclusive auditoria técnica; Outbox=0 e confirmations=0 naquele momento.
- `.env.local` permaneceu inalterado. V2 ausente/false, paid=false e JEV=false.

Foi preparada uma entrada dedicada, derivada do harness já validado, com
allowlist x41/x42/x44/x46/x49 e limite de dez requests. Usa os mesmos dados
sintéticos e IDs históricos, sem seed/reset ou novas fixtures. A autorização
atual para preservar as fixtures exatas prevalece sobre a sugestão antiga de
criar tenants novos; os históricos técnicos só são aceitos quando hash e
contagem coincidem integralmente com a evidência anterior.

A entrada reutiliza DurableJournal/fsync/checkpoints, observation bridge,
wire witness, provider diagnostics, health checks e contadores independentes.
O boundary expõe somente start/send. Um observador mede a função real do
compositor sem editar seu arquivo congelado; o probe local confirmou que o
resultado e o plano permanecem idênticos. Esses mecanismos **não chegaram a
observar tráfego real nesta rodada**.

## Falha e limites do diagnóstico

Comando único de selagem: `node scripts/run-conversational-ux.cjs --seal`.
Saída: `{"status":"STOPPED","code":"TARGET_FAIL_CLOSED"}`; exit 1.
O sanitizador não preservou a exceção específica desse comando. Portanto,
a causa imediata da falha de selagem permanece **UNKNOWN**.

Após a parada, a coleta somente leitura do snapshot final não pôde concluir.
Um diagnóstico separado de encerramento, sem selar ou executar casos, encontrou
`PrismaClientInitializationError` em `SELECT 1`, com a mensagem classificada
como **banco inacessível** (`connection_unreachable=true`). Esse diagnóstico
comprova a indisponibilidade ao final, mas não recupera a exceção perdida da
selagem nem prova a causa da indisponibilidade.

Não foi reiniciado PostgreSQL, alterada conexão, restaurado backup, aplicado
SQL de reparo, corrigido harness após a parada ou disparada inferência. Uma
eventual retomada precisa primeiro tratar o bloqueio e repetir o preflight
sob nova instrução; nada foi programado automaticamente.

## Métricas, orçamento e segurança

Orçamento anunciado: **até dez inferências / US$0,13**, zero retries. Tarifa
Standard consultada em 24/09/2026: input 0,10, cached 0,01, cache write 0,125,
output 0,50 USD por milhão de tokens, conforme
[documentação oficial do GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
Reserva não é consumo: **requests=0; tokens consumidos=0; custo de inferência=US$0**.

Luna HTTP/total, parsing, backend, database por turno, compositor e E2E real:
**não medidos**. Não existe comparação real antes/depois nesta rodada. A
medição offline anterior continua histórica; não foi promovida a medição real.

TECHNICAL_FIELD_LEAK, DUPLICATE_QUESTION, UNNECESSARY_QUESTION,
MISSING_REQUIRED_QUESTION, WRONG_ENTITY_AUTO_SELECTED, INVENTED_REQUIRED_FIELD,
DRAFT_CONTINUITY_FAILURE e DEPENDENCY_FAILURE: **N/A por turno**, pois nenhum
turno foi iniciado. Não registrar falsos zeros de qualidade.

O runner não chamou confirmação, ferramenta de mutação operacional, envio ou
OpenAI/JEV. As operações de banco executadas nesta etapa foram verificações
somente leitura, com GUCs transacionais de isolamento. Não houve efeitos
operacionais solicitados. **A comparação independente do snapshot final e os
valores finais de Outbox/confirmations não puderam ser revalidados**, devido à
indisponibilidade; os zeros confirmados são os do preflight preliminar.

Flags finais conferidas no ambiente local: **V2 OFF, paid=false, JEV=false**.
Não houve hosted tools, containers, Front, Meta, overlap/override ou deploy.

## Checks e arquivos

- Testes direcionados: **45 PASS / 3 arquivos**.
- Suíte geral: **2.444 PASS / 274 arquivos**, `npm test -- --maxWorkers=2`.
- `npm run lint`: PASS.
- `npx tsc --noEmit --incremental false`: PASS na execução final.
- `npm run build`: PASS, local, secret descartável apenas no processo.

Uma tentativa de TypeScript concorrente ao build encontrou arquivos gerados
`.next/types` temporariamente ausentes; a execução sequencial após o build
passou. Isso não alterou runtime/gabarito. Houve também ajuste de tipagem de
views sintéticas no teste novo, antes da selagem.

Novos arquivos: `evaluation/conversational-ux-{real,target,timing}.ts` no pacote
salon-secretary; `scripts/run-conversational-ux.{cjs,ts}`;
`src/lib/__tests__/conversational-ux-target.test.ts`; este relatório.
Atualizado: `docs/STATUS_ATUAL.md`. O compositor, runtime de produto,
manifest de preparação congelado, casos, fixtures e expected não foram editados.

Rollback: manter flags OFF e não executar a entrada dedicada. Nenhuma mudança
de banco precisa ser desfeita. Não apagar tenants, auditorias ou evidência.
Não houve commit, push, PR ou Preview/deploy.

## Evidência durável local

- [Parada e checkpoints](../packages/salon-secretary/evaluation/results/conversational-ux-real/preflight-stop.json)
- [Journal de parada com hash/fsync](../packages/salon-secretary/evaluation/results/conversational-ux-real/preflight-stop.jsonl)
- [Diagnóstico final somente leitura](../packages/salon-secretary/evaluation/results/conversational-ux-real/final-diagnostic.json)
- [Encerramento e hashes](../packages/salon-secretary/evaluation/results/conversational-ux-real/closure.json)

Resultados locais são ignorados pelo Git. Nenhum resultado histórico foi
reescrito. Bateria encerrada antes da rede; nenhum caso repetido.
