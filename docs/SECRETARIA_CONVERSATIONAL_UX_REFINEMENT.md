# Tópico 14 — refinamento conversacional, offline

Gate local em `codex/conversational-ux-refinement`, worktree `service-create-mvp`.
Objetivo: corrigir as perguntas de x41/x42/x44/x46/x49 sem mudar os planos ou
acrescentar inferências. Os resultados do benchmark real anterior permanecem
históricos; este Gate não mede novamente a qualidade do Luna.

## Auditoria e causa

O Scheduling já produz perguntas em `secretary-scheduling.ts`: prioriza sua
seleção pendente e não pergunta profissional antes de conhecer o serviço.
`secretary-batch.ts` usa a pergunta do assessor do batch. Customers, Inventory,
Financial e Communication também possuem perguntas próprias para seleção,
faltantes e restrições. Nenhum desses resolvers foi alterado.

O fluxo antigo era: adapter → `assessment.preview` por ação → concatenação de
todos os previews → `minimumClarifications` com todos os nomes internos →
rodapé “Informe somente…”. Cancel/create compartilhavam preview e apareciam
duas vezes; o rodapé perguntava uma terceira. O rodapé também recolocava
`professional_ref`, filtrado pela Skill, e expunha `service_ref`, `service_name`,
`end_time` e chaves das ações. A causa está demonstrada nos textos congelados
do benchmark e no arquivo `conversational-preview-before.txt`.

## Fluxo novo e fonte canônica

O novo fluxo é: estado existente do adapter → **hints de apresentação somente
leitura** → `conversationalClarifications` → pergunta(s) natural(is).
`actionPlanPreview` delega ao compositor puro `composeActionPlanResponse`.
`minimumClarifications` mantém o contrato interno anterior; não é mais um
formatador de texto para o dono.

`secretary-presentation.ts` lê seleção pendente, candidatos, `waiting_for`,
serviço resolvido e unidade compartilhada. Não faz consultas, não resolve
entidades, não atualiza drafts, não valida disponibilidade e não altera o
ActionPlan. Esses hints não são persistidos nem entram no contexto do modelo.
O retorno conversacional é a única fonte de perguntas do plano V2. Estados e
previews de domínio permanecem disponíveis para auditoria e confirmação.

Quando há faltantes, previews completos não são reexibidos como questionário.
Uma pergunta é apresentada diretamente. Duas ou mais viram uma lista curta;
eventuais conflitos continuam visíveis. Só se contabilizam como preparados
itens efetivamente em READY_FOR_CONFIRMATION ou DONE. No x49 o cancelamento
está READY enquanto o batch aguarda serviço; não se afirma falsamente que há
oito propostas preparadas.

Quando não há faltantes, a resposta apresenta os detalhes da proposta, suas
dependências em linguagem natural e uma única orientação de confirmação.
Previews compartilhados são exibidos uma vez pela identidade da unidade de
execução, não por igualdade de texto. Não se remove preço, duração, horário ou
resultado financeiro. Confirmação, grupos, fingerprint e permissões continuam
exatamente sob os contratos existentes.

## Deduplicação semântica e prioridades

- `service_ref`/`service_name` representam uma pergunta sobre serviço;
  `customer_ref`/`customer_name` representam cliente;
  `professional_ref`/`professional_name` representam profissional;
  `message_mode`/`content`, quando o texto falta, recebem uma solicitação única
  de texto literal ou pedido explícito de sugestão.
- Repetições desses campos dentro da mesma ação são colapsadas por conceito.
  A pergunta do preview não é somada à pergunta canônica. Cancelamento completo
  não ganha uma pergunta só porque compartilha o preview com o create incompleto.
- Ações distintas conservam perguntas distintas: Fábio e Alisson não são
  deduplicados só porque ambos precisam escolher serviço.
- A seleção que o adapter expõe tem prioridade dentro daquela ação; opções
  vêm exclusivamente de candidatos já resolvidos. Não se inventa catálogo.
- Scheduling: resolução de cliente/agendamento precede perguntas restantes;
  serviço e horário ausentes podem ser pedidos juntos; profissional aguarda
  serviço. Seleção ambígua de serviço faz uma pergunta só, seguindo o adapter.
