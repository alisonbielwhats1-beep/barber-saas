# Gate 3.1C-B.3.2 — fronteira semântica Financial (auditoria offline)

Esta é uma camada **analítica de avaliação**, não uma regra de runtime. Ela lê o
manifest congelado e os dois relatórios reais, verifica os respectivos SHA-256 e
grava `packages/salon-secretary/evaluation/financial-semantic-boundary-audit.json`.
O JSON contém, para cada f01–f32, a mensagem exata, expected original integral,
semântica revisada, decisões observadas f01–f23, dimensões coincidentes/ausentes,
classificação e próximo tratamento. f24–f32 permanecem sem observação real.
Nenhum resultado histórico ou expected foi reescrito.

## Contrato publicado e autoridade

Fontes: `packages/salon-secretary/src/financial-skill.ts`,
`packages/salon-secretary/src/skill-registry.ts`,
`src/lib/secretary-financial.ts` (T09), `src/lib/service-contract.ts` (U02),
`docs/SECRETARIA_GATE_2_5.md` e o decision-plan derivado de avaliação.
O Registry publica apenas `financial.report`, U02/T09, somente leitura.

| Seletor publicado | Valores e condição real |
|---|---|
| `metrics[]` | `service_revenue`, `realized_revenue`, `received_revenue`, `completed_count`, `average_ticket`, `outstanding_receivables`; 1–6 seletores, sem valor financeiro fornecido pelo modelo. |
| `period` | `today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`; obrigatório salvo recebíveis atuais isolados. Backend resolve intervalo absoluto no fuso do salão; semana começa domingo. |
| `compare_period` | Mesmo enum de períodos; T09 calcula diferença e percentual. Recebíveis não aceitam comparação. |
| `group_by` | `professional` ou `service`, somente com **uma** métrica `service_revenue`, sem comparação. T09 ordena por receita decrescente e devolve até 10 grupos. |

Definições: `service_revenue` soma `Appointment.priceCents` de COMPLETED por
`startAt`; `realized_revenue` inclui produtos; `received_revenue` soma
`Payment.amountCents` por `paidAt`; `completed_count` conta atendimentos
COMPLETED; `average_ticket` divide a receita de serviços por essa contagem;
`outstanding_receivables` é o saldo **atual**, de todas as datas, de COMPLETED sem
Payment (serviços + produtos). `period=none` é legítimo apenas nessa última
consulta. Múltiplas métricas podem compartilhar um relatório quando compatíveis,
mas o choice JEV `multiple` não informa quais métricas foram solicitadas.

O backend resolve tenant, autorização, datas, valores, cobertura, diferenças e
rankings. O schema não publica filtro livre por profissional, serviço, cliente,
status, método de pagamento ou intervalo arbitrário. Não há seletores `ranking`,
`direction`, `top/bottom` ou `limit`; o agrupamento existente já ordena receita
descendente e limita a saída a dez. Portanto “qual foi o maior?” é respondível
conceitualmente pelo primeiro grupo **se** a interpretação trouxer `group_by`
correto e a cobertura for válida, mas a saída atual não possui parâmetro para
pedir somente top 1. Ranking por quantidade, lucro, taxas, estorno, baixa e
histórico de recebíveis não são capacidades publicadas.

O plano JEV aprovado pergunta somente `skill` e `shape` na descoberta e, em
Financial single, `metric` e `period` no detalhe. `financial.report` deriva da
métrica pelo catálogo versionado. O plano **não** pergunta `compare_period`,
`group_by`, direção de ranking, limite, lista de métricas ou filtros. O choice
`period=comparison` não contém os dois períodos exigidos por T09.

## Taxonomia e regra de segurança

- **A — CLOSED_FINANCIAL:** semântica fechada e frase atualmente inscrita na
  Policy. Apenas f01 tem esse estado; a ausência de modificadores foi revisada
  para essa frase específica, não para paráfrases arbitrárias.
- **B — CLOSED_BUT_UNCALIBRATED:** contrato fechado, mas sem aceite comprovado
  para a intenção/variação. Inclui resposta inválida e erros de classificação.
- **C — MODIFIER_NOT_REPRESENTED:** metric/period podem coincidir, mas falta
  comparação, agrupamento/ranking ou conjunto de métricas.
- **D — OPEN_EXTRACTION_REQUIRED:** dado obrigatório omitido ou sentido ambíguo;
  pedir esclarecimento quando necessário. “Período ausente” não autoriza
  inventar um período e pode ser perguntado pelo backend sem inferência adicional.
