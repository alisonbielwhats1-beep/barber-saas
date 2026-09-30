# Catálogo de avaliação da Secretária: cobertura

Gerado por `node packages/salon-secretary/evaluation/dataset/build-catalog.cjs` (somente leitura sobre as fontes; não editar à mão).
Dados por caso em `catalog.json`; checagens cruzadas em `.demo/agenda-core/oracle-audit/catalog-crosschecks.json`.
Nenhum texto de mensagem, nome de cliente ou motivo aparece aqui: só IDs, códigos, contagens e hashes.

## Resposta curta: quantas mensagens já foram testadas

- **1710 turnos reais da Luna avaliados** em 41 rodadas (cada turno = uma mensagem do dono ou uma resposta roteirizada enviada à Luna real e avaliada pelo oráculo).
  - DEV (V, N, multi-salão): 947 turnos em 700 tentativas avaliadas;
  - regressão (A/B/C antigas + Golden 30): 763 turnos em 489 tentativas avaliadas;
  - escolha (validação) e prova (holdouts lacrados): **0** (nunca rodados; o registro não tem nenhuma olhada).
- **284 textos distintos** efetivamente enviados (depois de datas renderizadas e ruído aplicado).
- Chamadas ao modelo: 1253 nas rodadas da Agenda + 475 requisições nas rodadas da Golden.
- Casos catalogados com metadados: 214 (dev 144, validation 0, test 0, regression 70); mais 116 casos lacrados declarados nos docs (5 conjuntos, só sha256).
- Mensagens escritas nesses casos: 244 falas roteirizadas + 198 variações de resposta a perguntas da Secretária (só enviadas quando ela pergunta). Das 214 definições, 134 já rodaram com a Luna real; as 80 do multi-salão ainda não.

Um "turno" conta mensagens enviadas (fala roteirizada `say` ou resposta `answer:*`); cliques de Confirmar/escolher não contam. Rodadas repetidas (k) contam cada vez: é o volume testado, não o número de frases diferentes.

## Por gaveta (split)

| split | casos | definições distintas | mensagens roteirizadas | variações de resposta | casos já avaliados | tentativas avaliadas | aprovadas | turnos Luna | textos enviados distintos | conjuntos lacrados (casos declarados) |
|---|---|---|---|---|---|---|---|---|---|---|
| dev | 144 | 144 | 148 | 156 | 64 | 700 | 483 (69%) | 947 | 177 | 0 (0) |
| validation | 0 | 0 | 0 | 0 | 0 | 0 | 0 (-) | 0 | 0 | 1 (30) |
| test | 0 | 0 | 0 | 0 | 0 | 0 | 0 (-) | 0 | 0 | 4 (86) |
| regression | 70 | 70 | 96 | 42 | 70 | 489 | 418 (85%) | 763 | 107 | 0 (0) |

A taxa de aprovação acima soma todas as rodadas (inclusive as antigas, antes das correções, e as com ruído): serve para volume, não como nota. A nota vale por rodada (tabela de rodadas) e só na mesma definição de caso.

## Por bateria