- Inventory: produto precede detalhes da movimentação; se o adapter aguarda
  entrada/saída, respeita-se essa pergunta. Communication respeita destinatário
  e canal pendentes. Financial pergunta seu período; Services agrupa preço e
  duração fornecíveis juntos. Não há uma ordem global de domínio aplicada a
  todas as Skills.

O mapa de conceitos, rótulos, títulos e perguntas fica centralizado em
`conversational-presentation.ts`. Campos novos sem apresentação conhecida têm
fallback humano, nunca impressão automática do identificador técnico.

| Campo interno | Apresentação contextual |
| --- | --- |
| service_ref / service_name | Qual serviço Fábio Santos vai fazer? |
| time | Qual horário você quer para Andrinho? |
| service + time | Qual serviço e horário você quer para Andrinho? |
| end_time | Até que horas devo bloquear a agenda de Tatiana? |
| customer_ref ambíguo | Qual Amanda você quis dizer? + candidatos reais |
| durationMin / priceCents | duração em minutos / preço |
| period (Financial) | Qual período você quer consultar? |

Nomes completos são preservados: não se encurta “Fábio Santos” por inferência.
Datas já normalizadas permanecem no plano/proposta; a pergunta curta não volta
a perguntar uma data conhecida.

## BEFORE / AFTER dos casos obrigatórios

| Caso | Antes | Depois, primeiro turno |
| --- | --- | --- |
| x41 | “Informe horário exato” + “Informe somente agendamento_1: time” | “Qual horário você quer para Andrinho?” |
| x42 | service_ref, professional_ref, time, selection e rodapé | “Qual serviço você deseja para Andrinho?” + Corte + Barba, Corte Completo, Corte Infantil |
| x44 | “Informe serviço e horário exato” + professional_ref no rodapé | “Qual serviço e horário você quer para Andrinho?” |
| x46 | Pergunta de serviço no cancel, no create e no rodapé | “Qual serviço Fábio Santos vai fazer?” |
| x49 | Serviço repetido, service_name/end_time e previews extensos | Lista com serviço de Fábio e término do bloqueio de Tatiana, uma vez cada |

Trecho de x49:

```text
Só preciso de duas informações:

1. Qual serviço Fábio Santos vai fazer?
2. Até que horas devo bloquear a agenda de Tatiana?
```

O compositor pode anteceder a lista com a contagem verdadeira de itens
preparados. Não acrescenta perguntas no rodapé.

No segundo turno de x41, “10h” resolve somente `time`; x44 resolve serviço e
horário; x46 resolve somente `service_name`; x49 resolve `service_name` e
`end_time`. Todos chegam à mesma proposta observada anteriormente. Em x42,
“10h” continua sem escolher um dos serviços ambíguos: a única pergunta seguinte
é sobre serviço, sem reperguntar horário ou cliente.

## Preservação, segurança e alcance

O replay usa dez estados reais congelados, dois turnos por caso, com SHA do
resultado de origem. Verifica igualdade integral do ActionPlan antes/depois de
formatar, incluindo revision, status, fields, dependencies, confirmation_groups
e fingerprint. Os testes também verificam os mesmos plan_ref, conversation_ref
e draft_refs na continuidade histórica. Há teste novo de execução do runtime
com respostas sintéticas para o fluxo x46 e regressão existente de continuação
conjunta em dez ações, sem chamadas externas.

Não foram alterados actions[], DAG, ciclos, estados, partial failure, grupos,
política NORMAL/ADVANCED/SPLIT, regras de domínio, tenant/RLS, modelo, Router,
fast-path ou Outbox. Nenhuma operação real, confirmação ou envio foi executado.

Texto de Communication EXACT é protegido inclusive quando o adapter coloca
cancelamento e mensagem em um preview compartilhado. Se o próprio texto
literal solicitado pelo usuário contiver “service_ref” ou perguntas, ele é
preservado: isso é conteúdo autorizado da mensagem, não vazamento de metadados
nem pergunta de esclarecimento da Secretária. Os critérios zero do Gate são
aplicados ao texto gerado pelo compositor, sem adulterar EXACT.

Esta mudança cobre a mensagem conversacional V2. Não inicia Front/Meta nem
remove os metadados estruturados das APIs: eles continuam necessários às
auditorias e aos controles existentes. V1/flag OFF permanece no caminho antigo.

