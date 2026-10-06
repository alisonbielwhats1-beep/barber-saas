# Mapa da máquina de planos multi-ação da Secretária (C4/C5) — análise somente leitura

## Resumo
- Cada mensagem gera **uma** interpretação da Luna, com no máximo um reparo de transporte. Tudo o que vem depois é determinístico no backend: plano, unidades, grafo, grupos, preparação por adaptador, propostas e confirmação.
- A validação entre ações hoje cobre só três casos:
  - `markIntraPlanConflicts`: sobreposição entre propostas do mesmo plano, sem considerar horário liberado;
  - `releaseAfter` e `released`/`projection`: horário liberado, mas só quando existe vínculo explícito;
  - `betweenBookings`: a regra 8.
- Não existe validação do plano inteiro (buscas por "invariant" em `src/lib` e `packages/salon-secretary/src` só acharam testes).
- A opção (b), contexto montado pelo backend antes da chamada, mantém o contrato de chamada atual intacto.
- A opção (a), ferramentas chamadas pela Luna dentro da interpretação, quebra quatro contratos verificados:
  - o `MODEL_CALL_LIMIT`;
  - o guarda de custo, que aceita uma única ferramenta forçada e só itens de entrada do tipo mensagem;
  - `stop_on_first_tool` com `maxTurns:1`;
  - o estimador do `program-spend`.

## 0. Estado verificado antes da análise
- Worktree no commit `c3d33de`. Arquivos não commitados:
  - `packages/salon-secretary/src/proposal-check.ts`, o conferente. Não está ligado ao runtime: só a medição `.demo/agenda-core/c5-proposal-check-measure.ts` e um teste o usam.
  - `openai-cost-guard.ts:4`, que acrescentou `check_proposal` a `FUNCTION_NAMES`.
- O runtime só funciona em development, test ou staging (`src/lib/salon-secretary-runtime.ts:8-24`).
- Classes de congelamento (`node .demo/agenda-core/frozen.cjs status`, que só lê):

| Classe | Arquivos |
|---|---|
| **FREE** | `index.ts`, `openai-cost-guard.ts`, `usage.ts`, `action-plan.ts`, `skill-registry.ts`, `conversational-presentation.ts`, `salon-secretary.ts`, `secretary-scheduling.ts`, `secretary-presentation.ts`, `secretary-action-plan.ts`, `secretary-router.ts`, `salon-secretary-usage.ts`, `scheduling-catalog.ts` |
| **UNPINNED** | `source-literal-repair.ts`, `same-as.ts`, `conversation-routing.ts`, `instructions.ts`, `request-budget.ts`, `structured-context.ts`, `secretary-options.ts`, `secretary-same-as.ts`, `secretary-turn-outcome.ts`, `program-spend.ts`, `free-use-budget.ts`, `free-use-runner.ts` |
| **PRISTINE** | `dependency-graph.ts`, `secretary-journal.ts` |

- Dados reais da prova Golden da C4 (`evaluation/results/free-use/golden-20260930-c4-proof`, k1 a k5):

| Medida | Valor |
|---|---|
| Requisições por turno | 220 requisições para 220 turnos: 1 por turno, 0 reparos |
| `inputTokensUpper` (= bytes do corpo + 8192) | p50 44.440, máximo 45.598. Corpo ≈ 36,2 KB, folga ≈ 18,4 a 19,6 KB até o teto de 64.000 |
| Reserva por requisição no pior caso | p50 9.651 µ$ |
| Latência do turno | p50 4,6 s, p90 6,7 s, máximo 12,2 s |

- Tamanhos com as flags da C5 ligadas: não verificado.

## 1. Sequência de uma mensagem com 3 ações, da chamada à Luna até as propostas

Exemplo de estrutura, com nomes genéricos: "cancela a cliente A amanhã às 10h, põe a cliente B no horário dela e bloqueia a agenda de P das 15h às 16h". São três ações: `a` = `appointment.cancel`, `b` = `appointment.create` com `released_slot_of:a` e `depends_on:[a]`, e `c` = `schedule.block`.

