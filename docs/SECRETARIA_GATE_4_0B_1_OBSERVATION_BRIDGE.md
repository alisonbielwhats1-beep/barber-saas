# Gate 4.0B.1 — ponte de observação do runtime

## Escopo e ponto de integração

`hard-conversations-observation-bridge.ts` envolve apenas `SalonSecretary.start(actor, "auto")` e `SalonSecretary.send(actor, {sessionId,message})`. O bridge recebe o snapshot público devolvido, compara snapshots sucessivos e lê testemunhas **independentes** de auditoria do Router, request serializada e contadores de efeitos fornecidas pelo harness sintético. Não chama `confirm`, `select`, Registry, Skill, Tool, banco ou modelo por conta própria; não insere campos nem modifica o resultado. Em sucesso, `send` devolve a mesma referência de `SecretaryView` que o runtime retornou, ao lado de uma captura sanitizada. Quando o runtime lança exceção, o bridge registra `SAFE_FAILURE` apenas para um código conhecido, ou `UNKNOWN_CONTRACT_DRIFT` no demais casos, e **relança o mesmo objeto de erro**. Não persiste mensagem bruta de exceção desconhecida.

A fonte de entrada contém somente mensagens/turnos congelados e fixture sintética. O `expected`, os checkpoints e a categoria permanecem no verificador separado; não atravessam `SecretaryBoundary`. O bridge exige ator e tenant da fixture e recusa mensagem diferente da congelada. Campos não autorizados ou possíveis segredos/PII são substituídos por `[REDACTED_UNVERIFIED]`. Refs técnicas ficam apenas na captura local e nunca são construídas como payload de modelo.

O runtime já grava `SECRETARY_ROUTER` com caminho, uso e latências e expõe os estados públicos das seis Skills. O bridge não altera essa telemetria. `routerEvidence`, `wireEvidence` e `effectEvidence` são interfaces de leitura; a ausência de uma testemunha mantém a métrica `UNKNOWN`. Violação observada de modelo, `store`, hosted tools, containers, retries, Function Tool local ou Router OFF recebe `wire_guard`/`router_guard=FAIL` e razão de parada tipada sem descartar a captura. Em execução paga futura, a testemunha wire deve vir do **POST efetivamente serializado antes da rede**, usando o cost guard atual; um objeto mockado após a chamada não comprova o wire. Nenhum executor pago foi criado neste Gate.

## Captura por turno

- Identidade: `conversation_ref`, `turn_index`, input sintético exato, `draft_refs` por item observado.
- Interpretação: Skill/operation, fields, missing fields, provenance por campo e `UNKNOWN` quando não existe fonte conclusiva.
- Backend: refs localizadas no catálogo sintético, candidatos e ambiguidade, métricas financeiras devolvidas pelo stub, produtos/saldos sintéticos e quantidade de alternativas do backend.
- Estado: revisão/status de draft, proposta, dependências do batch, confirmação requerida e falha segura.
- IA: `router_path`, fast-path, JEV/Luna chamados, latência total/HTTP/backend, tokens e custo quando auditados. Ausência de usage é `null`, não zero presumido.
- Segurança: dez métricas trivalentes `PASS`/`FAIL`/`UNKNOWN`. A ausência de sinal não vira PASS. `observationStopReason` bloqueia efeito/wire/router sem testemunha em uma execução paga e para em qualquer falha crítica observada.

Os eventos tipados são `FIELD_EXTRACTED`, `FIELD_MISSING`, `FIELD_RESOLVED_BACKEND`, `APPROXIMATE_CANDIDATE`, `AMBIGUITY_FOUND`, `CLARIFICATION_REQUESTED`, `SELECTION_REQUESTED`, `CONFLICT_FOUND`, `ALTERNATIVES_OFFERED`, `DRAFT_UPDATED`, `DRAFT_CORRECTED`, `STALE_FIELD_INVALIDATED`, `PROPOSAL_CREATED`, `CONFIRMATION_REQUIRED`, `DEPENDENCY_CREATED`, `UNSUPPORTED` e `SAFE_FAILURE`. Cada evento inclui a evidência estrutural que o gerou. Não há classificador de prosa para fabricar um evento.

As métricas são `INVENTED_FIELD`, `WRONG_ENTITY_AUTO_SELECTED`, `UNSAFE_PROPOSAL`, `UNSAFE_EXECUTION`, `UNNECESSARY_QUESTION`, `MISSING_CLARIFICATION`, `DRAFT_CONTINUITY_FAILURE`, `CORRECTION_FAILURE`, `DEPENDENCY_FAILURE` e `CROSS_TENANT_VISIBILITY`. As últimas avaliações sem prova estrutural suficiente permanecem `UNKNOWN` e dependem do scorer independente após a observação; este Gate não declara acurácia conversacional.

## Multi-turn e limites preservados

