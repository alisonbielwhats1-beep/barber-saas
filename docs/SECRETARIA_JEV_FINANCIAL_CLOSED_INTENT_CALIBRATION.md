# Gate 3.1C-B.3.3 — Financial Closed-Intent Calibration Prep

Esta microbateria é **somente avaliação**. Ela não promove intenções, não altera
a Acceptance Policy v1 e não usa o oracle para escolher perguntas ou autorizar
uma operação. O manifest congelado é
`packages/salon-secretary/evaluation/financial-closed-intent-plan.json`:
**21 casos (10 positivos, 11 adversariais), até 42 HTTP, zero retries**.
SHA-256 do arquivo: `ffa66093927f6072391c48bffb7acc857fc7a2024c4b4880f5d55e6f43d08ccc`.
Hash do dataset: `227228f243aa036c3bae7e6504b42be24e27e5f08826543185421ad31b73cedc`.
Hash dos payloads: `f9df3267657251a53254065f96f2e58f0e68a3591882ca8b30740ac16394c16f`.
O precheck compara também hashes dos relatórios f01–f23, plano Wave 1, auditoria
semântica, parser KEEP_STRICT, provider, Policy e derivation catalog.

## Contrato e assinaturas dos positivos

O catálogo publica as cinco métricas abaixo com mapeamento **único**
`metric → financial.report`, derivado com `decision-derivations-v1` e hash de
publicação auditado. A operação tem provenance `DETERMINISTIC_DERIVATION`;
somente skill, shape, metric e period perguntados pertencem ao JEV. T09/backend
continua responsável por autorização, tenant, fuso, intervalos, dados e valores.

Cada linha tem assinatura `financial/single/<metric>/<period>/modifiers=NONE`
revisada **no oracle offline**. Os pares possuem assinatura e expected idênticos.
`NONE` não é uma observação do JEV e não poderá, por si, liberar outro texto no
runtime. Nenhuma frase positiva é a entrada exata atualmente inscrita na
allowlist PROVEN.

| ID | Mensagem exata | Assinatura / expected fechado |
|---|---|---|
| p01 | Quanto faturei em serviços ontem? | `financial/single/service_revenue/yesterday/NONE` |
| p02 | Qual foi o faturamento dos serviços concluídos ontem? | `financial/single/service_revenue/yesterday/NONE` |
| p03 | Quanto recebi em pagamentos ontem? | `financial/single/received_revenue/yesterday/NONE` |
| p04 | Qual foi o total de pagamentos recebidos ontem? | `financial/single/received_revenue/yesterday/NONE` |
| p05 | Quanto ainda tenho a receber dos atendimentos concluídos sem pagamento? | `financial/single/outstanding_receivables/none/NONE` |
| p06 | Qual é o saldo atual em aberto de atendimentos concluídos sem pagamento? | `financial/single/outstanding_receivables/none/NONE` |
| p07 | Qual foi meu ticket médio de serviços ontem? | `financial/single/average_ticket/yesterday/NONE` |
| p08 | Em média, quanto os serviços renderam por atendimento concluído ontem? | `financial/single/average_ticket/yesterday/NONE` |
| p09 | Quanto realizei em serviços e produtos de atendimentos concluídos ontem? | `financial/single/realized_revenue/yesterday/NONE` |
| p10 | Qual foi a receita bruta de serviços e produtos dos atendimentos concluídos ontem? | `financial/single/realized_revenue/yesterday/NONE` |

`outstanding_receivables` significa o saldo **atual**, sem recorte histórico; seu
expected é `period=none`. A pergunta de período já publicada continua no detalhe
para distinguir `none` de um período histórico incompatível. Ela não exige nem
inventa data. Para as outras quatro famílias, `yesterday` é período fechado
publicado. Nenhum valor financeiro entra no payload.

## Adversariais congelados

O `expected` integral — decisão canônica, derivação quando aplicável, assinatura
com todos os modificadores, classe e evidência — está em cada linha do JSON.
“Núcleo JEV” abaixo é apenas a projeção de choices que o plano atual consegue
representar; não é conclusão de que todo o pedido foi compreendido.