```
Tela → SalonSecretary.send                          salon-secretary.ts:565-570
  persisted (lease/CAS, se houver store)             :172-192
  sendTurn: RouterTrace no ALS + observadores        :571-592
    sendMessage → exclusive (trava, authorize)       :651-654, :312-323
      auto: secretaryDirectory (equipe, serviços, hoje)  :669-670
      withSalonDirectory(...) → preparePlanSafely(sendAutomatic)  :673, :394-401
        sendAutomatic: sem plano → tryJev (fora da allowlist → null)  :837-838
        measuredModel = RouterTrace.measure(modelo pago)  :271-274, secretary-router.ts:206-215
        instrumentServicesModel(measured, usageRecorder)  :843, usage.ts:57-90
        runServicesTurn(msg,{},requisitos,"discovery",multiActionV2)  :845-846
        │ index.ts:218-328
        │  instruções = decisionInstructions (catálogo + roteamento + temporal)  index.ts:147-162, instructions.ts:59-68
        │  sistema = systemHead(contexto {}, diretório, hoje) + staticTail/jitTail  index.ts:165-172, :255-264
        │  wire = conversationTurnWire(sem plano ativo → NEW/CONVERSATION/UNSUPPORTED/AMBIGUOUS)  index.ts:126-141, conversation-routing.ts:310-343
        │  [exemplos few-shot, se ligados]  index.ts:267-278
        │  fitRequest: bytes + 8192 ≤ 64000, senão degrada / REQUEST_TOO_LARGE  index.ts:283-309, request-budget.ts:30-54
        │  Agent(1 tool, toolChoice forçado, parallel=false, store=false, stop_on_first_tool)  index.ts:188-206
        │  Runner.run(maxTurns:1, AbortSignal 45 s)  index.ts:315-321
        │   boundedModel.getResponse  index.ts:236-252
        │     assertSecretaryModelRequest (1 tool, toolChoice forçado)  openai-cost-guard.ts:22-32
        │     called? → MODEL_CALL_LIMIT  index.ts:239
        │     instrument: emite STARTED → auditLog SALON_SECRETARY_USAGE  usage.ts:62-68, salon-secretary-usage.ts:20-43
        │       measure (passivo) → provedor OpenAI → secretaryGuardedFetch → POST /v1/responses  openai-cost-guard.ts:64-76
        │       [avaliação: globalThis.fetch do runner → assertProgramHeadroom + guardPaidFetch]  free-use-runner.ts:218-231
        │     instrument: emite SUCCEEDED/FAILED; trace.lunaUsage += tokens  usage.ts:82-85, secretary-router.ts:207-213
        │     validateResponse: exatamente 1 function_call com o nome esperado, status completed  index.ts:225-235
        │     invalidSourceLiterals? → 1 reparo (attempt 2 SOURCE_LITERAL_REPAIR)  index.ts:242-251, source-literal-repair.ts:75-111
        │   SDK executa a tool → parseInput → decodeConversationTurn(NEW, parcial)  conversation-routing.ts:264-287
        │     withoutSatisfiedEdges; independent derivado das arestas; validateSelectionV2({partial})  skill-registry.ts:216-325
        │     (chaves, grafo acíclico, released_slot_of ⊂ depends_on e alvo cancel/change, same_as)
        │   retorna 'SELECTION_RECEIVED_NOT_EXECUTED' → stop_on_first_tool
        ← selection {operations:[a,b,c], rejected?}
        noteRejected (partes deixadas de fora → turn_notice)  :872, :2032-2044
        authorize por skill; SKILLS_LOADED no auditLog  :867-871
        startActionPlan → preparePlanSafely(prepareActionPlan)  :993-1030
          createActionPlan → refreshActionPlan  action-plan.ts:70-82, :89-142
            grafo (dependencyGraph ou preparationGraph se houver same_as): ordem [a,c,b]
            componentes {a,b} e {c} → grupos (grouping "component" por padrão): group_1=[a,b], group_2=[c]
          actionUnits: a com uma liberação segura → {keys:[a,b], kind:"scheduling-batch"}; c → single  secretary-action-plan.ts:8-30
          preparationOrder (bloqueio com "entre" vai por último, só com REFERENCES_V2)  :1034-1043
          para cada unidade (planContext.run):  :1005-1023
           ├ U1 batch: start(child) → startBatch(ações a,b; message; batchScope) → rascunho e proposta atômicos  :1016, secretary-batch.ts:86
           │   syncActionUnit → assessmentFromView → assessPlanAction  :957-965, secretary-action-plan.ts:57-99
           └ U2 single: prepareReferences (released origin / pronome / betweenBookings / same_as)  :1154-1269
               applyPlanOperation → projectSchedulingOperation → applySchedulingInterpretation(
                 texto = actionScopedSource(msg, op, siblings), {scoped, single:false, unverified})  :932-951
               → secretary-scheduling.prepare(): authorize, locate, temporais, nomes,
                 schedulingActionSnapshot(block) → [guarda de bloqueio → cartão]  secretary-scheduling.ts:633-639
                 → upsertSchedulingDraft (diário) → proposeSchedulingAction  :675-676, :704-706
               syncActionUnit → READY_FOR_CONFIRMATION + proposal_token
          (falha de unidade → failActionUnit: DOMAIN_CONFLICT/FAILED_SAFE/NEEDS_INPUT)  :966-992
          recordAutomaticState → auditLog SECRETARY_OPERATION_PLAN  :816-820
        preparePlanSafely (depois):  :398-400
          syncReferences (vínculos seguem o valor aceito; reseed sem chamada ao modelo)  :1281-1296
          markIntraPlanConflicts (sobreposição entre propostas do plano; bloqueio vence)  :429-471
      trackClarifications (B6)  :675, :617-635
      view → projectView: secretaryPlanMessage + grupos e fingerprints  :504-522, secretary-presentation.ts:111-113
    finally: recordTurnOutcome (contract_version) + auditLog SECRETARY_ROUTER (trace.snapshot)  :584-589, :595-611
Tela ← SecretaryView {action_plan, confirmation_groups, operations[...]}
Dono → confirmActionPlanGroup / confirmReadyGroups  :1834-1858, :1900-1938
  executeConfirmationGroup (ordem de execução; dependência não DONE → BLOCKED)  action-plan.ts:231-255
  groupExecutor → confirm(child, proposal_ref, draft_revision) pelo confirm de domínio idempotente  :1861-1879
```

