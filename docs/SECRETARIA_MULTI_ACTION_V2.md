# Multi-Action V2 — Gate offline (Tópico 14)

Atualização posterior: [Controlled Validation e benchmark real](SECRETARIA_MULTI_ACTION_BENCHMARK_RESULT.md)
executados em 24/09/2026. A continuação conjunta de duas ações incompletas passou
a ser suportada no coordenador, sem exigir operation_ref na resposta natural.
O texto abaixo registra o Gate offline original; flags finais continuam OFF.

Estado: implementação local com feature flag OFF. Sem inferências, deploy, Front ou Meta.
Branch `codex/multi-action-v2`, worktree `.worktrees/service-create-mvp`, criada sobre
`9b92138ec7665342b60e1ddc210f04ccfa611c84`. O trabalho da Secretária já estava
não commitado nesse worktree; alterações anteriores foram preservadas. `origin/master`
foi consultado/atualizado; não houve merge da base nem publicação de branch.

## 1. Auditoria e u02

A [auditoria prévia](SECRETARIA_MULTI_ACTION_V2_AUDIT.md) foi escrita antes da implementação.
O journal local ignorado `ultimate-10-continuation-u02-u10.jsonl` registra u02:
HTTP 200, uma function call `select_capabilities`, argumentos JSON parseáveis,
SDK/agent concluídos e `selection_schema_valid=false`. Não registra os argumentos
nem o caminho/motivo da rejeição. **Causa exata: UNKNOWN.** Não atribuir a Luna.

O indicador histórico cobre `validateSelection`, portanto pode significar rejeição
Zod **ou** guarda semântica. Campos desconhecidos, tipos/nulos obrigatórios,
operação fora do Registry, keys, skills divergentes, campos de outra Skill e
arestas inválidas são possibilidades auditadas, não diagnósticos demonstrados.
Quatro ações não ultrapassam o limite antigo. O equivalente sintético de u02 passa
inclusive o validador antigo; o coordenador antigo recusava esse grafo misto depois.
Essa limitação posterior não demonstra a causa do indicador histórico.

Não foram repetidos u01/u02 nem executados u03–u10. Os testes com nomes Ultimate
são especificações/harnesses offline com transporte sintético.

## 2. Arquitetura anterior e V2

| Área | Antes | V2 com flag ON |
| --- | --- | --- |
| Transporte | `select_capabilities`, até 4 operações/Skills, até 2 pais por item | Mesmo contrato intermediário estrito; arrays sem esses tetos |
| Modelo | Intenções linguísticas | Intenções linguísticas; sem status, refs ou confirmação fornecidos pelo modelo |
| Coordenação | Filhos independentes ou par dependente especializado | `ActionPlan.actions[]`, grafo, estados por item, grupos |
| Dependência | cancel→create ou cancel→message | DAG geral de precedência; adapters atômicos antigos preservados |
| Falha de preparação | Pode fechar coordenação inteira | Item falho permanece; descendentes bloqueados; irmãos preservados |
| Confirmação | Proposta individual/par atômico | Aprovação explícita por grupo, vinculada a plano/revisão/hash e propostas reais |

`selectionSchema`/`validateSelection` V1 continuam disponíveis e são usados com
flag OFF. O V2 reaproveita todas as guardas de campos/operações por ação do V1.
Não há `action1`…`action4`, nem limite estrutural 10 no schema/motor.

```ts
ActionPlan {
  version: 2, plan_ref, revision, actions[], dependencies[],
  execution_order[], confirmation_groups[], policy, review, status
}
Action {
  key, skill, operation, fields, missing_fields[], provenance,
  status, assessment, depends_on[], blocked_by[], mutation, released_slot_of?
}
```

`provenance` distingue intenção e assessment do backend; não transforma interpretação
em autorização. Chaves explícitas são validadas; para independentes antigos sem
chave, o adapter gera `action_N` sem colidir. Nenhuma referência de domínio é aceita
do interpretador. Registry mantém seis Skills e 18 operações existentes.

## 3. Grafo, estado e execução

Kahn iterativo valida/reordena o DAG; componentes fracos determinam agrupamento.
Keys repetidas, pais repetidos, referências inexistentes, self-loop ou ciclo resultam
em `INVALID_DEPENDENCY_GRAPH`, antes de preparação/execução. Cadeias, fan-out,
fan-in e componentes independentes são representáveis. `released_slot_of` deve
apontar cancelamento presente em `depends_on` de uma criação.