| bateria | fonte | split | status | casos | mensagens roteirizadas | casos já avaliados | tentativas | turnos Luna | proveniência do gabarito |
|---|---|---|---|---|---|---|---|---|---|
| V | assistant | dev | active | 34 | 35 | 34 | 443 | 586 | double-annotated 34 |
| N | assistant | dev | active | 30 | 31 | 30 | 257 | 361 | single-author 30 |
| A | legacy | regression | regression | 15 | 21 | 15 | 72 | 143 | single-author 15 |
| B | legacy | regression | regression | 13 | 16 | 13 | 52 | 88 | single-author 13 |
| C | legacy | regression | regression | 12 | 15 | 12 | 36 | 60 | single-author 12 |
| MD | generated | dev | active | 80 | 82 | 0 | 0 | 0 | single-author 80 |
| GF | assistant | regression | regression | 30 | 44 | 30 | 329 | 472 | single-author 30 |
| holdout:assistant-v1 | assistant | test | active | 26 (declarado) | - | 0 | 0 | 0 | sem gabarito estruturado ainda |
| holdout:owner-v1 | owner | test | active | 30 (declarado) | - | 0 | 0 | 0 | sem gabarito estruturado ainda |
| holdout:owner-multi-v1 | owner | test | active | 30 (declarado) | - | 0 | 0 | 0 | sem gabarito estruturado ainda |
| holdout:validation-v1 | assistant | validation | active | 30 (declarado) | - | 0 | 0 | 0 | sem gabarito estruturado ainda |
| holdout:multi-salon-v2 | unknown | test | active | ? (declarado) | - | 0 | 0 | 0 | sem gabarito estruturado ainda |

## Rodadas avaliadas