### Turnos de continuação (plano ativo)
```
sendAutomatic → sendActionPlanTurn  :826, :1513-1584
  routingContext = planConversationContext(plano ativo + pending_discard, planos suspensos)  :1529-1530, secretary-presentation.ts:125-143
  optionBinding = planOptions (refs dos cartões desta rodada; a Luna vê só opt_N e rótulos)  :1532, secretary-presentation.ts:117-121, secretary-options.ts:23-31
  withConversationRouting(continueActionPlanTurn)  :1535, :1585-1635
    ├ 1 unidade pendente ou editável → send(child) → sendSchedulingTurn → runServicesTurn("scheduling")  :1622, secretary-scheduling.ts:1103-1111
    ├ várias → continueMultipleActions → runServicesTurn("discovery", CONTINUE_EXISTING_PLAN)  :1638-1651
    └ nenhuma → runServicesTurn("discovery") → throw SecretaryNewRequest  :1602-1610
    Com o roteamento ativo, a decisão (NEW/ADD/PATCH/RESUME/DISCARD) sai de runServicesTurn como exceção de rota  index.ts:324-325, conversation-routing.ts:268-305
  catch em sendActionPlanTurn: restaura os snapshots dos filhos e faz revision++  :1536-1543
    unread → keepPlanAfterUnreadAnswer → holdForReview(unidade endereçada)  :1550, :2059-2068
    DISCARD → discardPlanActions (fecho transitivo e pergunta quando há vinculados)  :1551, :2098-2157
    RESUME → activatePreservedPlan + applyExistingPlanPatches  :1553-1560
    PATCH → applyExistingPlanPatches  :1569, :1652-1712
       - cada delta: chave existente, não terminal, mesma operação, sem arestas  :1657-1658
       - rejected com item_key → holdForReview (REVIEW_REQUIRED, proposta retirada)  :1660, :2073-2083
       - choice {option_id, literal} → applyOptionChoice: cartão publicado nesta rodada, literal presente e não negado,
         choiceVerdict, eco concordante → selectChild (o adaptador consulta o tenant de novo)  :1720-1761, secretary-scheduling.ts:1113-1237
       - o resto do delta → applyPlanOperation ou groundBatchPatch + prepareBatch  :1686-1697
    ADD → appendActionPlan / appendReleasedSlot / appendReleasedOrigin  :1570, :1476-1512, :1411-1475
    NEW → novo plano; o anterior fica suspenso (limite de 5)  :1571-1581
Clique na tela: selectAutomatic (cartão) :1941-1952 | selectOption (horário alternativo, fast path sem modelo) :1966-1989
```