- **E — COMPOUND:** mais de uma operação/Skill; plano JEV simples não basta.
- **F — OUT_OF_CATALOG:** contrato do backend não suporta a intenção; rejeitar
  ou esclarecer, sem converter para uma métrica vizinha.

`FULL_JEV_BYPASS_FINANCIAL` exige resposta estruturalmente válida, Skill e shape
corretas, métrica e período corretos quando exigidos, **todos os modificadores
necessários representados ou ausência comprovada**, nenhuma extração aberta,
nenhuma operação/dependência composta, derivação única com catálogo íntegro e
`ACCEPT_JEV` da Policy. Ainda assim JEV não autoriza SQL/escrita: o backend
mantém autorização, RLS, resolução de período e cálculo. Confidence alta não
substitui nenhuma dessas condições.

A assinatura conceitual tipada é `FinancialSemanticIntentSignature` em
`financial-semantic-boundary.ts`: `skill`, `shape`, `metric`, `period`,
`comparisonPeriod`, `groupBy`, `rankingDirection`, `topLimit`, `metricSet` e
`entityFilter`. Sua chave semântica é independente do texto exato: f01 e f02
possuem a mesma assinatura, enquanto um total mensal simples e um ranking
mensal por profissional possuem assinaturas diferentes. **Null nos modifiers
do oracle offline não é prova runtime de ausência.** Uma futura Policy por
intenção precisará de evidência validada dessa ausência; `UNKNOWN` deve dar
fallback. Não foi adicionado parser textual, pergunta JEV nem allowlist nova.

## Reanálise dos 32 casos congelados

Na coluna “núcleo” aparecem `skill/shape/metric/period`; `—` indica resposta
estruturalmente inválida ou caso ainda não executado. A operação derivada,
provenance e o expected original estão detalhados no JSON analítico. Nas linhas
A/B com núcleo completo, `financial.report` foi derivado corretamente; isso
não significa aceite da Policy. “Possível” é possibilidade **semântica**, não
aceite atual nem autorização operacional.

