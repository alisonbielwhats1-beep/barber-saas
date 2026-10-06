# Gate 3.1C-B.3.1 — retomada fail-closed da Wave 1 (não executada)

O relatório real f01–f04 permanece imutável (SHA-256
`6b7d524c4b13e163450fd7404f38f2544c0069c8b8e35adae35db2fa7b06797b`).
O manifest original da Wave 1 permanece imutável (SHA-256
`0db86b3cd6087cfaa6a1d8403aeeb481ca2d718cf4afa61df5c0cabe380e2de7`).
O novo manifest de retomada é `packages/salon-secretary/evaluation/coverage-expansion-wave1-continuation.json`.
Ele referencia exclusivamente f05–f32, com mensagens, expected, perguntas, choices e ordem extraídos
do manifest original. O gabarito nunca entra no corpo enviado ao JEV.

## Matriz de parada do harness

Antes, `INVALID_RESPONSE` interrompia a Wave mesmo quando a Acceptance Policy havia devolvido
`FALLBACK_REQUIRED`. Agora uma resposta HTTP 200 inválida só permite `CONTINUE_WAVE` quando o
diagnóstico sanitizado é conhecido e coerente com a request, a interpretação é nula, e a policy
retorna `FALLBACK_REQUIRED / INVALID_PROVIDER_RESPONSE`. Isso inclui soma inválida das
probabilidades, choice/tipo/contagem inválidos e corpo malformado já classificado. Esses casos
continuam **inválidos**; não recebem crédito de acerto linguístico nem se tornam `ACCEPT_JEV`.

`CORRECT_ACCEPT`, `CORRECT_FALLBACK`, `FALSE_FALLBACK` e `OUT_OF_CATALOG_CORRECT` também permitem
continuação. A Wave para em `UNSAFE_FALSE_POSITIVE`, `UNSAFE_SHADOW_CANDIDATE`, diagnóstico
desconhecido, campo de schema inesperado, modelo divergente, falha de fail-closed, hash/catálogo
divergente, payload proibido, orçamento excedido e condição não reconhecida. HTTP 500, outros
erros HTTP, timeout e falha de rede param sem retry: não são tratados como respostas HTTP 200
inválidas e classificadas. Esta é a escolha conservadora até evidência específica.

O parser e a policy não mudaram. `sum=0,99` e `sum=1,01` continuam rejeitados; nenhuma
probability ou confidence é reparada ou renormalizada. A allowlist atual permanece com as duas
entradas anteriores. O catálogo de derivações e o runtime permanecem intactos.

## Métricas independentes

O harness registra as seis classes de resultado separadamente. Para confiabilidade do provider,
conta HTTP tentado, HTTP 200, respostas válidas e inválidas, falhas do contrato de probabilities,
outras falhas de schema e diagnósticos específicos (`invalid_probability_sum`,
`invalid_probability_other`, `invalid_choice`, `invalid_type`, `invalid_count`,
`semantic_conflict`, outros conhecidos). As taxas de resposta válida/inválida, falha de
probability e schema usam HTTP tentados como denominador. `HTTP_success_but_invalid_rate` usa
somente HTTP 200. Acerto linguístico usa somente avaliações com interpretação estrutural
completa; acerto entre aceites usa somente `ACCEPT_JEV`. Assim f04 não vira acerto do JEV.

Nos quatro casos preservados: f01 `CORRECT_ACCEPT`; f02–f03 `CORRECT_FALLBACK`; f04
`INVALID_PROVIDER_RESPONSE / FALLBACK_REQUIRED` com `invalid_probability_sum`. A nova matriz
continuaria após f04. Foram 6 respostas estruturais válidas e 1 inválida em 7 HTTP 200;
isso descreve apenas a amostra, não a confiabilidade em produção.

## Retomada preparada

- f05 → f32: 28 avaliações, no máximo 56 HTTP adicionais, zero retries.
- Teto conservador adicional: US$0,150528, calculado a partir de 56 × 64.000 tokens de entrada
  × US$0,042/M. É estimativa de planejamento, não cobrança; reconfirmar tarifa antes de executar.
- O runner de retomada é desativado por padrão; exige autorização separada e flag de execução
  exclusiva. Seu preflight verifica hashes, f01–f04, payload exato, credencial sem exposição,
  paid flag OpenAI false, modelo oficial e orçamento antes de qualquer POST JEV.
- O relatório novo, se a execução for futuramente autorizada, será separado do relatório f01–f04.
  Nenhum caso anterior pode ser repetido por esse runner.

Rollback local: remover somente o harness, testes, manifest e runner de retomada. Preservar o
relatório real f01–f04 e o plano original; restaurar a regra anterior de parada interromperia
novamente a Wave em toda resposta inválida. JEV continua fora do runtime; GPT-6 Luna segue como
fallback oficial da Secretária.