Estados: `READY`, `NEEDS_INPUT`, `BLOCKED_BY_DEPENDENCY`, `DOMAIN_CONFLICT`,
`READY_FOR_CONFIRMATION`, `UNSUPPORTED`, `FAILED_SAFE` e `DONE`. READY não autoriza
mutação. `assessment` conserva a avaliação própria do item, mesmo quando seu status
derivado está bloqueado. `blocked_by` mostra predecessores ainda não concluídos.

Cada ação conserva faltantes; `minimumClarifications` lista somente itens com
faltantes. B(service,time) e D(end_time) não apagam A/C/E. Correção endereçada ao
filho atualiza o mesmo `plan_ref`, preserva chaves/dependências e incrementa revisão.
Se há uma única unidade incompleta, a continuação a seleciona automaticamente;
com várias, o preview identifica as perguntas e a API exige o `operation_ref`.
O patch puro invalida assessments da ação alterada e de seus descendentes.

Falha/necessidade de input nunca produz plano inteiro pronto nem dispara irmãos
silenciosamente. Um grupo incompleto não confirma. Após aprovação explícita de
grupo pronto, falha de A impede B/C dependentes; ações independentes desse grupo
podem concluir. O preview explicita essa possibilidade. Não há rollback global
inventado nem retry automático. Os pares atômicos mantêm suas transações reais.

## 4. Políticas de revisão e confirmação

```dotenv
SALON_SECRETARY_MULTI_ACTION_V2_ENABLED=false
SALON_SECRETARY_NORMAL_REVIEW_MAX=5
SALON_SECRETARY_MAX_ACTIONS_PER_CONFIRMATION_GROUP=10
```

| Tamanho com configuração padrão | Política |
| --- | --- |
| 1–5 | `NORMAL_REVIEW`, normalmente um grupo |
| 6–10 | `ADVANCED_REVIEW`, normalmente um grupo |
| >10 | `SPLIT_REVIEW`, componentes inteiros distribuídos entre grupos |
| Um componente >10 | Um grupo `SPECIAL_REVIEW`, confirmação comum recusada |

A política aceita outros números válidos (testados tetos 3 e 20). Um componente
de 12 nunca é cortado para caber em 10. A revisão especial fica pendente para um
fluxo futuro; este Gate não cria atalho para executá-la. Não se pede reescrita da
mensagem por exceder 10. Leituras já resolvidas continuam visíveis nos grupos.

`confirmActionPlanGroup` é API da classe backend, sem endpoint/UI novos. Exige
`plan_ref`, `revision`, `group_key`, `fingerprint`; valida estado atual, proposta e
preview por mutation, sessão, tenant e papéis. Filhos pertencentes ao plano não
podem ser confirmados diretamente ou via `confirmAutomatic`. Alteração material
ou tentativa de correção revoga o preview anterior; cancelamento bloqueia o item.
Replay da mesma aprovação retorna estado sem reaplicar efeitos. Idempotência
durável de cada efeito permanece no executor de domínio existente.

## 5. Read + write, agenda e Communication

Financial e demais leituras independentes podem resolver na preparação; não ganham
semântica de mutation. Leitura dependente coleta campos sem consultar cedo e só
consulta depois dos predecessores concluídos. Ela não é uma escrita disfarçada.

`actionUnits` mantém cancel→create com slot liberado no `startBatch` existente;
cancel→message compatível usa `startCancellationMessage`. Uma mensagem ramificada
de cancel→create usa proposta individual, verifica o mesmo cliente no snapshot de
cancelamento e só confirma depois do sucesso do cancelamento. EXACT continua
reconciliado pelo código existente; falha do cancelamento não libera Outbox.
Backend/Outbox continuam autoridades; provider permanece fake/local.

Não foram modificados duração, `[start,end]`, overlap, profissional, recursos,
bloqueios nem projected availability. `depends_on` significa precedência, não um
binding arbitrário de resultados. Reuso de slot continua exigindo adapter publicado.
Múltiplos consumidores do mesmo slot ou composição não coberta pelo adapter são
`UNSUPPORTED`, preservados no plano e sem confirmação automática.