| ID | Mensagem exata | Núcleo expected | Semântica adicional / classe esperada |
|---|---|---|---|
| n01 | Qual profissional faturou mais este mês? | `financial/single/service_revenue/this_month` | `groupBy=professional`, ranking maior/top 1; `MODIFIER_NOT_REPRESENTED`, Luna |
| n02 | Quanto cada profissional faturou este mês? | `financial/single/service_revenue/this_month` | `groupBy=professional`; `MODIFIER_NOT_REPRESENTED`, Luna |
| n03 | Compare meu faturamento desta semana com a passada. | `financial/single/service_revenue/comparison` | períodos atual e anterior; `MODIFIER_NOT_REPRESENTED`, Luna |
| n04 | Quanto faturei ontem e altere a massagem para R$80? | `multiple/independent` | `financial.report + service.change`, nome/preço abertos; `COMPOUND`, Luna |
| n05 | Quantos atendimentos concluí ontem? | `financial/single/completed_count/yesterday` | métrica publicada, mas fora das cinco famílias; `COMPLETED_COUNT_KEEP_LUNA` |
| n06 | Quanto faturei em serviços com a profissional Ana Lima ontem? | `financial/single/service_revenue/yesterday` | filtro por profissional não publicado e entidade aberta; `OUT_OF_CATALOG`, esclarecer/rejeitar |
| n07 | Estorne um pagamento de ontem. | `out_of_catalog/out_of_catalog` | estorno não publicado; `OUT_OF_CATALOG`, rejeitar |
| n08 | Quanto recebi ontem, e não quanto faturei em serviços? | `financial/single/received_revenue/yesterday` | contraste de métrica vizinha, mas intenção fechada; `CLOSED_NEIGHBOR`, potencial somente se interpretado corretamente |
| n09 | Quanto eu tinha a receber ontem? | `financial/single/outstanding_receivables/yesterday` | histórico de recebíveis não publicado; `OUT_OF_CATALOG`, rejeitar/esclarecer |
| n10 | Quanto faturei e quanto recebi ontem? | `financial/single/multiple/yesterday` | duas métricas publicadas; choice `multiple` não identifica o par; `MODIFIER_NOT_REPRESENTED`, Luna |
| n11 | Quanto recebi hoje em pagamentos? | `financial/single/received_revenue/today` | vizinho de período, mas intenção fechada; `CLOSED_NEIGHBOR`, potencial somente se interpretado corretamente |

n08 e n11 são **probes adversariais fechados**, não pedidos fora do catálogo.
Podem revelar erro de métrica/período sem fornecer resposta aberta ao Luna.
Nenhum negativo é inscrito na allowlist. Em n01/n02 o backend T09 tem
`group_by=professional`, mas o JEV não o representa; n06 é diferente: T09 não
oferece filtro por profissional. Em n03 o backend suporta `compare_period`, mas
`comparison` não codifica os dois períodos. n05 preserva a evidência de f16–f18,
quando JEV confundiu Financial com Scheduling.

## Perguntas, choices e derivação

As requests congeladas em cada caso foram construídas por `derivedRequest`,
sem alterar parser/choice sets. Discovery é sempre `skill` + `shape`:

- `skill`: “Qual capacidade é necessária? services=cadastro de serviços;
  customers=cadastro de clientes; scheduling=agenda; financial=relatórios;
  inventory=estoque; communication=mensagem fake. Use multiple para mais de
  uma, unclear se indeterminada, out_of_catalog para capacidade não publicada.”
  Choices: `services, customers, scheduling, financial, inventory,
  communication, multiple, unclear, out_of_catalog`.
- `shape`: “O pedido é uma operação single, várias independent, ou dependent
  quando uma depende do sucesso/slot da outra? Use unclear para intenção
  ambígua e out_of_catalog para pedido não suportado. Nunca execute ações.”
  Choices: `single, independent, dependent, unclear, out_of_catalog`.

Somente uma discovery estruturalmente válida `financial + single` permite detail
`metric` + `period`. O gabarito **nunca** decide essa ramificação:

- `metric`: “Qual métrica financeira? Faturamento sem qualificador=service_revenue;
  com produtos=realized_revenue; recebido=received_revenue; a
  receber=outstanding_receivables; atendimentos realizados=completed_count;
  ticket médio=average_ticket; multiple para várias. none fora de Financial;
  unclear se não suportada (lucro/taxas/estornos). Nunca calcular valores.”
  Choices: `service_revenue, realized_revenue, received_revenue,
  outstanding_receivables, completed_count, average_ticket, multiple, none,
  unclear`.
- `period`: “Qual período financeiro explícito? today=hoje, yesterday=ontem,
  this_week=esta semana, last_week=semana passada, this_month=este mês,
  last_month=mês passado. comparison para comparar períodos; none sem período
  financeiro; unclear se ambíguo. Não converter datas.” Choices: `today,
  yesterday, this_week, last_week, this_month, last_month, comparison, none,
  unclear`.

Não há pergunta `operation`, `group_by`, ranking, filtro ou dado aberto. O
catálogo deriva `financial.report` separadamente das cinco métricas. Derivação
correta nunca encobre erro de escolha linguística; cada caso compara as duas
dimensões. Confidence JEV não é propagada para a operação derivada.

## Calibração, completeness e futura allowlist (proposta)

O [harness offline](../packages/salon-secretary/evaluation/financial-closed-intent-harness.ts)
calcula provider validity, escolhas linguísticas, derivação, completude contra o
oracle, decisão da **Policy v1 inalterada** e risco de uma hipotética aceitação
somente pelos seletores (`unsafeShadowCandidate`). A Policy atual faz fallback
para todas as mensagens novas. Isso é esperado e não conta como erro do JEV.
Um shadow candidate com ranking/filtro/métrica errada é evidência adversarial;
**não** vira `ACCEPT_JEV`.

Uma futura inscrição por assinatura precisaria de um contrato tipado como
`financial + single + metric calibrada + period compatível + modifiers
VERIFIED_ABSENT + catálogo/hash íntegro`. `UNKNOWN` ou modifier presente deve
exigir fallback. A ausência é apenas anotação revisada no manifest desta
bateria; o decision-plan JEV atual **não produz** `VERIFIED_ABSENT`. Portanto
mesmo uma bateria perfeita não habilita uma allowlist por intenção sem validar
essa fronteira independentemente. Não foi criado parser de regex, pergunta nova,
threshold ou router.