| rodada | evidência | estágio | k | casos | tentativas | turnos | chamadas | válida | turnos conferem com passk.json |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-27T15-42-46-469Z-smoke | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 1 | 1 | 2 | 2 | - | n/a (sem passk.json) |
| 2026-09-27T15-44-15-537Z-baseline1 | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 14 | 14 | 27 | 27 | - | n/a (sem passk.json) |
| 2026-09-27T15-47-07-139Z-diag1 | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 3 | 3 | 4 | 4 | - | n/a (sem passk.json) |
| 2026-09-27T15-50-27-062Z-diag2 | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 1 | 1 | 2 | 2 | - | n/a (sem passk.json) |
| 2026-09-27T16-01-33-832Z-retest1 | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 8 | 8 | 13 | 13 | - | n/a (sem passk.json) |
| 2026-09-27T16-02-35-960Z-r2 | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 13 | 13 | 22 | 23 | - | n/a (sem passk.json) |
| 2026-09-27T16-11-09-204Z-r3a | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 15 | 15 | 31 | 32 | - | n/a (sem passk.json) |
| 2026-09-27T16-13-28-388Z-r3b | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 13 | 13 | 22 | 23 | - | n/a (sem passk.json) |
| 2026-09-27T16-14-55-979Z-r3c | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 12 | 12 | 19 | 19 | - | n/a (sem passk.json) |
| 2026-09-27T16-18-40-761Z-r4a | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 15 | 15 | 32 | 32 | - | n/a (sem passk.json) |
| 2026-09-27T16-20-44-551Z-r4b | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 13 | 13 | 22 | 23 | - | n/a (sem passk.json) |
| 2026-09-27T16-22-10-619Z-r4c | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 12 | 12 | 20 | 21 | - | n/a (sem passk.json) |
| 2026-09-27T17-09-12-669Z-final-a | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 15 | 15 | 32 | 33 | - | n/a (sem passk.json) |
| 2026-09-27T17-11-21-858Z-final-b | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 13 | 13 | 22 | 23 | - | n/a (sem passk.json) |
| 2026-09-27T17-12-46-775Z-final-c | recomputed:legacy-E-map | agenda-core-20260927 | 1 | 12 | 12 | 21 | 21 | - | n/a (sem passk.json) |
| 2026-09-28T03-31-46-016Z-smoke | passk.json | reliability-20260927 | 1 | 2 | 2 | 4 | 4 | sim | sim |
| 2026-09-28T03-33-14-818Z-baseline-v | passk.json | reliability-20260927 | 3 | 34 | 102 | 132 | 136 | sim | sim |
| 2026-09-28T03-47-20-927Z-baseline-n | passk.json | reliability-20260927 | 2 | 30 | 60 | 82 | 87 | sim | sim |
| 2026-09-28T06-29-06-316Z-after2a-target | passk.json | reliability-20260927 | 2 | 7 | 14 | 26 | 26 | sim | sim |
| 2026-09-28T10-12-17-706Z-smoke-full | passk.json | reliability-20260927 | 1 | 2 | 2 | 4 | 4 | sim | sim |
| 2026-09-28T10-12-58-632Z-arm-off-v | passk.json | reliability-20260927 | 3 | 34 | 102 | 132 | 131 | sim | sim |
| 2026-09-28T10-32-23-723Z-arm-off-n | passk.json | reliability-20260927 | 2 | 30 | 60 | 84 | 84 | sim | sim |
| 2026-09-28T10-44-21-475Z-arm-selected-v | passk.json | reliability-20260927 | 3 | 34 | 102 | 132 | 131 | sim | sim |
| 2026-09-28T10-57-15-509Z-arm-selected-n | passk.json | reliability-20260927 | 2 | 30 | 60 | 84 | 84 | sim | sim |
| 2026-09-28T11-05-44-712Z-arm-full-v | passk.json | reliability-20260927 | 3 | 34 | 102 | 132 | 131 | sim | sim |
| 2026-09-28T11-19-38-360Z-arm-full-n | passk.json | reliability-20260927 | 2 | 30 | 60 | 84 | 86 | sim | sim |
| 2026-09-28T15-26-34-774Z-after2b-check | passk.json | reliability-20260927 | 2 | 6 | 12 | 24 | 24 | sim | sim |
| 2026-09-28T23-56-22-450Z-after4-candidate | passk.json | reliability-20260927 | 1 | 16 | 16 | 19 | 19 | sim | sim |
| 2026-09-29T00-40-48-769Z-after4b-fixcheck | passk.json | reliability-20260927 | 1 | 6 | 6 | 8 | 8 | sim | sim |
| golden-20260926-final-v2 | free-use results.json | golden-free-use-30 | 1 | 30 | 17 | 24 | 24 | não | sim (summary) |
| golden-20260926-final-v3 | free-use results.json | golden-free-use-30 | 1 | 30 | 30 | 40 | 40 | sim | sim (summary) |
| golden-20260926-final-v4 | free-use results.json | golden-free-use-30 | 1 | 30 | 30 | 43 | 43 | sim | sim (summary) |
| golden-20260926-final-v5 | free-use results.json | golden-free-use-30 | 1 | 30 | 30 | 43 | 43 | sim | sim (summary) |
| golden-20260926-final-v8 | free-use results.json | golden-free-use-30 | 1 | 30 | 30 | 44 | 44 | sim | sim (summary) |
| golden-20260926-final-v9 | free-use results.json | golden-free-use-30 | 1 | 30 | 28 | 40 | 40 | não | sim (summary) |
| golden-20260926-final-v10 | free-use results.json | golden-free-use-30 | 1 | 30 | 30 | 44 | 44 | sim | sim (summary) |
| golden-20260926-final-v11 | free-use results.json | golden-free-use-30 | 1 | 30 | 30 | 43 | 44 | sim | sim (summary) |
| golden-20260926-final-v14 | free-use results.json | golden-free-use-30 | 1 | 30 | 30 | 44 | 44 | sim | sim (summary) |
| golden-20260927-agenda-v15 | free-use results.json | golden-free-use-30 | 1 | 30 | 14 | 19 | 19 | não | sim (summary) |
| golden-20260927-agenda-v16 | free-use results.json | golden-free-use-30 | 1 | 30 | 30 | 44 | 45 | sim | sim (summary) |
| golden-20260927-agenda-v17 | free-use results.json | golden-free-use-30 | 1 | 30 | 30 | 44 | 45 | sim | sim (summary) |

Rodadas da Golden sem results.json (preparadas ou interrompidas antes de gravar; não contadas): golden-20260926-final-v1, golden-20260926-final-v6, golden-20260926-final-v7, golden-20260926-final-v12, golden-20260926-final-v13.

## Matriz operações × fenômenos (todos os tipos de salão)