Auditoria de overlap/encaixe/override: **SUPPORTED_CURRENTLY na agenda manual**
(`agenda/actions.ts`, `appointment-service.ts`, `visit-scheduling.ts`), com
papel/motivo e confirmações explícitas conforme a operação. Hard blocks/closures e
recursos continuam validados no backend. **NOT_MAPPED para novo override na
Secretária**. Nenhuma regra nova foi criada; eventual Gate reutilizará a regra manual.

## 6. Cobertura offline

- Schema/DAG: 1/3/4/5/7/10/12/14/101, dez independentes, A→B, A→B/C,
  A→B→C, múltiplos pais, dois componentes, ciclos/referências inválidas.
- Compatibilidade V1: 1/2/3/4 ações, SDK flag OFF, drafts/batch existentes,
  seleção, seis Skills, Communication, Router V1, Fast-path, Golden V2.
- Faltantes em duas ações, irmãos preservados, mesmo plano após resposta,
  proposal/hash antigo recusado, componente >10, política customizada.
- Execução backend com doubles: grupos até 14, replay, bypass recusado,
  reautorização/tenant, falha de dependência, leitura independente e dependente.
- Equivalente sintético u02: Amanda→Fábio/**Corte Completo**, Massagem/8000,
  Financial/service_revenue/yesterday; `startBatch` e validação reais, efeitos
  de domínio mockados. Ramificação EXACT e falha do cancelamento cobertas.
- Cenário estrutural de 10: cancelamento, criação, alteração Massagem, Financial,
  mensagem EXACT, cadastro Lia, entrada Shampoo, estoque baixo, bloqueio Tatiana,
  cadastro Barba Expressa. Cobre as seis Skills e scoring de representação,
  ordenação e agrupamento. Extensão para 14 mantém os componentes inteiros.

Os resultados históricos Golden 10/10 e Hard 13 PASS/1 FUNCTIONAL_FAILURE_SAFE/
0 SAFETY_FAILURE permanecem históricos; não foram remedidos com inferência V2.

### Evidência histórica versus código atual

Os manifests históricos selam bytes de quatro arquivos agora alterados. Seus
runners reais **continuam recusando o V2**; hashes/manifests não foram atualizados.
Dez suítes de harness histórico usam um double de leitura de arquivos limitado
a esses quatro fontes, arquivados byte a byte e verificados contra hashes V1.
Esse double não substitui módulos executados e não é usado nos testes funcionais
V2/V1-off. `secretary-v2-historical-guards.test.ts`, sem esse double, prova que
Hard/Ultimate/Inventory rejeitam a versão atual. Isso não autoriza repetir avaliações.

### Comandos e resultados

| Comando | Resultado local |
| --- | --- |
| `npm test -- --maxWorkers=2` | PASS — 271 arquivos, 2.397 testes, 132,56 s |
| `npm run lint` | PASS, exit 0 |
| `npx tsc --noEmit --incremental false` | PASS, exit 0 |
| `npm run build` | PASS, exit 0 — Prisma Client gerado localmente e Next build concluído |

Baseline anterior: 2.332/2.333 testes passaram; um timeout no teste de abort JEV
passou isolado e na suíte final. Primeiro run V2 completo revelou os selos históricos
dos fontes; foi corrigida a separação entre arquivo histórico e teste funcional,
sem mexer nos manifests. Logs locais desta sessão em
`%TEMP%/multi-action-v2-{suite-final,lint-final,tsc-final,build}.log`.

Não houve
schema/migration alterado por este Gate; PostgreSQL/integration/schema-smoke não
foram executados (nenhum container iniciado). A suíte `npm test` exclui integration.

## 7. Custo e contexto, sem chamadas pagas

Prompt discovery medido offline: V1 6.696 bytes UTF-8, V2 6.819 (+123 bytes).
Schema JSON V2 medido offline: 5.212 bytes constantes para qualquer N. Exemplos
sintéticos de saída compacta: 1=261, 5=1.077, 7=1.485, 10=2.097, 12=2.509,
14=2.921 bytes. São bytes, não tokens faturados; envelopes strict com campos nulos,
textos longos e Skills distintas podem ser maiores. O prompt mantém catálogo fixo;
intenção/saída crescem com N e arestas, sem repetir catálogo por ação. Grafo é
iterativo; sorting de componentes e buscas dos adapters acrescentam custo local.
A preparação atual recalcula grupos/hashes por assessment e faz buscas em arrays;
para N grande, o custo acumulado pode ser quadrático. O stress de 101 demonstra
ausência de teto 10, não capacidade infinita ou benchmark de produção.

Nenhuma latência/model quality foi medida. Mais saída tende a aumentar latência e
consumo; o orçamento legado `maxTokens=1200` permanece, portanto pode truncar
composições maiores. Limites existentes de mensagem/turnos/TTL também permanecem;
são limites de recurso, não um teto estrutural de dez ações. O próximo Gate deve
dimensionar saída/contexto antes de qualquer inferência autorizada.

## 8. Segurança, limitações e rollback

Fast-path → JEV somente PROVEN → Luna permanece; compound segue DIRECT_LUNA.
JEV V1/allowlist não foram ampliados. RLS, wrappers tenant-scoped, backend authority,
store=false, zero hosted tools e zero containers não foram alterados.

Limitações: validação de integração PostgreSQL e inferência V2 ainda pendentes;
grupos especiais sem executor; adapters projetados de agenda continuam restritos;
clarificação simultânea de vários itens exige endereçamento por operação; sessão
em memória não é retomada automaticamente após restart, embora estado auditado e
idempotência de efeitos permaneçam no backend; sem Front/Meta de confirmation groups.
Dependências gerais não prometem resolver entidades criadas por ações anteriores.

Rollback imediato: manter/definir `SALON_SECRETARY_MULTI_ACTION_V2_ENABLED=false`.
Novas sessões usam V1; planos V2 abertos não podem enviar novas correções nem
confirmar grupos com flag OFF. Para remover código, reverter somente o delta deste
Gate, preservando o trabalho anterior não commitado. Backups prévios desta sessão:
`%TEMP%/everflair-multi-action-v2-before`. Nenhuma reversão de banco é necessária.
Não publicar o worktree inteiro como se todas as alterações fossem deste Gate.

## 9. Arquivos deste Gate

28 arquivos novos/alterados neste delta; inclui documentação e fixtures históricas.

Alterados:

- `packages/salon-secretary/src/index.ts` — seleção de contrato V1/V2 no SDK.
- `packages/salon-secretary/src/skill-registry.ts` — schema/validator/prompt V2,
  mantendo V1 e Registry.
- `src/lib/salon-secretary.ts` — coordenação, grupos e continuação backend.
- `src/lib/salon-secretary-runtime.ts` — configuração por ambiente.
- `.env.example` — defaults OFF/5/10.
- `docs/STATUS_ATUAL.md` — registro canônico deste Gate e evidência u02.
- Dez testes históricos, somente separação de leitura dos fontes V1:
  `hard-conversations-{runner,durable,durable-execution,phase-a-harness,observation-bridge}.test.ts`,
  `ultimate-10{,-harness,-continuation}.test.ts`,
  `secretary-conversational-design.test.ts`, `jev-inventory-readonly.test.ts`.

Novos:

- `packages/salon-secretary/src/action-plan.ts` e `dependency-graph.ts`.
- `src/lib/secretary-action-plan.ts`.
- `src/lib/__tests__/secretary-action-plan-{v2,runtime,batch}.test.ts` e
  `secretary-v2-historical-guards.test.ts`.
- `src/test/secretary-legacy-evidence.ts` e
  `src/test/fixtures/secretary-v1-frozen-sources.json` (fontes históricos, não código executável).
- Este documento, `SECRETARIA_MULTI_ACTION_V2_AUDIT.md` e
  `SECRETARIA_MULTI_ACTION_V2_CONTROLLED_VALIDATION.md`.

Nenhum arquivo de Router/JEV, banco, agenda manual, provider de Communication,
Front ou Meta foi alterado por este Gate. O status Git inclui trabalho preexistente
dessas áreas; não representa o delta desta sessão. Sem push/PR/Preview, pois este
Gate proíbe deploy e a publicação poderia iniciar Preview automaticamente.

Próximo: [MULTI-ACTION V2 — CONTROLLED VALIDATION](SECRETARIA_MULTI_ACTION_V2_CONTROLLED_VALIDATION.md).
Preparação apenas; não executar inferências nem iniciar Front/Meta.