## Validação e performance

Resultados finais dos comandos, contagens e microbenchmark estão registrados
na seção de conclusão abaixo. O script `node scripts/measure-conversational-ux.cjs`
reconstitui o compositor anterior a partir do fonte arquivado e exige igualdade
exata com o BEFORE observado; depois renderiza a mesma entrada com o novo.
Nenhuma chamada de modelo ou banco é feita.

Performance: sete lotes alternados de 1.000 renderizações por versão/caso,
após aquecimento, mediana por renderização. Mede só composição local, não
Luna, banco ou E2E. Não promove diferenças de microssegundos a ganho perceptível
de latência. O ganho esperado aqui é concisão, com **zero inferências adicionais**.

## Microbateria futura — preparada, não executável

Manifest: `packages/salon-secretary/evaluation/conversational-ux-microbattery-plan.json`.
Somente x41/x42/x44/x46/x49, textos originais e suas respostas curtas, dez turnos,
até dez inferências, zero retries. Estado PREPARED_NOT_EXECUTABLE;
execution_authorized=false. Não há comando novo de execução paga.

Antes de execução futura: autorização explícita; congelar hashes incluindo os
novos módulos de apresentação; verificar tarifa e anunciar teto em USD;
preflight/backup/fixtures sintéticas próprias; reutilizar durable observation,
wire witness real, fsync/checkpoints, diagnostics, health e effect counters.
Não reutilizar um manifest antigo alterando seus hashes nem resetar histórico.
Parar em clarification/proposal e interromper em qualquer falha de segurança ou
regressão de UX. V2 somente no processo; finally V2/paid/JEV=false.

Critérios futuros: zero technical-field leak, duplicate question e unnecessary
question, mesmas dez/ cinco ações e dependências, continuidade íntegra e zero
campos inventados/entidades erradas/unsafe proposal/unsafe execution. Nenhuma
nota real nova para Conversação foi atribuída neste Gate offline.

## Arquivos e rollback

Novos: `packages/salon-secretary/src/conversational-presentation.ts`,
`src/lib/secretary-presentation.ts`,
`src/lib/__tests__/secretary-conversational-ux.test.ts`,
`src/test/fixtures/conversational-ux-benchmark.json`,
`src/test/fixtures/conversational-preview-before.txt`,
`scripts/measure-conversational-ux.cjs`, manifest da microbateria e este documento.

Alterados: `packages/salon-secretary/src/action-plan.ts` (somente encaminhamento
do preview e exports de apresentação), `src/lib/salon-secretary.ts` (somente
projeção da mensagem), testes `secretary-action-plan-v2.test.ts` e
`secretary-action-plan-batch.test.ts`, `docs/STATUS_ATUAL.md`.

O único expected antigo alterado exigia literalmente o vazamento
“b: durationMin e priceCents; d: name”. Foi substituído pela apresentação humana
solicitada; os expecteds estruturais de faltantes, domínio, grafo e segurança
permaneceram iguais. Não se alterou expected do benchmark para fazê-lo passar.

Rollback: manter `SALON_SECRETARY_MULTI_ACTION_V2_ENABLED=false`,
`SALON_SECRETARY_ALLOW_PAID_CALLS=false` e
`SALON_SECRETARY_JEV_ROUTER_ENABLED=false`. Para desfazer o código, reverter
somente este delta de apresentação usando o backup
`%TEMP%/everflair-conversational-ux-before`; não desfazer o worktree inteiro,
que contém trabalho anterior. Nenhuma migration ou restauração de banco é
necessária. Não houve push/PR/Preview para respeitar zero deploy.

## Resultado final — 24/09/2026

**PASS offline nos cinco casos / dez estados de conversa.** Não foi executada
inferência real nem uma nova bateria PostgreSQL: este Gate muda somente a
projeção da mensagem. A validação integrada do benchmark anterior é evidência
histórica, não resultado reapresentado como execução nova.