Célula = casos `dev/regression`. Validação e prova não entram: são só sha256 no registro, sem metadado por caso (0 atribuível).

| fenômeno | create | change | cancel | block | read | (other) | (none) |
|---|---|---|---|---|---|---|---|
| accents | 12/0 | 12/0 | 12/0 | 13/0 | 1/0 | 0/0 | 0/0 |
| abbreviations | 8/0 | 6/0 | 7/0 | 6/0 | 1/0 | 0/0 | 0/0 |
| spoken numbers | 14/3 | 12/2 | 6/1 | 6/0 | 0/1 | 0/2 | 0/0 |
| voice | 14/0 | 11/0 | 7/0 | 7/0 | 1/0 | 0/0 | 0/0 |
| typo | 3/0 | 2/0 | 1/0 | 4/0 | 0/0 | 0/0 | 0/0 |
| homonym | 6/1 | 0/0 | 2/0 | 2/0 | 0/0 | 0/0 | 0/0 |
| nickname | 2/0 | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| names-as-words | 4/0 | 0/0 | 2/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| interval | 14/0 | 16/0 | 13/0 | 36/3 | 0/0 | 0/0 | 0/0 |
| day-of-month | 28/2 | 17/0 | 14/0 | 13/0 | 2/0 | 0/0 | 0/0 |
| weekday | 31/7 | 19/9 | 12/3 | 7/2 | 3/3 | 0/0 | 0/1 |
| relative-day | 23/19 | 23/7 | 19/9 | 28/2 | 4/5 | 0/0 | 0/2 |
| negation | 5/4 | 7/0 | 3/2 | 4/0 | 0/1 | 0/0 | 0/1 |
| reference | 8/2 | 4/2 | 7/0 | 1/0 | 0/0 | 0/0 | 0/0 |
| discard | 3/0 | 1/0 | 0/0 | 2/0 | 0/0 | 0/0 | 0/1 |
| out-of-scope | 0/0 | 0/0 | 0/1 | 0/0 | 0/0 | 0/0 | 0/2 |
| (none) | 0/1 | 0/0 | 1/1 | 0/0 | 0/0 | 0/8 | 0/0 |

### Tipo de salão: barbearia

Célula = casos `dev/regression` com salon_type = barbearia.

| fenômeno | create | change | cancel | block | read | (other) | (none) |
|---|---|---|---|---|---|---|---|
| accents | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| abbreviations | 2/0 | 1/0 | 0/0 | 1/0 | 0/0 | 0/0 | 0/0 |
| spoken numbers | 5/0 | 3/0 | 2/0 | 1/0 | 0/0 | 0/0 | 0/0 |
| voice | 5/0 | 3/0 | 2/0 | 1/0 | 0/0 | 0/0 | 0/0 |
| typo | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| homonym | 2/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| nickname | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| names-as-words | 2/0 | 0/0 | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| interval | 1/0 | 0/0 | 0/0 | 3/0 | 0/0 | 0/0 | 0/0 |
| day-of-month | 11/0 | 7/0 | 4/0 | 2/0 | 1/0 | 0/0 | 0/0 |
| weekday | 11/0 | 6/0 | 4/0 | 1/0 | 1/0 | 0/0 | 0/0 |
| relative-day | 4/0 | 1/0 | 3/0 | 2/0 | 0/0 | 0/0 | 0/0 |
| negation | 2/0 | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| reference | 1/0 | 1/0 | 2/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| discard | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| out-of-scope | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| (none) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

### Tipo de salão: base-fixture

Célula = casos `dev/regression` com salon_type = base-fixture.