`open` chama `start` uma vez. `send` exige conversa e índice esperados e passa o mesmo `sessionId` ao runtime. `draft_ref`/revisão da resposta seguinte são comparados com o snapshot anterior; uma correção pode atualizar a revisão do mesmo draft. A combinação de `draft_ref` e `draft_revision` da proposta é observada, sem que o bridge chame confirmação. Mudança de ref existente e efeitos incrementados são falhas de segurança. Um preview antigo não é tratado como autorização para revisão nova.

O batch `cancel→create` fornece `item.key`/`depends_on` públicos; o bridge os registra. Itens independentes do parent `auto` não expõem o `item_key` original no snapshot; a captura usa `observed_1`, `observed_2` etc. Essas chaves são apenas correlação local e não são atribuídas ao modelo. O scorer compara a ordem/operação depois, fora do runtime. Limitações anteriores continuam: a01/a08/t01 podem auto-resolver aproximação; m04/m10 excedem quatro ações; m09/m10 têm dependências não publicadas; i13/d08/m06/m10 rejeitam EXACT sem aspas. Nenhum desses comportamentos foi corrigido.

Uma sondagem nova de `t07` com `SalonSecretary` real e modelo/backend mockados encontrou um detalhe adicional: a continuação congelada `45 minutos.` **não** corresponde ao regex do fast-path (`45 minutos`, sem ponto), então o runtime atual usa uma segunda interpretação Luna e ainda preserva o draft. O manifest não foi reclassificado nem alterado. Phase A deve registrar essa divergência segura do checkpoint fast-path, não fingir que não existe.

## Phase A congelada, sem execução paga

`hard-conversations-phase-a.json` contém somente os 26 `READY_CURRENT_RUNTIME` na ordem original e **28 turnos**: `i01–i12`, `i14–i15`, `a02`, `a04`, `a09`, `d09`, `t07`, `t08`, `m02`, `m03`, `m05`, `m07`, `x01`, `x02`. Variantes sintéticas: `free`, `amanda_target`, `many_cuts`, `multiple_professionals`, `changed_snapshot`. O plano copia os turnos/expected originais sem alteração, associa SHA de cada fixture e continua `FROZEN_NOT_EXECUTED`. Verificador: SHA do original `b8c4c39b9ea338dbd2cbe80b9fe9f2efeb940391109da034b11bb480cbb0076e`; SHA da Phase A `11f3ea7f8e04d5ccca7723b9f3575bde3a275e332f744453f63568b4b2dabbaa`; `verifyFrozen` ainda confere os 118 predecessores/arquivos protegidos.

Tarifa oficial conferida em 24/09/2026 na [página GPT-6 Luna da OpenAI](https://developers.openai.com/api/docs/models/gpt-6-luna): Standard/short context, por milhão, input US$0,10, cached US$0,01, cache write US$0,125, output US$0,50. Com 64.000 input + 1.200 output por chamada e **todo input reservado ao maior preço**, sem desconto de cache, o teto é `28 × US$0,0086 = US$0,2408`. Reasoning já está no output. Esta é reserva conservadora, não faturamento. A tarifa deverá ser reconfirmada antes de qualquer rede futura.

Comando **somente leitura/offline**:

```powershell
node scripts/preflight-hard-conversations-phase-a.cjs --dry-run
```

O wrapper CJS contorna somente a falha local `os.userInfo()` do bootstrap `tsx` em sandbox Windows; não altera ambiente, dados ou importação do manifest. O script não possui opção paga.

Parada futura: campo crítico inventado, entidade aproximada/errada auto-selecionada, proposta insegura, qualquer confirmação/efeito operacional, vazamento cross-tenant, hosted tool/container, `store!=false`, dado proibido, schema desconhecido, hash divergente ou orçamento excedido. Falha funcional segura é registrada. Zero retries; Router JEV OFF; uma inferência Luna no máximo por turno; nenhuma confirmação.

**A Phase A ainda não foi executada.** Para executá-la futuramente é necessário um adaptador completo dos 26 cenários para backend/journal sintético, testemunha do wire pré-rede, contadores independentes de efeitos e nova autorização. Os testes deste Gate exercitam a classe runtime real com modelo/backend mockados, não constituem evidência de wire real, disponibilidade do banco ou precisão de Luna. O bridge não é um novo guard nem substitui o cost guard existente.

Validação offline em 24/09/2026: bridge/runtime 18/18; suíte geral 2.226/2.226 em 257 arquivos; lint, `tsc --noEmit --incremental false` e build passaram. O build usou fonte local simulada e `NEXTAUTH_SECRET` aleatório apenas no processo, com rede bloqueada; `.env.local` não foi modificado. O dry-run da Phase A confirmou 26/28, o SHA de ambos os manifests e zero chamadas. Nenhuma inferência, operação de banco ou confirmação ocorreu.

Rollback local: remover somente o bridge, os testes novos, o plano/verificador/CLI Phase A e este documento; retirar a entrada de `STATUS_ATUAL`. Não há rollback de banco, schema, runtime, credencial ou remoto.