Não verifiquei se o caminho direto `continueMultipleActions → applyExistingPlanPatches` (`:1649-1650`) é alcançável com o roteamento ligado. Pela leitura, o PATCH sempre sai como exceção de rota em `index.ts:325`.

## 2. Contrato da chamada ao modelo (como está hoje)

**Uma chamada por instância de `runServicesTurn`.** Duas travas independentes:
- `boundedModel.called` (`index.ts:239`);
- o contador do `instrumentServicesModel`: a primeira precisa ser `attempt 1 INTERPRETATION`; uma segunda só é aceita se for o reparo da primeira e a primeira tiver terminado (`usage.ts:63-65`, identidade em `source-literal-repair.ts:7-16`).

O reparo só troca folhas literais (`assertSourceLiteralRepair`, `:86-98`) e recebe o prefixo sem exemplos (`index.ts:311-312`). Não existe contador global por mensagem: o "1 por mensagem" vem da estrutura, porque cada caminho de turno faz um único `runServicesTurn` (lido em `:686-768`, `:845`, `:1607`, `:1646`, `:1813-1823`).

**Parâmetros da chamada:**
- `toolUseBehavior:'stop_on_first_tool'`, ferramenta única forçada, `parallelToolCalls:false`, `store:false`, `retry.maxRetries:0`, `maxTokens` 8192 na V2 (`index.ts:68-75`, `:188-206`);
- `Runner maxTurns:1`, tempo limite de 45 s (`:317-321`);
- cliente OpenAI com `maxRetries:0` e 30 s (`:431-433`).
- O SDK 0.18.0 tem `resetToolChoice`, com padrão `true`, e `stopAtToolNames` (`agents-core/dist/agent.d.ts:156`, `:276-280`).

**Guarda de custo:**

| Nível | O que exige | Onde |
|---|---|---|
| SDK | `tools.length===1`, `toolChoice` = nome esperado, sem prompt nem `previousResponseId`, sem opções de cache de prompt | `openai-cost-guard.ts:22-32` |
| HTTP | chaves permitidas, `tools.length===1`, `tool_choice` como objeto forçado, `include:[]`, itens de entrada só `message` com papel user ou system | `:35-62` |