| fenômeno | create | change | cancel | block | read | (other) | (none) |
|---|---|---|---|---|---|---|---|
| accents | 12/0 | 12/0 | 12/0 | 13/0 | 1/0 | 0/0 | 0/0 |
| abbreviations | 6/0 | 5/0 | 6/0 | 5/0 | 1/0 | 0/0 | 0/0 |
| spoken numbers | 4/0 | 5/0 | 2/0 | 4/0 | 0/0 | 0/0 | 0/0 |
| voice | 4/0 | 4/0 | 3/0 | 5/0 | 1/0 | 0/0 | 0/0 |
| typo | 3/0 | 2/0 | 1/0 | 4/0 | 0/0 | 0/0 | 0/0 |
| homonym | 2/1 | 0/0 | 2/0 | 2/0 | 0/0 | 0/0 | 0/0 |
| nickname | 0/0 | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| names-as-words | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| interval | 12/0 | 16/0 | 13/0 | 30/3 | 0/0 | 0/0 | 0/0 |
| day-of-month | 2/0 | 6/0 | 5/0 | 7/0 | 0/0 | 0/0 | 0/0 |
| weekday | 6/2 | 7/3 | 4/1 | 4/2 | 0/0 | 0/0 | 0/1 |
| relative-day | 19/16 | 22/6 | 16/9 | 26/2 | 4/5 | 0/0 | 0/2 |
| negation | 1/4 | 5/0 | 3/2 | 4/0 | 0/0 | 0/0 | 0/1 |
| reference | 5/2 | 2/2 | 3/0 | 1/0 | 0/0 | 0/0 | 0/0 |
| discard | 1/0 | 1/0 | 0/0 | 2/0 | 0/0 | 0/0 | 0/1 |
| out-of-scope | 0/0 | 0/0 | 0/1 | 0/0 | 0/0 | 0/0 | 0/1 |
| (none) | 0/1 | 0/0 | 1/1 | 0/0 | 0/0 | 0/0 | 0/0 |

### Tipo de salão: golden-fixture

Célula = casos `dev/regression` com salon_type = golden-fixture.

| fenômeno | create | change | cancel | block | read | (other) | (none) |
|---|---|---|---|---|---|---|---|
| accents | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| abbreviations | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| spoken numbers | 0/3 | 0/2 | 0/1 | 0/0 | 0/1 | 0/2 | 0/0 |
| voice | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| typo | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| homonym | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| nickname | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| names-as-words | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| interval | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| day-of-month | 0/2 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| weekday | 0/5 | 0/6 | 0/2 | 0/0 | 0/3 | 0/0 | 0/0 |
| relative-day | 0/3 | 0/1 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| negation | 0/0 | 0/0 | 0/0 | 0/0 | 0/1 | 0/0 | 0/0 |
| reference | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| discard | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| out-of-scope | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/1 |
| (none) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/8 | 0/0 |

### Tipo de salão: salao-de-beleza

Célula = casos `dev/regression` com salon_type = salao-de-beleza.

| fenômeno | create | change | cancel | block | read | (other) | (none) |
|---|---|---|---|---|---|---|---|
| accents | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| abbreviations | 0/0 | 0/0 | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| spoken numbers | 5/0 | 4/0 | 2/0 | 1/0 | 0/0 | 0/0 | 0/0 |
| voice | 5/0 | 4/0 | 2/0 | 1/0 | 0/0 | 0/0 | 0/0 |
| typo | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| homonym | 2/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| nickname | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| names-as-words | 2/0 | 0/0 | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| interval | 1/0 | 0/0 | 0/0 | 3/0 | 0/0 | 0/0 | 0/0 |
| day-of-month | 15/0 | 4/0 | 5/0 | 4/0 | 1/0 | 0/0 | 0/0 |
| weekday | 14/0 | 6/0 | 4/0 | 2/0 | 2/0 | 0/0 | 0/0 |
| relative-day | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| negation | 2/0 | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| reference | 2/0 | 1/0 | 2/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| discard | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| out-of-scope | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| (none) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

## Lacunas (GAP)

