# Gate 4.0B.3.1 — diagnóstico de falha OpenAI da Phase A

Nota posterior: o bloqueio de restauração descrito abaixo foi resolvido no
Gate 4.0B.3.1A. O estado atual e o rollback do banco estão em
`SECRETARIA_GATE_4_0B_3_1A_RESTORE_I01.md`; a revalidação paga continua não
autorizada.

## Evidência preservada e ponto de perda

A tentativa `i01` de 24/09/2026 enviou exatamente uma request observada pela
wire witness e parou em `MODEL_REQUEST_FAILED`. Não houve resposta interpretada,
`request_id`, `response_id` ou usage disponível. O resultado funcional de `i01`
é **UNKNOWN**. O relatório original e os dumps permanecem inalterados em
`packages/salon-secretary/evaluation/results/`.

A cadeia auditada é `run-hard-conversations-phase-a.ts` →
`SalonSecretary.start/send` → `runServicesTurn`/Agent →
`OpenAIResponsesModel.getResponse` → cliente OpenAI `responses.create` →
`secretaryGuardedFetch` → witness → `fetch`. O modelo do Agents SDK repropaga o
erro da chamada Responses. Antes de `instrumentServicesModel`, o erro do cliente
OpenAI pode conter `status`, `headers`, `requestID`, `error`, `type`, `code`,
`param` e `cause`, conforme as classes locais de `openai/core/error`. A resposta
HTTP ainda pode oferecer status e `x-request-id` mesmo quando o parsing do SDK
falha. Uma exceção do transporte pode conter nome/código causal, sem HTTP.

O `catch` de `packages/salon-secretary/src/usage.ts` (função
`instrumentServicesModel`) convertia a causa em status `FAILED`/`TIMEOUT`/
`ABORTED` e preservava apenas `error.request_id`, enquanto o SDK usa
`requestID`. Depois lançava `MODEL_REQUEST_FAILED`. O `SalonSecretary` pode
substituir novamente o erro público por `SECRETARY_TURN_FAILED`. O erro original
de `i01` não é recuperável dos artefatos históricos; não se atribui causa HTTP
ou transporte a ele retrospectivamente.

## Observabilidade nova, somente na avaliação

`hard-conversations-openai-diagnostic.ts` observa a resposta do `fetch` após a
wire witness e captura o erro bruto do modelo **antes** de
`instrumentServicesModel`. O wrapper relança o mesmo objeto de erro; o runtime,
Agent, prompt, cost guard, timeout, retries e resposta pública não mudam. O
relatório de avaliação passa a incluir `provider_diagnostic` por turno e
`provider_diagnostics` consolidados, somente quando ocorre falha.

Formato: `provider=OpenAI`, `model=gpt-6-luna`, endpoint class
`POST /v1/responses`, categoria, status HTTP quando observado, request ID
validado, `error.type/code/param` de allowlists estritas, mensagem sanitizada,
headers seguros (`x-request-id`, `retry-after` numérico,
`openai-processing-ms` numérico), categoria/código de transporte conhecido,
flags timeout/abort, latência do modelo e do `fetch`, e conflito entre status
observado e status reportado pelo SDK. Mensagem livre não reconhecida vira
descrição derivada de status/categoria com `message_redacted=true`. Categorias:
`HTTP_4XX`, `HTTP_5XX`, `RATE_LIMIT`, `MODEL_ACCESS` somente com código explícito,
`AUTH`, `TIMEOUT`, `ABORT`, `NETWORK`, `INVALID_PROVIDER_RESPONSE`, `SDK_ERROR`
e `UNKNOWN_PROVIDER_ERROR`. Sem evidência específica, usa a última categoria.

Nenhum corpo HTTP ou request, cabeçalho arbitrário, Authorization, API key,
cookie, URL de conexão, stack trace ou objeto `Error` é gravado. Valores
desconhecidos de type/code/param são descartados. A observação não decide
acceptance nem contorna o fail-closed: o erro público e a parada permanecem.

## Banco local e revalidação preparada

Os dumps pré/pós tentativa foram comparados por linhas: as 18 tabelas de
negócio/isolamento monitoradas permaneceram idênticas. Somente três entradas
técnicas `AuditLog` surgiram (`MODEL_CALL_STARTED`, `MODEL_CALL_FINISHED` com
`FAILED`, `DIRECT_LUNA`). O preflight read-only atual retorna
`PHASE_A_STALE_TECHNICAL_JOURNAL`, pois `precheckPhaseACase` exige zero auditoria
inicial por tenant. Os três registros foram preservados; nenhuma fixture ou
linha de banco foi modificada neste Gate.

Foi adicionada uma entrada separada `--revalidate-i01`, **não executada**. Ela
valida os manifests/hashes e o preflight completo de 26 casos, seleciona somente
`i01`, exige a mensagem exata “Agenda o Alisson pra amanhã.”, limita a witness a
uma request/US$0,0086, mantém `select_capabilities`, zero JEV, zero retries e
nenhuma API de confirmação. Usa flag de autorização separada, somente no
processo: `PHASE_A_REVALIDATE_I01_APPROVED=true`; o resultado futuro terá
arquivo separado `hard-conversations-revalidate-i01-result.json`, preservando o
relatório histórico. O runner mantém paid calls e Router falsos em `finally`.

Antes de autorizar/executar essa entrada, é obrigatório restaurar o dump pronto
`phase-a-ready-before-paid-battery.dump` (SHA-256
`28c02b254017e4be377591898ec30e31e1405e22868d4de790597269bb6f6093`)
**somente em PostgreSQL local descartável novo/vazio**, com identificação,
backup, RLS/FORCE RLS, role runtime e isolamento verificados pelo procedimento
de `SECRETARIA_GATE_4_0B_2_1_DISPOSABLE_DB.md`. Não aplicar SQL manual nos três
AuditLogs nem restaurar sobre o banco existente. Depois, `--preflight` deve
retornar 26/26 e 28/28 antes de uma autorização separada de inferência.

A revisão automática de permissões rejeitou iniciar o cluster local alternativo
em `127.0.0.1:55442`, por entender que a autorização se limitava à porta
`55441`. Um diretório temporário novo foi inicializado pelo `initdb`, mas o
servidor não iniciou, não recebeu dados e não substituiu o banco atual. Nenhum
restore foi executado naquele Gate. A autorização explícita posterior permitiu
concluir a restauração e a troca controlada, preservando o banco anterior como
evidência; ver Gate 4.0B.3.1A.

Se a única revalidação falhar, preservar o diagnóstico sanitizado e parar. Se
passar, registrar interpretação, clarificação, usage/custo, wire, segurança e
efeitos, e também parar. `i02–i26` não fazem parte da revalidação.

Rollback de código: remover o módulo de diagnóstico e os testes deste Gate,
reverter apenas a instrumentação evaluation-only em
`hard-conversations-phase-a-execution.ts`, a opção de uma request em
`hard-conversations-phase-a-witness.ts` e o comando `--revalidate-i01` no CLI.
O relatório original, manifest, parser, produto e banco não exigem rollback.
