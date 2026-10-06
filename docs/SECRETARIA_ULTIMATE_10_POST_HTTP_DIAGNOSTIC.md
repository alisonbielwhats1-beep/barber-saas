# Ultimate 10 — diagnóstico offline após HTTP 200

**Escopo:** instrumentação exclusiva do runner de avaliação; nenhuma inferência nesta etapa. O manifest `ultimate-10-plan.json` permanece no SHA-256 `482b4fdfbf38e70da00e3507b6fb7e7167e66bdc40428c8f7767991cce077fb0`. O journal e o resultado histórico de u01 não foram editados.

## Evidência de u01 e limite da conclusão

O único request de u01, `req_fdcc0a46fe504c41b87af68be6e04e08`, recebeu HTTP 200 em aproximadamente 14,55 s; o turno levou aproximadamente 14,85 s. O journal comprova `BEFORE_NETWORK`, `AFTER_NETWORK`, `MODEL_FAILED`, observação segura, `INCONCLUSIVE` e `STOPPED`, sem `MODEL_COMPLETED`. O diagnóstico sanitizado registrou `UNKNOWN_PROVIDER_ERROR`, sem corpo, output, usage ou classe original da exceção. Não havia outros logs locais úteis com esse request ID. Não houve retry nem efeito operacional.

O erro foi observado **dentro de `model.getResponse`**, antes de este devolver `ModelResponse`: `observeModelGetResponse` o registrou; `instrumentServicesModel` em seguida o converteu em `MODEL_REQUEST_FAILED`. Assim, `modelCallUsage` do runner, a validação estrita de `select_capabilities` em `runServicesTurn` e o backend não chegaram a receber uma resposta convertida. A causa específica de u01 continua **UNKNOWN_POST_HTTP_ERROR**. HTTP 200 não comprova payload utilizável e não prova falha da OpenAI.

## Caminho e pontos de exceção

| Estágio | Código auditado | Possível falha após HTTP 200 |
|---|---|---|
| `fetch` → SDK | `ultimate-10-execution.ts`, `openai/internal/parse.js` | corpo vazio, content-type inesperado, JSON inválido, leitura abortada |
| SDK Responses | `openai/resources/responses/responses.js`, `openai/lib/ResponsesParser.js` | `addOutputText` percorre `output`; `output` ausente ou `message.content` inválido pode lançar antes de entregar objeto ao Agents |
| Agents model adapter | `@openai/agents-openai/dist/openaiResponsesModel.js` | snapshot de raw usage, status `incomplete`/`failed`, normalização de usage, conversão de output desconhecido ou malformado |
| validação da Function Tool | `packages/salon-secretary/src/index.ts` | zero/múltiplos itens não reasoning, nome diferente, argumentos JSON inválidos ou incompatíveis com `selectionSchema`/`validateSelection` |
| instrumentação e Secretária | `packages/salon-secretary/src/usage.ts`, `src/lib/salon-secretary.ts` | persistência de usage e orquestração podem falhar; o wrapper atual mascara a exceção original com `MODEL_REQUEST_FAILED` |
| bridge e runner | `hard-conversations-observation-bridge.ts`, `ultimate-10-execution.ts` | observação/persistência técnica, scoring e snapshot podem falhar após o modelo, sem provar falha do provider |

Usage ausente, por si só, **não bloqueia** `modelCallUsage`: o contrato já retorna `usage_status=UNAVAILABLE` e contadores `null`. O SDK ainda executa sua própria conversão de usage, que é um ponto distinto. Billing e cost guard não foram alterados.

## Testemunha sanitizada e checkpoints futuros

O runner agora registra, com fsync no journal existente, `HTTP_RESPONSE_RECEIVED`, uma testemunha `POST_HTTP_WITNESS`, `HTTP_BODY_PARSED` quando a cópia do corpo é JSON analisável, `SDK_RESPONSE_CREATED` ao retornar de `_fetchResponse` do Agents, `AGENT_MODEL_RESPONSE_CREATED` ao retornar de `getResponse`, e `TOOL_CALL_VALIDATED`/`MODEL_RESULT_READY` apenas após o runtime concluir o turno sem falha e com `MODEL_COMPLETED`. A leitura usa `Response.clone()` e não modifica o corpo original. `HTTP_BODY_PARSED` atesta somente a análise da **cópia pela testemunha**, não a conclusão do parser do SDK. A instrumentação do método interno `_fetchResponse` é exclusiva da instância de modelo da avaliação e falha antes da rede se esse ponto não existir na versão instalada.