**Telemetria:**
- `usageRecorder` grava linhas `SALON_SECRETARY_USAGE` STARTED/FINISHED com `attempt ∈ {1,2}` e `purpose ∈ {INTERPRETATION, SOURCE_LITERAL_REPAIR}` e ordem obrigatória (`salon-secretary-usage.ts:9-32`).
- `RouterTrace.measure` guarda `lunaUsage`/`literalRepairCalls` (`secretary-router.ts:206-215`).
- `snapshot()` calcula `routerLunaCost`, com leitura de cache a 0,01 (`:30-36`), e grava a linha `SECRETARY_ROUTER` com `luna_calls`, `usage_luna`, `estimated_cost_usd`, `transport_repair_calls` e `outcome` saneado por lista fechada (`:104-132`, `:216-233`; gravação em `salon-secretary.ts:586-589`).
- `contract_version` é o hash de prompts, wire, modelo e flags (`index.ts:335-417`).

**Contabilidade de custo (`program-spend`, só em avaliação):**
- As fontes são `practice`, `golden` e `transcribe` (`program-spend.ts:47`).
- `guardPaidFetch` reserva o pior caso antes do transporte e liquida pelo uso real depois (`:493-515`). O pior caso é (bytes + 8192) × 0,125 + max_output × 0,5 µ$ (`:84-85`).
- O estimador `responses` exige `assertSecretaryResponsesPayload` (`:105-117`).
- `withinBound` limita o uso real ao reservado (`:141-142`).
- `FREE_USE_PRICING` tem o sha fixado em cada linha do diário (`free-use-budget.ts:14-20`, verificação em `readJournal`).
- Há `maxRequestsPerAttempt` por binding (`free-use-runner.ts:222`).

## 3. Pontos exatos de integração

### (a) Ferramentas de consulta chamadas pela Luna dentro da interpretação
1. **Agente:** `index.ts:188-206`. Passaria a ter lista de ferramentas = consultas + ferramenta final, com:
   - `toolUseBehavior:{stopAtToolNames:[final]}`;
   - `toolChoice:'required'` e `resetToolChoice:false`. O padrão `true` reinicia a escolha para automática depois da primeira ferramenta, e os dois guardas rejeitariam.
2. **Runner:** `index.ts:317-321`, com `maxTurns = 1 + L` e L entre 2 e 3. O tempo limite de 45 s cobre todas as rodadas.
3. **`boundedModel` e `validateResponse`:** `index.ts:225-252`. Hoje só aceitam 1 `function_call` da ferramenta final. Precisariam distinguir rodada de consulta de rodada final, limitar L, e aplicar o reparo só à resposta final, forçando a ferramenta final (`sourceLiteralRepairRequest` copia `...original`, inclusive `tools`, em `source-literal-repair.ts:103`).
4. **Executores:** o pacote não acessa o banco. Os executores somente leitura seriam injetados pelo app com um AsyncLocalStorage no molde de `withSalonDirectory` (`conversation-routing.ts:19-24`), instalado em `salon-secretary.ts:669-673`. Reusariam `scheduling-catalog.ts`: `listSchedulingAppointments` `:196`, `getSchedulingAvailability` `:108`, `listSchedulingServices` `:26`, `listSchedulingProfessionals` `:59`, `professionalReadDay` `:239`, `summarizeSchedulingAppointments` `:202`, `listUpcomingCustomerAppointments` `:225`. Todos fazem `assertSchedulingAccess`.
5. **Guarda de custo:** `openai-cost-guard.ts:4, 22-32, 35-62`. Seria preciso permitir N ferramentas de uma lista fechada, `tool_choice` como `'required'` e itens `function_call` e `function_call_output`. Com `store:false` e raciocínio, talvez também itens `reasoning` e `include` com conteúdo criptografado (não verificado).
6. **Telemetria:** `usage.ts:57-90`, `source-literal-repair.ts:7-16`, `salon-secretary-usage.ts:9-32`, `secretary-router.ts:206-233` e os campos de `TurnOutcome` em `:41-61` e `:104-132`.
7. **Orçamento de requisição:** `request-budget.ts:30-35` mede o corpo com 1 ferramenta. Cada rodada cresce com os esquemas e os resultados, então o ajuste precisa ser por rodada. O teste de wire (`secretary-capability-wire.test.ts`, `secretary-residual-wire-budget.test.ts`) teria de incluir os esquemas das ferramentas.
8. **Custo:** `program-spend.ts:105-143` e `:176` (estimador novo, selado na lista), `free-use-runner.ts:218-231` (cada rodada vira uma reserva e conta em `maxRequestsPerAttempt`).