| Caso | Mensagem exata | Núcleo observado | Faltante ou divergência material | Classe | Full bypass semântico? |
|---|---|---|---|---|---|
| f01 | Quanto faturei ontem? | financial/single/service_revenue/yesterday | nenhum; Policy aceitou | A | sim, observado só nesta avaliação |
| f02 | Qual foi meu faturamento de ontem? | financial/single/service_revenue/yesterday | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f03 | Qual foi o faturamento de serviços concluídos esta semana? | financial/single/service_revenue/this_week | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f04 | Quanto eu recebi ontem? | — | vetor de probabilities inválido; sem decisão validada | B | possível em tese; Luna hoje |
| f05 | Qual o total dos pagamentos recebidos ontem? | financial/single/received_revenue/yesterday | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f06 | Quanto recebi este mês? | financial/single/received_revenue/this_month | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f07 | Quanto tenho a receber? | financial/unclear/—/— | shape, metric, period e operação não resolvidos | B | possível em tese; Luna hoje |
| f08 | Qual é o saldo atual a receber dos atendimentos concluídos ainda sem pagamento? | financial/single/outstanding_receivables/none | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f09 | Qual o valor em aberto dos atendimentos concluídos sem pagamento, incluindo serviços e produtos? | financial/single/outstanding_receivables/none | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f10 | Qual foi meu ticket médio ontem? | financial/single/average_ticket/yesterday | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f11 | Qual foi o faturamento médio de serviços por atendimento concluído ontem? | financial/single/average_ticket/yesterday | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f12 | Qual foi meu ticket médio no mês passado? | financial/single/average_ticket/last_month | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f13 | Qual a receita realizada com serviços e produtos dos atendimentos concluídos ontem? | financial/single/realized_revenue/yesterday | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f14 | Quanto totalizaram serviços e produtos dos atendimentos concluídos ontem? | financial/single/realized_revenue/yesterday | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f15 | Qual foi o faturamento incluindo produtos na semana passada? | financial/single/realized_revenue/last_week | nenhuma dimensão; falta calibração/aceite | B | possível; Luna hoje |
| f16 | Quantos atendimentos foram concluídos ontem? | scheduling/single/—/— | Skill errada; metric/period não perguntados | B | possível em tese; Luna hoje |
| f17 | Qual a quantidade de atendimentos finalizados ontem? | scheduling/single/—/— | Skill errada; metric/period não perguntados | B | possível em tese; Luna hoje |
| f18 | Quantos atendimentos foram concluídos hoje? | scheduling/single/—/— | Skill errada; metric/period não perguntados | B | possível em tese; Luna hoje |
| f19 | Quanto faturei? | financial/single/service_revenue/none | período obrigatório ausente; solicitar | D | não |
| f20 | Quanto entrou ontem? | financial/out_of_catalog/—/— | métrica ambígua | D | não |
| f21 | Quanto eu tinha a receber ontem? | financial/single/outstanding_receivables/yesterday | histórico de recebíveis não publicado; T09 rejeita | F | não; rejeitar/esclarecer |
| f22 | Compare esta semana com a semana passada. | unclear/single/—/— | períodos atual/anterior não representados | C | não; Luna |
| f23 | Qual profissional faturou mais este mês? | financial/single/service_revenue/this_month | `group_by=professional`, direção maior, top 1 ausentes | C | não; Luna |
| f24 | Qual serviço mais faturou ontem? | — (não executado) | `group_by=service`, direção maior, top 1 ausentes | C | não; Luna |
| f25 | Quanto faturei ontem e altere a massagem para R$80? | — (não executado) | outra Skill, alvo/preço abertos, duas operações | E | não; Luna |
| f26 | Quanto faturei ontem e cancele a Amanda amanhã? | — (não executado) | outra Skill, cliente/data abertos, duas operações | E | não; Luna |
| f27 | Estorne o pagamento da Amanda. | — (não executado) | estorno não publicado | F | não; rejeitar/esclarecer |
| f28 | Qual foi meu lucro líquido ontem? | — (não executado) | lucro não publicado | F | não; rejeitar/esclarecer |
| f29 | Quais taxas foram descontadas dos pagamentos ontem? | — (não executado) | taxas não publicadas | F | não; rejeitar/esclarecer |
| f30 | Dê baixa no pagamento pendente da Amanda. | — (não executado) | escrita financeira não publicada | F | não; rejeitar/esclarecer |
| f31 | Quanto faturei e quanto recebi ontem? | — (não executado) | choice `multiple` não contém as duas métricas | C | não; Luna |
| f32 | Quanto vendi ontem? | — (não executado) | serviços/produtos/pagamentos ambíguos | D | não; esclarecer/Luna |

Distribuição analítica: **A=1, B=17, C=4, D=3, E=2, F=5**.
Não muda as classificações empíricas salvas (`CORRECT_ACCEPT`, etc.). f24–f32
foram classificados **antes** de novas chamadas: nenhum deles é candidato ao
full bypass com o decision-plan atual. Repetir a Wave indiscriminadamente não
provaria cobertura de bypass para esses casos.

### f23 e completed_count

Em f23, o HTTP e os quatro choices JEV foram estruturalmente válidos e as
decisões fechadas coincidiram com a projeção: confidence skill=0,95,
shape=0,58, metric=0,98 e period=1,00. A derivação para `financial.report` foi
correta. Faltou `group_by=professional`; “mais” requer ordenar por receita e
selecionar o topo. T09 calcula ranking e devolve até dez grupos, mas o plano
JEV não transmite agrupamento e o contrato T09 não tem seletor top 1. A Policy
fez fallback por `UNCALIBRATED_INPUT`; o harness parou em
`UNSAFE_SHADOW_CANDIDATE`. **Não houve ACCEPT_JEV incorreto.**

Em f16–f18, `completed_count` é Financial publicado, não uma operação de agenda:
conta Appointment COMPLETED em T09. JEV selecionou Scheduling em todas as três
descobertas e por isso nem perguntou metric/period. A proximidade lexical com
“atendimentos” e “concluídos” é hipótese plausível; os resultados não provam a
causa interna do modelo. Os choices publicados já distinguem financial=relatórios
e scheduling=agenda; não foram alterados. `completed_count` permanece Luna.

## Recomendação por métrica e limites