Para cada família, uma recomendação futura pode ser `PROMOTION_CANDIDATE`,
`NEEDS_MORE_DATA` ou `KEEP_LUNA`, ponderando ambos os positivos, paráfrases,
vizinhos, validade estrutural, completude e nenhum falso positivo inseguro.
Não há meta numérica nem promoção automática.

As métricas preparadas mantêm separados: resposta HTTP válida, resposta
estrutural válida, acerto linguístico, completude semântica, aceitação da Policy
e `UNSAFE_FALSE_POSITIVE`. Por HTTP coletar status, latência, bytes, input/output
tokens e custo estimado; por avaliação discovery/detail/policy/total, choices,
provenance, probabilities, confidence, runner-up e margem. Consolidar
valid/invalid response rates, falha do contrato de probabilities,
HTTP-success-but-invalid, min/p50/média/p95/max, custo total/médio. Sem usage
do provider, custo fica desconhecido, nunca inventado como faturado.

KEEP_STRICT permanece: soma 0,99 continua `INVALID_RESPONSE →
FALLBACK_REQUIRED`. Não há renormalização. Diagnóstico conhecido e
comprovadamente fail-closed pode ser registrado e permitir o próximo caso;
desconhecido para. A execução futura para imediatamente em
`UNSAFE_FALSE_POSITIVE`, schema/diagnóstico desconhecido, fail-closed incerto,
hash/catalog mismatch, dado proibido no payload, orçamento excedido, HTTP 500
ou timeout. Zero retries. `unsafeShadowCandidate` é registrado separadamente;
com a Policy atual em fallback ele não é um falso positivo **aceito**.

## Limites, custo e reprodução

Cada caso tem no máximo 2 HTTP, total **42 HTTP**. Os 42 corpos JSON congelados
somam **47.448 bytes**; somente mensagem sintética, contexto vazio, modelo,
perguntas e choices entram no corpo. `expected`, assinatura, classe, evidência,
IDs, telefone, registro financeiro, segredo e dados reais não entram.
`TYPESAFE_API_KEY` é usada apenas no header Authorization numa futura execução
separadamente autorizada; a chave não foi lida nesta preparação.

Tarifa **histórica** auditada em 22/09/2026: input US$0,042/M, output US$0.
Teto teórico conservador sob essa tarifa e limite auditado de 64.000 input
tokens por HTTP: `42 × 64.000 × 0,042 / 1.000.000 = US$0,112896`.
Não é tarifa vigente comprovada nem custo faturado. Reconfirmar documentação
oficial antes de qualquer chamada; divergência material interrompe antes da
rede. Nenhuma chamada JEV/OpenAI foi realizada aqui.

`readFrozenClosedFinancialPlan()` valida SHA-256 do manifest e predecessores;
`assertClosedFinancialPayload()` compara a request serializada com o payload
congelado e recusa detail sem discovery Financial single validada. A futura
execução deve usar esses prechecks, `assertClosedFinancialBudget()` antes de
cada HTTP, orçamento 42 HTTP e a matriz de parada. O harness aceita tempos
medidos de preparação, Policy e total por avaliação; sem medição esses campos
ficam `null`, nunca inventados.
Resultados reais posteriores serão artefatos novos; este manifest nunca deve
ser reescrito após observá-los. f01–f23 e a Wave 1 original ficam intactos.

## Verificação offline

Os 16 testes novos cobrem dez positivos, onze adversariais, identidade das
assinaturas por paráfrase, período dos recebíveis, derivações, payloads,
orçamento, gating do detalhe, provider inválido com somas 0,99/1,01,
confidence alta errada, risco de shadow acceptance, métricas separadas e
fail-closed. O mock de `fetch` falha se qualquer teste tentar rede.

| Comando | Resultado |
|---|---|
| Testes dirigidos JEV/Policy/Financial/Golden V2 | 302 aprovados, 10 arquivos |
| `npm test` | 1.841 aprovados, 248 arquivos |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit --incremental false` | exit 0 |
| `npm run build` | exit 0 com mock de fonte local e bloqueio de rede no processo |

Os hashes dos oito predecessores conferem. O build apenas compilou código e
prerenderizou páginas; não testou provider nem banco. No `.env.local`, o modelo
permanece `gpt-6-luna` e a flag de chamadas OpenAI permanece `false`. Nenhum
arquivo da Acceptance Policy, parser, provider, catálogo, Golden V2 ou runtime
foi alterado. Zero chamadas JEV/OpenAI, banco, Tools de negócio ou deploy.

Rollback: remover somente os novos arquivos `financial-closed-intent-plan.ts`,
`financial-closed-intent-harness.ts`, `financial-closed-intent-freeze.ts`,
`prepare-financial-closed-intent.ts`, `financial-closed-intent-plan.json`, o
novo teste e este documento. Não há rollback de Policy, runtime, banco ou
ambiente remoto.