Variante (a′), que se encaixa melhor nos guardas atuais: uma chamada curta com uma ferramenta forçada (`request_lookups`, estrita, com enum), o backend executa as consultas, e a interpretação normal recebe os resultados como dados de sistema. Cada requisição continua com 1 ferramenta e só mensagens, como já foi feito para `check_proposal`. O custo são 2 chamadas. O `MODEL_CALL_LIMIT` ganharia um `purpose` novo.

### (b) Contexto montado pelo backend e injetado antes da chamada
1. **Montagem:** `salon-secretary.ts:669-673`, onde o diretório já é lido e posto no ALS. Ali entraria uma pré-varredura determinística da mensagem:
   - quotes temporais com `quoteTemporalFacts` (já usado em `:1748`);
   - nomes da equipe e serviços pelo diretório;
   - leitura limitada da agenda: faixas ocupadas e livres por profissional e dia citados, jornada, combos dos serviços citados (`comboParts`).
   
   Um ALS novo em `conversation-routing.ts` ao lado de `withSalonDirectory` (`:19-24`) faria o contexto chegar também às chamadas dos adaptadores filhos no mesmo turno, porque `preparePlanSafely` roda dentro dele. Sessões fora do modo auto não recebem o diretório nem o contexto.
2. **Renderização:** `index.ts:165-172`, em `systemHead` ou num apêndice depois do enquadramento de dados, como o JIT em `:258-260`. Fica fora de `instructions` para não quebrar o prefixo estável do cache.
3. **Orçamento:** um nível novo de degradação em `index.ts:294-301` e um código novo em `REQUEST_DEGRADATIONS` (`request-budget.ts:17`), sem reordenar os existentes.
4. **Contrato:** flag em `SECRETARY_CONTRACT_ENV` (`index.ts:337-340`), nome da flag em `secretaryContractParts` (`:384-401`) e placeholder do template em `templates.system` (`:371`).
5. **Telemetria:** um observador novo junto dos existentes em `salon-secretary.ts:579-581`, um campo em `RouterTrace`/`TurnOutcome` e uma entrada na lista de `safeOutcome` (`secretary-router.ts:41-61`, `:104-132`). Só códigos e contagens: dias, profissionais, linhas, bytes, se foi descartado.
6. **Opcional, saída resolvida:** campos anuláveis novos nas operações de agenda (`skill-registry.ts:87-103`, `capabilitySelectionWire` `:449`), com flag. O backend revalida no tenant, como `applyOptionChoice` (`:1720-1761`). O formato `{value, literal}` fica.

## 4. O que cada opção exige mudar e o que não pode quebrar