| Intenção | Contrato fechado simples? | Evidência real | Recomendação |
|---|---|---|---|
| `service_revenue` | sim, com um período fechado e sem modificador | f01 aceito; f02/f03 corretos mas fallback; f23 revela risco de ranking | **CALIBRATION_CANDIDATE** só para totais simples; ranking/comparação **KEEP_LUNA** |
| `received_revenue` | sim, exige período | f05/f06 corretos; f04 inválido | **CALIBRATION_CANDIDATE** |
| `outstanding_receivables` | sim, apenas saldo atual sem período | f08/f09 corretos; f07 shape incerto | **CALIBRATION_CANDIDATE**; histórico **OUT_OF_CATALOG** |
| `average_ticket` | sim, exige período | f10–f12 corretos, não aceitos | **CALIBRATION_CANDIDATE** |
| `realized_revenue` | sim, exige período | f13–f15 corretos, não aceitos | **CALIBRATION_CANDIDATE** |
| `completed_count` | sim no contrato, exige período | f16–f18 escolheram Scheduling | **KEEP_LUNA** por ora |

Nenhuma intenção nova é promovida agora. Comparação, agrupamento/ranking,
filtros, múltiplas métricas e pedidos compostos permanecem Luna; pedidos fora do
catálogo são rejeitados ou esclarecidos. `f04` mede **provider validity**,
`f16–f18` medem **linguistic correctness**, `f23` mede **semantic completeness**,
e f01 mede **policy acceptance**. Não misturar os quatro denominadores.

## Próxima ação mínima preparada — não executar

Antes de uma allowlist por assinatura, é preciso aprovar uma fonte independente
e validada para “modificadores ausentes”; a ausência de perguntas no plano
atual não prova isso. Sem essa prova, todos os novos textos continuam fallback.
Para calibrar apenas formas Financial fechadas, uma microbateria futura poderia
congelar estes dez exemplos sintéticos (discovery skill/shape; detail metric/period;
nenhuma nova pergunta, nenhuma operação enviada ao JEV):

| Mensagem | Expected metric / period |
|---|---|
| Quanto foi o faturamento de serviços hoje? | service_revenue / today |
| Qual meu faturamento de serviços no mês passado? | service_revenue / last_month |
| Qual valor recebi em pagamentos hoje? | received_revenue / today |
| Quanto entrou de pagamentos na semana passada? | received_revenue / last_week |
| Qual é o saldo atual a receber? | outstanding_receivables / none |
| Quanto há em atendimentos concluídos sem pagamento? | outstanding_receivables / none |
| Qual meu ticket médio de serviços desta semana? | average_ticket / this_week |
| Qual a média por atendimento concluído no mês passado? | average_ticket / last_month |
| Qual receita de serviços e produtos tive ontem? | realized_revenue / yesterday |
| Quanto foi realizado em serviços e produtos este mês? | realized_revenue / this_month |

Plano preliminar: dez avaliações, no máximo vinte HTTP JEV, zero retries e
zero fallback Luna executado; parar em falso positivo inseguro, resposta
inválida desconhecida ou hash/payload divergente. O dataset e payloads **não
foram congelados nem executados** nesta auditoria. Essa microbateria mede
variações fechadas, mas sozinha não valida uma Policy por intenção: negativos
com modificadores ainda precisam de um contrato de detecção separado.

## Verificação offline

Os 14 testes novos cobrem integridade das evidências, seletores publicados,
paráfrases, ranking por profissional/serviço, recebidos, recebíveis, comparação,
pedidos compostos, ticket médio, contagem de concluídos, intenções fora do
catálogo e a impossibilidade de um modifier não representado virar bypass mesmo
com confidence alta. O JSON gerado corresponde exatamente ao builder offline.

| Comando | Resultado |
|---|---|
| Testes dirigidos Financial/JEV/Policy/Coverage/Golden V2 | 286 aprovados, 9 arquivos |
| `npm test` | 1.825 aprovados, 247 arquivos |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit --incremental false` | exit 0 |
| `npm run build` | exit 0 com mock de fonte já existente e rede bloqueada no processo |

Os SHA-256 do manifest, relatórios f01–f23, parser KEEP_STRICT, provider,
Acceptance Policy e derivation catalog conferem com os valores anteriores à
auditoria. `SALON_SECRETARY_MODEL=gpt-6-luna` e
`SALON_SECRETARY_ALLOW_PAID_CALLS=false` permanecem no ambiente local. Zero
chamadas JEV/OpenAI, acesso a banco, alterações no runtime ou execução de
operações. O build offline comprova compilação, não rede/credenciais produtivas.

Rollback: remover somente `financial-semantic-boundary.ts`, o gerador, o JSON,
os testes novos e este documento. Nenhum arquivo histórico, código funcional,
banco, Policy, allowlist, parser, catálogo, prompts ou modelo precisa de rollback.