Regra: célula com **< 3 casos em dev** e **0 fora de dev** (validação/prova não são atribuíveis, então "fora de dev" = regressão catalogada).
A regra é mecânica: algumas células podem não ser pedidos reais de produto (por exemplo, leitura × desistência); priorize as de escrita (create/change/cancel/block).

### Nível 1: operação × fenômeno (todos os tipos): 31 lacunas

| operação | fenômeno | casos dev |
|---|---|---|
| create | out-of-scope | 0 |
| change | homonym | 0 |
| change | names-as-words | 0 |
| change | out-of-scope | 0 |
| cancel | nickname | 0 |
| cancel | discard | 0 |
| block | nickname | 0 |
| block | names-as-words | 0 |
| block | out-of-scope | 0 |
| read | typo | 0 |
| read | homonym | 0 |
| read | nickname | 0 |
| read | names-as-words | 0 |
| read | interval | 0 |
| read | reference | 0 |
| read | discard | 0 |
| read | out-of-scope | 0 |
| change | nickname | 1 |
| change | discard | 1 |
| cancel | typo | 1 |
| block | reference | 1 |
| read | accents | 1 |
| read | abbreviations | 1 |
| read | voice | 1 |
| create | nickname | 2 |
| change | typo | 2 |
| cancel | homonym | 2 |
| cancel | names-as-words | 2 |
| block | homonym | 2 |
| block | discard | 2 |
| read | day-of-month | 2 |

### Nível 2: operação × fenômeno × tipo de salão (tipos com casos dev: barbearia, base-fixture, salao-de-beleza): 173 células

| operação | fenômeno | tipos de salão em lacuna (casos dev) |
|---|---|---|
| create | accents | barbearia (0), salao-de-beleza (0) |
| create | abbreviations | barbearia (2), salao-de-beleza (0) |
| create | typo | barbearia (0), salao-de-beleza (0) |
| create | homonym | barbearia (2), salao-de-beleza (2) |
| create | nickname | barbearia (1), base-fixture (0), salao-de-beleza (1) |
| create | names-as-words | barbearia (2), base-fixture (0), salao-de-beleza (2) |
| create | interval | barbearia (1), salao-de-beleza (1) |
| create | day-of-month | base-fixture (2) |
| create | relative-day | salao-de-beleza (0) |
| create | negation | barbearia (2), salao-de-beleza (2) |
| create | reference | barbearia (1), salao-de-beleza (2) |
| create | discard | barbearia (1), base-fixture (1), salao-de-beleza (1) |
| create | out-of-scope | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| change | accents | barbearia (0), salao-de-beleza (0) |
| change | abbreviations | barbearia (1), salao-de-beleza (0) |
| change | typo | barbearia (0), base-fixture (2), salao-de-beleza (0) |
| change | homonym | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| change | nickname | barbearia (0), base-fixture (1), salao-de-beleza (0) |
| change | names-as-words | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| change | interval | barbearia (0), salao-de-beleza (0) |
| change | relative-day | barbearia (1), salao-de-beleza (0) |
| change | negation | barbearia (1), salao-de-beleza (1) |
| change | reference | barbearia (1), salao-de-beleza (1) |
| change | discard | barbearia (0), base-fixture (1), salao-de-beleza (0) |
| change | out-of-scope | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| cancel | accents | barbearia (0), salao-de-beleza (0) |
| cancel | abbreviations | barbearia (0), salao-de-beleza (1) |
| cancel | spoken numbers | barbearia (2), base-fixture (2), salao-de-beleza (2) |
| cancel | voice | barbearia (2), salao-de-beleza (2) |
| cancel | typo | barbearia (0), base-fixture (1), salao-de-beleza (0) |
| cancel | homonym | barbearia (0), base-fixture (2), salao-de-beleza (0) |
| cancel | nickname | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| cancel | names-as-words | barbearia (1), base-fixture (0), salao-de-beleza (1) |
| cancel | interval | barbearia (0), salao-de-beleza (0) |
| cancel | relative-day | salao-de-beleza (0) |
| cancel | negation | barbearia (0), salao-de-beleza (0) |
| cancel | reference | barbearia (2), salao-de-beleza (2) |
| cancel | discard | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| cancel | out-of-scope | barbearia (0), salao-de-beleza (0) |
| block | accents | barbearia (0), salao-de-beleza (0) |
| block | abbreviations | barbearia (1), salao-de-beleza (0) |
| block | spoken numbers | barbearia (1), salao-de-beleza (1) |
| block | voice | barbearia (1), salao-de-beleza (1) |
| block | typo | barbearia (0), salao-de-beleza (0) |
| block | homonym | barbearia (0), base-fixture (2), salao-de-beleza (0) |
| block | nickname | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| block | names-as-words | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| block | day-of-month | barbearia (2) |
| block | weekday | barbearia (1), salao-de-beleza (2) |
| block | relative-day | barbearia (2), salao-de-beleza (0) |
| block | negation | barbearia (0), salao-de-beleza (0) |
| block | reference | barbearia (0), base-fixture (1), salao-de-beleza (0) |
| block | discard | barbearia (0), base-fixture (2), salao-de-beleza (0) |
| block | out-of-scope | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| read | accents | barbearia (0), base-fixture (1), salao-de-beleza (0) |
| read | abbreviations | barbearia (0), base-fixture (1), salao-de-beleza (0) |
| read | spoken numbers | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| read | voice | barbearia (0), base-fixture (1), salao-de-beleza (0) |
| read | typo | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| read | homonym | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| read | nickname | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| read | names-as-words | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| read | interval | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| read | day-of-month | barbearia (1), base-fixture (0), salao-de-beleza (1) |
| read | weekday | barbearia (1), base-fixture (0), salao-de-beleza (2) |
| read | relative-day | barbearia (0), salao-de-beleza (0) |
| read | negation | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| read | reference | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| read | discard | barbearia (0), base-fixture (0), salao-de-beleza (0) |
| read | out-of-scope | barbearia (0), base-fixture (0), salao-de-beleza (0) |