| Área | (a) ferramentas dentro da chamada | (b) contexto antes da chamada |
|---|---|---|
| Arquivos | `index.ts`, `openai-cost-guard.ts`, `usage.ts`, `source-literal-repair.ts`, `request-budget.ts`, `salon-secretary-usage.ts`, `secretary-router.ts`, `salon-secretary.ts` (injeção), `program-spend.ts`, `free-use-runner.ts` (limites) e um módulo novo de ferramentas | `salon-secretary.ts:669-673`, `conversation-routing.ts` (ALS), `index.ts` (`systemHead`/nível/contrato), `request-budget.ts:17`, `secretary-router.ts` (campo de telemetria) e um módulo novo de montagem, só leitura |
| Limite de chamadas | Precisa redefinir: 1 + L rodadas + reparo. Contradiz a regra "Keep MODEL_CALL_LIMIT" de `AGENT_RULES.md`; a seção 6 do plano aprovou só como spike medido | Continua 1 + ≤1 reparo |
| Guarda de custo | Afrouxa 3 invariantes: ferramenta única, `tool_choice` forçado, entrada só com mensagens | Nada muda |
| Telemetria | `attempt`/`purpose` novos, contagem e latência por ferramenta, `luna_calls` > 1 por mensagem | Um campo novo, só com códigos |
| Custo por mensagem (reserva) | (L+1) × ≈ 9,7 mil µ$ ou mais, porque cada rodada reenvia o prefixo e os resultados acumulados. Com L=2, cerca de 3 vezes | +125 µ$ por KB de contexto. A folga no p50 é ≈ 19,5 KB |
| `program-spend` | Estimador selado novo (não editar `FREE_USE_PRICING`, cujo sha está nos diários), `withinBound` por rodada, `maxRequestsPerAttempt` recalculado | O estimador atual serve, porque o formato do payload não muda |
| Latência | +L idas e voltas. Hoje o p90 do turno é 6,7 s e o teto é 45 s | Uma leitura extra no banco antes da chamada |
| Replays gravados | Um modelo gravado não tem rodadas de consulta: com a flag desligada, tudo idêntico | O wire não muda: replays e argumentsSha256 continuam decodificando. O corpo de entrada muda só com a flag |

**Nas duas opções, não pode quebrar:**
- **Testes do contrato de chamada:**
  - `salon-secretary-sdk.test.ts:8-28`: 1 ferramenta, `stop_on_first_tool`, 1 inferência por mensagem;
  - `secretary-temporal-literal-repair.test.ts:193-214`: `MODEL_CALL_LIMIT`;
  - `salon-secretary-usage-attempts.test.ts:11-35`: tentativas 1 e 2;
  - `salon-secretary-cost-guard.test.ts`: uma única ferramenta local;
  - `secretary-live-wire-boundary.test.ts:44-53`: `maxTurns:1`.
- **Teto do wire:** bytes + 8192 ≤ 64000 com todas as flags.
- **Flag desligada:** wire e comportamento idênticos, conferidos pelos testes de versão de contrato.
- **Segurança:**
  - isolamento por tenant e permissões em toda leitura;
  - as consultas nunca escrevem no diário ou no rascunho;
  - a Luna nunca executa e o "sim" digitado nunca confirma;
  - sem escolha automática entre várias entidades: linha de contexto não é escolha, só cartão publicado com binding;
  - prova literal temporal, de `source_scope` e de choice;
  - GF14, negação, HARD_BLOCK, idempotência (diário e `groupReceipts`);
  - nenhum texto, nome ou mensagem na telemetria.
- **Congelados:** oráculos Golden, t21 e multi-ação; `AUDITED_PUBLICATION_HASH` (cobre só nomes de operações do registry e requisitos, `derivation-catalog.ts:12-22`). Ferramentas fora do registry não o alteram; operações novas alterariam.
- **Privacidade (decisão do dono, não verificada):** o diretório exclui clientes de propósito (`conversation-routing.ts:16-18`). Agenda do dia com nomes de outros clientes aumenta os dados enviados à OpenAI. O mínimo seria mostrar só nomes que já aparecem na mensagem e mascarar os demais.

## 5. Onde a validação do plano inteiro pode ficar

**O que existe hoje (pontual):**
- `markIntraPlanConflicts`, só propostas READY. O comentário em `:427-428` diz que horários liberados não são modelados.
- Horário liberado só com vínculo explícito:
  - `released_slot_of` para cancel→create em lote atômico (`secretary-action-plan.ts:20-24`);
  - origem de uma remarcação D1 (`releasedOrigin` `:1096-1111`, projeção em `secretary-scheduling.ts:333-336`, `:662`, `:668`, `:709`);
  - change com `same_as` time num cancel (`releaseAfter` `:1083-1088`, `:1249-1250`).
