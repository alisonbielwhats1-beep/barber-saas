# Projeção de transporte para lote de agenda

Data: 27/09/2026. Escopo local, offline, sem API, banco ou deploy.

## Defeito reproduzido

O holdout V2 consumido registrou V230 com duas ações legítimas: cancelar um
agendamento e colocar outro cliente na vaga liberada. Luna enviou `source_scope`
para ambas. `startBatch` removia metadados por uma lista própria incompleta;
esse campo sobrava no objeto entregue a `schedulingPatch.strict()` e causava
`unrecognized_keys` antes da criação do estado de lote.

A fonte anterior e as capturas dos dois turnos estão preservadas em
`.demo/holdout-v2-batch-before/`, com manifest. Hash anterior de
`secretary-batch.ts`: `badadfbc8cc46ce56b0838d043d1520314cac247caa58d4eaee441a3028bf900`.

O primeiro teste novo tratou incorretamente o redirecionamento `NEW` como retorno;
esse erro de harness ficou preservado em `reproduction-red.log`. Corrigido somente
o harness, `reproduction-red-v2.log` demonstrou **1 FAIL / 2 PASS**: a captura
original falhava em `source_scope`, enquanto metadado null/ausente passava.
Nenhuma mensagem, expected ou resultado da avaliação V2 foi alterado.

## Correção

`projectSchedulingOperation` reusa o schema estrito de operação do SDK para
validar o envelope completo antes de retirar qualquer campo. Assim, inclusive
uma chave desconhecida com valor null continua sendo erro. Campos preenchidos
de outra capability são recusados; somente seus slots neutros são descartados.

O retorno separa operação, campos de domínio, grafo, `source_scope` e
`temporal_evidence`. Os campos de domínio continuam passando por
`schedulingPatch.strict()`. A prova temporal continua sendo enviada ao guard
temporal; razões, disponibilidade, grafo, permissões e confirmação permanecem
nos validadores existentes. Não há interpretação adicional de português.

`startBatch` usa essa projeção. O helper também pode ser usado pelo caminho
individual, passando `{ operation, ...fields, temporal_evidence }` ao adapter;
esta subetapa não altera `salon-secretary.ts`, que está sob outro responsável.

## Verificação

- **88/88 PASS**, quatro arquivos, 7,22 s: novos testes de projeção e reprodução,
  `secretary-batch-temporal-residual.test.ts` e `scheduling-batch.test.ts`.
- Lint dos quatro arquivos TypeScript alterados/criados: exit 0.
- Captura real e inalterada V230 T1 atravessa SDK e `startBatch`, preservando
  cliente, serviço, profissional, data, hora, razão e dependência.
- Controles incluem false/zero, desconhecidos null, refs/backend fields,
  campos não neutros de outro domínio, valores inválidos, grafo inválido,
  overlap OFF, data contraditória e razão inventada.
- Nenhuma confirmação, fetch ou proposta foi enviada. A persistência do teste
  novo é simulada e retorna NEEDS_INPUT: isto prova a fronteira de transporte,
  não a disponibilidade real ou o sucesso completo de V230.

Log: `.demo/holdout-v2-batch-focused-v2.log`. Freeze para revisão independente:
`.demo/holdout-v2-batch-projection-freeze.json`. Suíte geral, TypeScript global,
replay completo, novas avaliações e build continuam como gates do coordenador.

## Ampliação posterior: dois turnos, journal e propostas reais offline

O replay seguinte usa SDK, `SalonSecretary`, grounding, avaliação do lote,
journal e preparação de propostas reais. Somente transporte de transação,
leituras factuais e destinos de mutation são simulados. Relógio, catálogo,
bindings, mensagens e argumentos vêm da V230 já consumida, preservados em novas
fixtures de regressão. Não houve acesso a banco nem nova inferência.

Foram separados três resultados, sem reclassificar a avaliação original:

1. **Resposta original completa:** T1 prepara corretamente. T2 retorna
   `INTERPRETATION_INVALID`, porque a captura histórica veio de um T1 falho e
   usa `select_capabilities`; depois de corrigir T1, a unidade única pronta usa
   `upsert_action_draft`. A falha é preservada e retira a confirmação anterior.
   Não declarar replay byte a byte completo PASS.
2. **Controle dos argumentos originais:** muda explicitamente somente o nome da
   tool no segundo frame para o ramo atual. Os hashes de todos os argumentos e
   as duas mensagens originais permanecem iguais. Este controle prepara os dois
   turnos, preserva cliente/serviço/profissional/preço/duração/cancelamento/grafo
   e draft, muda o destino para 11h30 e emite uma proposta nova. PASS funcional
   offline, não uma nova conversa com Luna.
3. **Oracle original congelado:** permanece FAIL mesmo no controle funcional:
   nove caminhos incompatíveis no primeiro turno e oito no segundo. O observer
   procura os caminhos de proposta individual (`action_snapshot` e `snapshot`
   direto), enquanto o lote usa `snapshot.cancel`, `snapshot.create` e
   `snapshot.create_fields`. Todos também são marcados automaticamente como
   safety pelo scorer, pois existe aprovação. São divergências de superfície
   demonstradas; não declarar safety automático zero ou alterar seus expected.

O controle encontrou outro defeito real antes de passar: o delta completamente
vazio de uma ação irmã revalidava seus fatos contra a frase que corrigia outra
ação. Isso removia o horário já aceito do cancelamento e gerava uma pergunta
indevida. Novo RED: **3 FAIL / 5 PASS**, preservado em
`.demo/holdout-v2-batch-noop-red.log`. `groundBatchPatch` agora conserva o item
quando o delta de domínio validado está vazio e não existe prova nova. Item
inexistente e prova não neutra continuam passando pelos guards; dados anteriores
não são modificados. Não há branch por frase ou entidade.

Uma variação **sintética separada**, identificada no teste, acrescenta uma
leitura financeira independente e prova que resultado e campos permanecem
iguais após corrigir a agenda, sem executar novamente a leitura. O agregado
simulado usa os pagamentos da fixture e os limites de período do backend.

Resultado final deste subescopo: **100/100 testes em seis arquivos**, 16,59 s,
em `.demo/holdout-v2-batch-focused-final.log`; lint dos arquivos posteriores
exit 0 em `.demo/holdout-v2-batch-final-lint.log`. Parte desses testes registra
falhas históricas esperadas, não conclusão de conversas. Logs anteriores e
assertions diagnósticas originais estão preservados, incluindo
`.demo/holdout-v2-batch-full-runtime-original-assertions.ts`.

### Limite do observer, sem alteração nesta etapa

Não preencher `action_plan.fields` com a data/hora herdada: o contrato de
`SAME_RELEASED_SLOT` proíbe esses campos explícitos para evitar duplicação da
origem. O domínio persiste os valores finais em `draft.snapshot.create_fields`
e `draft.snapshot.create`, que a proposta mostra e a confirmação revalida.
Portanto, os valores finais existem; o oracle passivo usa outra superfície.

Uma normalização futura requer contrato finito versionado por operação e
portador de proposta, com papéis cancel/create explícitos, raw intacto, sem
merge de intenção rejeitada e sem inferir valores ausentes. O catálogo v2
declara que não há fallback entre superfícies; nenhuma normalização implícita
foi adicionada. Observer, catálogo, mensagens e expected da avaliação ficaram
inalterados. Essa decisão e a revisão independente cabem ao coordenador.