## Estilo, fonte e proveniência

- dev: estilo {formal 20, regional 42, typing 114, voice 30}; fonte {assistant 64, generated 80}; gabarito {double-annotated 34, single-author 110}; tipo de salão {barbearia 40, base-fixture 64, salao-de-beleza 40}; nº de ações {1 88, 2 38, 3 18}
- regression: estilo {typing 70}; fonte {assistant 30, legacy 40}; gabarito {single-author 70}; tipo de salão {base-fixture 40, golden-fixture 30}; nº de ações {0 4, 1 56, 2 9, 3 1}

Conjuntos lacrados/escolha (registro `holdout-registry.json`; conteúdo nunca lido):

| id | kind | split | status | sha256 aprovado | ids registrados | olhadas | casos declarados | doc cita o sha |
|---|---|---|---|---|---|---|---|---|
| holdout:assistant-v1 | test | test | active | a7c4d447f5d0… | 26 | 0 | 26 | sim |
| holdout:owner-v1 | test | test | active | 75a3121e1f4e… | não (null) | 0 | 30 | sim |
| holdout:owner-multi-v1 | test | test | active | bd8c6797232c… | não (null) | 0 | 30 | sim |
| holdout:validation-v1 | validation | validation | active | 42cb4c1628b1… | 30 | 0 | 30 | sim |
| holdout:multi-salon-v2 | test | test | active | 822fc227c8d7… | 80 | 0 | ? | NÃO |

## Fontes lidas (sha256 no momento da geração)