- `betweenBookings` (`:1117-1147`).
- Re-checagem no confirm de domínio.
- `validateSelectionV2` verifica só a forma do grafo.
- O guarda de sobreposição de cliente (C7) compara só com a agenda gravada, não entre ações do plano (`secretary-scheduling.ts:664`).

**Locais propostos:**
1. **Passagem do plano (principal):** em `preparePlanSafely`, depois de `syncReferences`, em `salon-secretary.ts:398-400`, substituindo ou generalizando `markIntraPlanConflicts`.
   - Monta uma linha do tempo projetada por profissional e dia: agenda gravada, menos o que o plano cancela ou tira da origem, mais o que o plano ocupa, na ordem de execução.
   - Fontes: `draft.snapshot`, `draft.action_snapshot` (`before_start`, `before_professional_ref`, `appointment_ref`, `affected`) e `batch.draft.snapshot.{cancel,create}`.
   - Roda em todo caminho que passa por `preparePlanSafely`: mensagem, resume, seleção, opção.
2. **Módulo puro novo** (arquivo novo, portanto UNPINNED), por exemplo `packages/salon-secretary/src/plan-invariants.ts`. Recebe claims e releases normalizados + `execution_order` + `depends_on` e devolve achados `{code, keys, kind: ASK | EDGE}`.
   - **ASK:** retira a proposta e faz uma pergunta, como `:457-467`.
   - **EDGE:** cria uma aresta de execução derivada via `refreshActionPlan`, como `releaseAfter`. Os componentes se juntam no mesmo grupo e a ordem é respeitada em `executeConfirmationGroup` (`action-plan.ts:231-255`). Um ciclo vira pergunta.
3. **Horário liberado e reocupado sem vínculo:** quando uma ocupação só colide com um atendimento que outra ação aberta do plano libera, a EDGE + `references.released` + `reseedScheduling` (`secretary-scheduling.ts:1092-1102`) preparam a proposta com a projeção. Nada é silencioso: o dono vê o grupo junto.
4. **"Uma depois da outra":** precisa de um vínculo novo, com flag, na maquinaria `same_as`:
   - campo ou tipo em `same-as.ts:18-19` e `:55-70`, na descrição do wire `:37-48` e em `checkReferences` `:84-98`;
   - `referencedValues` expor o fim (hoje só início, `secretary-same-as.ts:35-45`);
   - semeio em `prepareReferences` (`:1154-1269`) e re-derivação em `followReferences` (`:1297-1377`);
   - o validador confere se os horários ficam contíguos.
5. **Contradições entre ações:** mesmo `appointment_ref` com duas ações mutantes abertas (cancel + change, change + change), mesma cliente com duas criações sobrepostas, ocupação dentro de um bloqueio do plano (já coberto), `DISCARD` que deixa um vínculo órfão (`syncReferences` já cobre). Todas viram pergunta, nunca resolução automática. Telemetria só com códigos, via `trace.failed`.
6. **Na confirmação:** `confirmReadyGroups` e `confirmActionPlanGroup` (`:1900-1938`, `:1834-1858`) rodam a mesma checagem determinística sobre o conjunto admitido antes de executar. Os executores de domínio continuam re-checando a agenda gravada.

Tudo isso com flag desligada por padrão (por exemplo `SALON_SECRETARY_PLAN_INVARIANTS`). Mudanças de grupo alteram os fingerprints, o que deixa aprovações antigas obsoletas. Isso é esperado.

## 6. Não verificado / riscos
- Se o SDK 0.18 com `store:false` reenvia itens `reasoning` entre rodadas, o que o guarda HTTP atual recusaria.
- Tamanho do corpo com todas as flags da C5.
- Custo real em tokens por chamada: a telemetria do banco não foi consultada.
- Se o caminho `:1649-1650` é alcançável com o roteamento ativo.
- Aprovação do dono para enviar à OpenAI nomes de clientes que não estão na mensagem.
- Nenhum teste, tsc ou build foi rodado. Nenhum arquivo foi alterado.
