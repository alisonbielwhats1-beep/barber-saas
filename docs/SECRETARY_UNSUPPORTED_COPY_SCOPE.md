# Copy de capability indisponível sem referente inventado

## Evidência e causa

Na Golden v11, GF30 T2, Luna respondeu com `UNSUPPORTED`, categoria `salon_hours` e texto `Não consigo configurar o horário de trabalho dela por aqui.` O turno anterior tratava do cadastro de uma profissional. A copy fechada do backend acrescentava `do estabelecimento`, embora essa categoria não identifique o alvo.

O oracle congelado marcou esse turno como PASS porque avaliava capability, ausência de ações e confirmação. O desvio de referente foi observado na revisão adicional. As mensagens, respostas do provider, resultados e expecteds históricos permanecem preservados; esta correção não muda a pontuação já produzida nem constitui uma nova execução Golden.

## Correção

`unavailableCapabilityMessage` agora diz: **Ainda não consigo configurar horários de trabalho pela Secretária.**

Essa mensagem afirma apenas a limitação operacional demonstrada pela categoria. Serve para horários de uma profissional, do estabelecimento ou com alvo não especificado. Não examina frases, pronomes ou nomes; não introduz parser, inferência, enum, schema ou rota nova.

A prosa livre de `UNSUPPORTED` continua informativa e não é exibida como promessa ou recibo. O limite de 600 caracteres é uma restrição sintática, não uma validação factual. Reutilizar indiscriminadamente a prosa aceita em `CONVERSATION` permitiria anunciar sucesso sem execução. As perguntas operacionais continuam derivadas do estado factual do backend.

O helper é compartilhado pelos caminhos fresh, redirecionamento com plano existente e compatibilidade de PATCH informativo. A alteração não modifica o SDK nem o coordenador.

## Validação offline

- Novo `secretary-unsupported-copy.test.ts`: 14/14 casos.
- Doze casos recorded exercitam os três caminhos com profissional, estabelecimento, alvo não especificado e prosa que alega sucesso/preparação indevidamente.
- Dois casos usam o envelope LIVE atual via SDK com transporte HTTP inteiramente falso. Nenhuma chamada de rede ou inferência real foi realizada.
- Fresh: `UNSUPPORTED`, zero ações, drafts ou proposals e confirmação desabilitada.
- Plano existente: zero ações novas, campos/drafts preservados, nenhum novo upsert/proposal, confirmação desabilitada e aprovação forjada rejeitada com `PLAN_NOT_READY`.
- O caminho informativo de `applyExistingPlanPatches` é compatibilidade recorded. O envelope LIVE informativo redireciona antes para o caminho existing. Os testes distinguem essas evidências.
- Suítes afetadas: novo teste + `secretary-action-plan-runtime.test.ts` + `secretary-wire-real-replay.test.ts`, **109/109 PASS**.

Logs: `.demo/unsupported-copy-tests.log` e `.demo/unsupported-copy-lint.log`. Snapshot original do helper: `.demo/unsupported-copy-before/secretary-capability-status.ts`, SHA256 `1837afba90c0dd630066116a60d23da812c430db3b06ebdfe6cb804067d4f13f`.

Limite: essa evidência valida uma correção de apresentação e preservação dos gates. Não mede generalização de Luna, não altera o resultado da Golden v11 e não libera staging.