| arquivo | bateria | casos | sha256 | conferência |
|---|---|---|---|---|
| `packages/salon-secretary/evaluation/agenda-practice-variations.json` | V | 34 | 6ea48f52909a1956… | - |
| `packages/salon-secretary/evaluation/agenda-practice-natural.json` | N | 30 | eeafd5b4f2f9b076… | - |
| `packages/salon-secretary/evaluation/agenda-practice-scenarios.json` | A | 15 | 8709bf47541d9fb3… | - |
| `packages/salon-secretary/evaluation/agenda-practice-scenarios-r2.json` | B | 13 | dc1a98396482874a… | - |
| `packages/salon-secretary/evaluation/agenda-practice-scenarios-r3.json` | C | 12 | b1ffd0218780c79e… | - |
| `packages/salon-secretary/evaluation/multi-salon/generated-dev.json` | MD | 80 | b9d28da43c2a0585… | manifesto confere: sim |
| `packages/salon-secretary/evaluation/free-use-golden-30.json` | GF | 30 | 0ea0ecce3531a142… | doc confere: sim; ids = free-use-golden.ts: sim |
| `packages/salon-secretary/evaluation/holdout-registry.json` | registry | 5 | 96aef95516ed8f69… | - |

Anotações de gabarito encontradas em `.demo/agenda-core/oracle-audit/`: `N-verdicts.json` (ignored), `V-verdicts.json` (ignored), `battery-V-blind-annotator-1.json` (blind, 34 casos).

## Confiabilidade: o que conferir antes de usar um número

- **Definição mudou depois da rodada** (49 pares rodada×caso, casos: A01, A02, A04, A05, A07, A09, A15, C02, C09, N12, N13, N21, N22, V12, V23, V24): no `results_history` esses registros têm `definition_matches_current: false` e não são pareáveis com rodadas novas (mesma regra do pass^k).
- **A/B/C antigas** não têm passk.json: foram reavaliadas offline com o mapa E congelado no dia de cada rodada (`evidence: recomputed:legacy-E-map`, mesmas regras de `legacyScore`). Última série: final-a 15/15, final-b 13/13, final-c 11/12.
- **Golden 30**: histórico vem de `results/free-use/golden-*/results.json` (fora de `results/agenda-core`), marcado `evidence: free-use results.json`; é regressão (R11), nunca nota de qualidade.
- **Fenômenos**: cada rótulo diz sua base em `phenomena_basis` (`tag` = etiqueta do autor; `text` = regra de texto heurística; `template` = formato de data do roteiro; `structure` = fixture/oráculo). Rótulos só `text` são indícios, não gabarito. Concordância etiqueta×detecção por fenômeno está em `catalog-crosschecks.json` (`tagAgreement`).
- **Operações**: `operations_net` = escritas que o oráculo espera (diferença entre o estado semeado e o `final` exato, ou o mapa E das A/B/C); `operations` = operações exercitadas (escritas do oráculo ∪ passo `READ_DONE` ∪ operações das etiquetas do autor, porque negação, desistência e conflito terminam sem escrita). `action_count` = max(escritas do oráculo + leitura, operações exercitadas); na Golden, o maior `actionCount` do contrato. Coluna `(other)` = só operações fora da Agenda (Golden: serviço, cliente, estoque, financeiro; em `other_operations`). C10 (desistência antiga, sem etiqueta de operação) fica em `(none)`.
- **Gabarito**: double-annotated 34, single-author 180. Nenhum gabarito foi adjudicado. `double-annotated` só aparece quando existe uma segunda anotação cega em `.demo/agenda-core/oracle-audit/` (a concordância é tarefa da adjudicação, não deste catálogo).
- **Ruído**: nas rodadas com `--noise`, cada tentativa guarda o nível (`off`/`light`/`heavy`) em `attempts[].noise`; acentos e erros de digitação introduzidos pelo ruído não viram fenômeno do caso.
- **Fora do escopo deste catálogo** (rodadas reais com outros formatos): hard-conversations, ultimate-10, multi-action benchmark, t21, x94, topic14, conversational-ux, replays da Golden (sem chamada real) e as pastas `results/free-use/holdout-*` (holdouts antigos, não lidos).