Metadados persistidos: status, request ID validado, tipo de conteúdo categorizado, presença e bytes do corpo, estado do JSON, chaves de topo em allowlist, tipo do objeto, ID/model/status quando seguros, quantidade e tipos dos itens de output em allowlist, presença de usage, motivo de incompletude permitido, quantidade de Function Calls, nome permitido, validade sintática dos argumentos e validade do schema de `select_capabilities` como **booleanos**. Nunca se guardam argumentos, output, texto livre, headers arbitrários, payload bruto, Authorization ou secrets. Uma falha futura registra categoria pós-HTTP, último checkpoint e classe da exceção em allowlist, sem mensagem arbitrária.

Categorias possíveis: `HTTP_SUCCESS_INVALID_BODY`, `SDK_PARSE_ERROR`, `MODEL_OUTPUT_INVALID`, `AGENT_ADAPTER_ERROR`, `TOOL_CALL_SCHEMA_ERROR`, `RESPONSE_INCOMPLETE`, `USAGE_PARSE_ERROR`, `LOCAL_INSTRUMENTATION_ERROR` e `UNKNOWN_POST_HTTP_ERROR`. A classificação usa evidência de estágio e forma sanitizada; não reclassifica u01 retroativamente. Sem evidência suficiente, permanece UNKNOWN.

O teste offline usa `fetch` falso para HTTP 200 com corpo válido, vazio, JSON inválido, output ausente, `incomplete`, somente reasoning, Function Call válida, argumentos inválidos, usage ausente e tipo de output desconhecido. Também cobre schema inválido, nome inesperado, múltiplos itens, persistência/restart e redaction. O SDK local mostrou que um `output` ausente pode falhar **antes de `SDK_RESPONSE_CREATED`**: `Responses.create` chama `addOutputText`, que percorre `rsp.output`. O runner não relaxa esse contrato.

## CLI e retomada futura

O CLI retorna código 0 somente para `COMPLETED`; `STOPPED`, falha fatal ou preflight retornam código diferente de zero. O resultado e o checkpoint da bateria não mudam por causa do exit code.

Validação offline: os testes direcionados passaram; suíte geral, 265 arquivos e 2.322 testes, passou. `npm run lint` e `npx tsc --noEmit --incremental false` passaram. O CLI com comando inválido retornou código 1 e `ULTIMATE10_COMMAND_REQUIRED`, antes de banco ou rede. O primeiro `npm run build` compilou mas falhou na coleta de páginas por ausência local de `NEXTAUTH_SECRET`; repetido com segredo **sintético somente no processo**, paid calls e Router false, passou. Não se executou `--execute`, `--resume`, u01 ou qualquer inferência. O journal histórico continua com dez linhas, terminando em `STOPPED`; o hash do manifest e o hash selado de `hard-conversations-durable.ts` permanecem iguais.

`ULTIMATE10_REVALIDATE_U01` está **apenas preparado**: uma autorização específica futura deverá validar manifest/hash, journal histórico de u01, baseline e efeitos zero, ambiente descartável, wire witness, orçamento e flags antes de executar exatamente u01 com no máximo **uma** inferência GPT-6 Luna, zero retry/JEV/confirmação. Resultado válido: persistir observação e **parar antes de u02**. Falha novamente: preservar estágio e **não iniciar terceira tentativa automática**. O CLI atual `--execute`/`--resume` não representa essa autorização; não foi usado nem transformado em retomada permissiva nesta etapa.

Rollback de código: reverter `ultimate-10-post-http.ts`, sua integração em `ultimate-10-execution.ts`, o ajuste de exit code em `run-ultimate-10.ts` e os testes, mantendo o manifest e todo o journal histórico. Não limpar `u01` nem tratar `UNKNOWN` como PASS.
