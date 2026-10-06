# Gate 3.1C-B — observabilidade local de `INVALID_RESPONSE`

## Estado preservado

A calibração real parou no caso 18 após 17 avaliações completas e 31 requests HTTP. O discovery do caso 18 recebeu HTTP 200, mas o adapter descartou o corpo quando o parser rejeitou a resposta. A incompatibilidade concreta dessa resposta histórica é desconhecida. O relatório `packages/salon-secretary/evaluation/acceptance-calibration-real-2026-09-23.json` permanece intacto; os casos 1–17 não serão repetidos.

A Acceptance Policy, sua allowlist, o dataset, o gabarito, as perguntas/choices e o catálogo de derivações não mudaram. JEV continua somente em avaliação, fora do runtime da Secretária. Nenhuma resposta do JEV concede autoridade operacional.

## Diagnóstico seguro

O adapter cria um esboço sanitizado **antes** de chamar o parser estrito, mas só o associa ao resultado se a resposta falhar. `error` e `fallbackReasons` continuam `INVALID_RESPONSE`; `decision` permanece `null`; a Acceptance Policy retorna `FALLBACK_REQUIRED`. Não há reparo, retry ou normalização do provider.

`invalidResponseDiagnostic` contém:

- `reason` e `path` do primeiro problema estrutural identificável;
- HTTP status e `x-request-id` apenas quando o identificador passa pelo filtro já existente;
- tipo do corpo, campos top-level **publicados** presentes e contagem de campos extras;
- tipo/modelo publicado, contagem de answers, dimensões publicadas retornadas e extras contados;
- por dimensão publicada: tipos observados, choice apenas se estiver nas choices aprovadas, probabilities numéricas válidas apenas para choices aprovadas, confidence numérica válida, e contagem de chaves extras;
- usage numérico somente quando possui contagem de tokens válida.

Strings arbitrárias do corpo, nomes de campos extras, choices desconhecidas, credencial, header `Authorization`, mensagem de erro bruta e corpo completo nunca entram no diagnóstico. Um campo desconhecido é representado por contagem/tipo e o caminho do campo publicado que falhou. Esta estrutura é para artefatos de **evaluation/local**, nunca para logs produtivos ou telemetria da Secretária. `modelReturned` só aparece no esboço quando é o model ID publicado; valor divergente é omitido.

Reason codes de observabilidade: `MALFORMED_PROVIDER_RESPONSE`, `MISSING_FIELD`, `INVALID_TYPE`, `INVALID_CHOICE`, `QUESTION_COUNT_MISMATCH`, `PROBABILITY_SCHEMA_INVALID`, `CONFIDENCE_SCHEMA_INVALID`, `USAGE_SCHEMA_INVALID`, `MODEL_MISMATCH`, `UNEXPECTED_FIELD`, `SEMANTIC_CONFLICT` e `UNCLASSIFIED_VALIDATION_FAILURE`. O último conserva fail-closed se surgir rejeição não mapeada; não é classificação do caso 18 histórico.

O contrato atual exige top-level `model` e `answers`, aceita `usage` opcional e é estrito quanto a campos extras no corpo. `confidence` é opcional no transporte, mas sua ausência continua gerando motivo de fallback. Um header HTTP adicional é tolerável; um campo JSON adicional não é. A validação estrita original dos parsers permaneceu inalterada.

## Continuação preparada, não executada

`prepareAcceptanceCalibrationContinuation()` retorna apenas os casos 18, 19 e 20 do plano congelado, com seus payloads originais, máximo de 6 HTTP adicionais e zero retries. O caso 18 usa exatamente `Quanto faturei ontem e altere a massagem para R$80?` e as mesmas perguntas/choices de discovery persistidas na tentativa anterior. O plano exige o relatório prévio com 17 avaliações concluídas, 31 HTTP tentados e SHA-256 `c114a7fe1220503ab86bf6913c68056cc7834930b59486e1b9f86843baf19616` antes de qualquer retomada. O relatório novo deve registrar somente `invalidResponseDiagnostic`, caso retorne outro `INVALID_RESPONSE`, e deve ser separado do relatório 1–17.

A função de preparação não chama JEV, OpenAI, banco ou Tools. Qualquer execução posterior requer autorização específica, preflight de credencial/payload/tarifa, verificação de hash e parada imediata no primeiro erro conforme Gate 3.1C-B. Não há permissão nesta entrega para executar os casos 18–20 ou iniciar 3.1C-C.

## Rollback

Remover `invalid-response-diagnostic.ts`, `acceptance-calibration-continuation.ts`, este documento e os testes novos; retirar apenas o campo opcional de `EvaluationResult` e as linhas de captura sanitizada do adapter. Não tocar no relatório real, Acceptance Policy, allowlist, dataset, perguntas/choices, catálogo ou resultados já obtidos. Não há rollback de banco, recursos remotos ou runtime porque nenhum deles foi alterado.