| Caso | Perguntas T1 / T2 | Resultado da continuação | Resultado offline |
| --- | --- | --- | --- |
| x41 | 1 / 0 | “10h.” preenche horário; proposta preservada | PASS |
| x42 | 1 / 1 | “10h.” preservado; ainda solicita serviço ambíguo | PASS |
| x44 | 1 / 0 | Serviço e horário preenchidos; bloqueio preservado | PASS |
| x46 | 1 / 0 | Só serviço do create preenchido; cinco ações e DAG preservados | PASS |
| x49 | 2 / 0 | Só serviço e fim do bloqueio preenchidos; dez ações, DAG e ADVANCED_REVIEW preservados | PASS |

Nos casos-alvo: **TECHNICAL_FIELD_LEAK=0, DUPLICATE_QUESTION=0,
UNNECESSARY_QUESTION=0**. As asserções conferem os conceitos solicitados,
opções reais e contagem de perguntas, além de igualdade integral dos planos;
não se trata apenas de comparar textos idênticos. Campos inventados, entidade
errada selecionada, unsafe proposal e unsafe execution: **zero** no escopo
offline, com estados preservados e chamadas externas proibidas. Nenhuma
confirmação, escrita operacional, Outbox ou mensagem externa foi realizada.

| Verificação executada | Resultado |
| --- | --- |
| `npx vitest run src/lib/__tests__/secretary-conversational-ux.test.ts src/lib/__tests__/secretary-action-plan-batch.test.ts --maxWorkers=2` | 30 testes / 2 arquivos PASS |
| `npm test -- --maxWorkers=2` | 2.431 testes / 273 arquivos PASS; 121,19 s |
| `npm run lint` | PASS, exit 0 |
| `npx tsc --noEmit --incremental false` | PASS, exit 0 |
| `npm run build` | PASS, exit 0; Prisma generate + Next build local |
| `node scripts/measure-conversational-ux.cjs` | PASS, 10 estados; OpenAI=0, JEV=0, DB=0 |

A suíte geral inclui Multi-Action V2, DAG/ciclos/grupos, drafts/batch, seis
Skills, Router/fast-path, Golden V2, Hard Conversations e contratos Ultimate
offline. O comando padrão exclui `*.integration.test.ts`, conforme package.json.
Não se executou Ultimate real. Regressões finais: **zero nos testes executados**.
O aviso do Vite sobre uma futura mudança de configLoader já existe e não
impediu os testes. Durante a implementação, um teste de EXACT compartilhado
revelou uma proteção incompleta, corrigida antes da execução final; também
foi corrigida a tipagem de uma asserção nova. Nenhuma dessas falhas permanece.

Medição local do compositor, mediana de sete lotes de 1.000 renderizações por
versão e caso (aquecimento e ordem alternada):

| Caso | Antes (ms/render) | Depois (ms/render) | Delta (ms) |
| --- | --- | --- | --- |
| x41 | 0,0007003 | 0,0007010 | +0,0000007 |
| x42 | 0,0009622 | 0,0009773 | +0,0000151 |
| x44 | 0,0012462 | 0,0009488 | −0,0002974 |
| x46 | 0,0016751 | 0,0010141 | −0,0006610 |
| x49 | 0,0029009 | 0,0019885 | −0,0009124 |

Não há aumento material observado de processamento local. As pequenas
diferenças estão na escala de microssegundos; não permitem prometer melhoria
de E2E. A medição não inclui resolução de adapters, banco, HTTP ou Luna.
**Inferências adicionais=0; custo adicional de inferência=0.**

Evidência completa BEFORE/AFTER, hashes dos planos e amostras de performance:
[`offline-1790297521249.json`](../packages/salon-secretary/evaluation/results/conversational-ux/offline-1790297521249.json).
Logs e hashes dos checks finais:
[`checks-final.json`](../packages/salon-secretary/evaluation/results/conversational-ux/checks-final.json).
Os artefatos em `evaluation/results` são locais e ignorados pelo Git; a fixture
congelada, o script reprodutível e o relatório ficam no delta de código.

Estado final: V2 OFF por padrão (ausente em .env.local e habilitada somente por
`=== "true"`); paid=false; Router JEV=false; .env.local inalterado. Microbateria
dos cinco casos **PREPARADA, NÃO EXECUTADA**. A nota Conversação 6/10 permanece
histórica; uma nova nota real depende dessa validação futura. Nenhum deploy,
Front, Meta ou trabalho de overlap/override foi iniciado.
