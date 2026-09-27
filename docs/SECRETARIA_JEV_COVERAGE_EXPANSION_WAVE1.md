# Gate 3.1C-B.3 — Wave 1 Financial (NÃO EXECUTADA)

Gerado offline por prepare-coverage-expansion.ts. Versão jev-coverage-expansion-v1.
Dataset SHA-256: 7f544f9609dbeff4cf95cadc3902ed9a8eadd1fe08416126d29e63a952289775. Payloads SHA-256: 2afdac98bac99b5aecfb24a11b4f4c483f4750303bbfc4766257e59bc29cfa19.
Catálogo decision-derivations-v1, SHA-256 0300667615177bf9d96bb9c96a9f055ff99041db111b0e9fb78e48f407434791.

32 avaliações, máximo 64 HTTP, zero retries. Discovery skill/shape; detail metric/period somente após discovery Financial single válido. Nenhuma pergunta operation, Inventory ou Communication. Discovery incompatível para esta onda → fallback sem detail. O gabarito nunca seleciona a ramificação nem entra no payload.

Policy v1 permanece intacta: somente f01 está inscrito; os demais positivos são candidatos de calibração, não aceites novos. Medir acerto linguístico e risco de projeção fechada separadamente. As contagens de fallback desta policy não medem a cobertura futura de uma policy ampliada.

## Perguntas exatas

### skill

Qual capacidade é necessária? services=cadastro de serviços; customers=cadastro de clientes; scheduling=agenda; financial=relatórios; inventory=estoque; communication=mensagem fake. Use multiple para mais de uma, unclear se indeterminada, out_of_catalog para capacidade não publicada.

Choices: `services`, `customers`, `scheduling`, `financial`, `inventory`, `communication`, `multiple`, `unclear`, `out_of_catalog`.

### shape

O pedido é uma operação single, várias independent, ou dependent quando uma depende do sucesso/slot da outra? Use unclear para intenção ambígua e out_of_catalog para pedido não suportado. Nunca execute ações.

Choices: `single`, `independent`, `dependent`, `unclear`, `out_of_catalog`.

### metric

Qual métrica financeira? Faturamento sem qualificador=service_revenue; com produtos=realized_revenue; recebido=received_revenue; a receber=outstanding_receivables; atendimentos realizados=completed_count; ticket médio=average_ticket; multiple para várias. none fora de Financial; unclear se não suportada (lucro/taxas/estornos). Nunca calcular valores.

Choices: `service_revenue`, `realized_revenue`, `received_revenue`, `outstanding_receivables`, `completed_count`, `average_ticket`, `multiple`, `none`, `unclear`.

### period

Qual período financeiro explícito? today=hoje, yesterday=ontem, this_week=esta semana, last_week=semana passada, this_month=este mês, last_month=mês passado. comparison para comparar períodos; none sem período financeiro; unclear se ambíguo. Não converter datas.

Choices: `today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`, `comparison`, `none`, `unclear`.

## Mensagens e gabarito congelado

| Caso | Mensagem exata | Skill / shape | metric / period | Operações de domínio esperadas | Potencial / estado |
|---|---|---|---|---|---|
| f01 | Quanto faturei ontem? | financial / single | service_revenue / yesterday | financial.report | FULL_JEV_BYPASS; PROVEN |
| f02 | Qual foi meu faturamento de ontem? | financial / single | service_revenue / yesterday | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f03 | Qual foi o faturamento de serviços concluídos esta semana? | financial / single | service_revenue / this_week | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f04 | Quanto eu recebi ontem? | financial / single | received_revenue / yesterday | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f05 | Qual o total dos pagamentos recebidos ontem? | financial / single | received_revenue / yesterday | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f06 | Quanto recebi este mês? | financial / single | received_revenue / this_month | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f07 | Quanto tenho a receber? | financial / single | outstanding_receivables / none | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f08 | Qual é o saldo atual a receber dos atendimentos concluídos ainda sem pagamento? | financial / single | outstanding_receivables / none | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f09 | Qual o valor em aberto dos atendimentos concluídos sem pagamento, incluindo serviços e produtos? | financial / single | outstanding_receivables / none | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f10 | Qual foi meu ticket médio ontem? | financial / single | average_ticket / yesterday | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f11 | Qual foi o faturamento médio de serviços por atendimento concluído ontem? | financial / single | average_ticket / yesterday | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f12 | Qual foi meu ticket médio no mês passado? | financial / single | average_ticket / last_month | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f13 | Qual a receita realizada com serviços e produtos dos atendimentos concluídos ontem? | financial / single | realized_revenue / yesterday | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f14 | Quanto totalizaram serviços e produtos dos atendimentos concluídos ontem? | financial / single | realized_revenue / yesterday | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f15 | Qual foi o faturamento incluindo produtos na semana passada? | financial / single | realized_revenue / last_week | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f16 | Quantos atendimentos foram concluídos ontem? | financial / single | completed_count / yesterday | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f17 | Qual a quantidade de atendimentos finalizados ontem? | financial / single | completed_count / yesterday | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f18 | Quantos atendimentos foram concluídos hoje? | financial / single | completed_count / today | financial.report | FULL_JEV_BYPASS; CALIBRATION_CANDIDATE |
| f19 | Quanto faturei? | financial / single | service_revenue / none | financial.report | JEV_ROUTING_ONLY; FORCED_LUNA |
| f20 | Quanto entrou ontem? | financial / single | unclear / yesterday | financial.report | LUNA_REQUIRED; FORCED_LUNA |
| f21 | Quanto eu tinha a receber ontem? | financial / single | outstanding_receivables / yesterday | financial.report | JEV_ROUTING_ONLY; FORCED_LUNA |
| f22 | Compare esta semana com a semana passada. | financial / single | service_revenue / comparison | financial.report | JEV_ROUTING_ONLY; FORCED_LUNA |
| f23 | Qual profissional faturou mais este mês? | financial / single | service_revenue / this_month | financial.report | JEV_ROUTING_ONLY; FORCED_LUNA |
| f24 | Qual serviço mais faturou ontem? | financial / single | service_revenue / yesterday | financial.report | JEV_ROUTING_ONLY; FORCED_LUNA |
| f25 | Quanto faturei ontem e altere a massagem para R$80? | multiple / independent | service_revenue / yesterday | financial.report → service.change | LUNA_REQUIRED; FORCED_LUNA |
| f26 | Quanto faturei ontem e cancele a Amanda amanhã? | multiple / independent | service_revenue / yesterday | financial.report → appointment.cancel | LUNA_REQUIRED; FORCED_LUNA |
| f27 | Estorne o pagamento da Amanda. | out_of_catalog / out_of_catalog | unclear / none | fora do catálogo | OUT_OF_CATALOG; FORCED_LUNA |
| f28 | Qual foi meu lucro líquido ontem? | out_of_catalog / out_of_catalog | unclear / yesterday | fora do catálogo | OUT_OF_CATALOG; FORCED_LUNA |
| f29 | Quais taxas foram descontadas dos pagamentos ontem? | out_of_catalog / out_of_catalog | unclear / yesterday | fora do catálogo | OUT_OF_CATALOG; FORCED_LUNA |
| f30 | Dê baixa no pagamento pendente da Amanda. | out_of_catalog / out_of_catalog | unclear / none | fora do catálogo | OUT_OF_CATALOG; FORCED_LUNA |
| f31 | Quanto faturei e quanto recebi ontem? | financial / single | multiple / yesterday | financial.report | JEV_ROUTING_ONLY; FORCED_LUNA |
| f32 | Quanto vendi ontem? | financial / single | unclear / yesterday | financial.report | LUNA_REQUIRED; FORCED_LUNA |

Campos abertos, group_by, dependências e motivos estão integralmente no manifest JSON; não são enviados ao JEV. 'multiple' é um seletor insuficiente, não um array de métricas interpretado. Em f21 recebíveis históricos são incompatíveis; não converter ontem em saldo atual. Em f32 'vendi' sem esclarecer serviços/produtos/pagamentos permanece ambíguo.

## Custo e limites

Tarifa historicamente auditada em 22/09/2026: input US$0,042/M, output US$0. Reconfirmar oficialmente antes da futura execução. Teto conservador: 64 HTTP × 64.000 tokens × tarifa = US$0.172032. Não é custo faturado nem promessa de tarifa vigente. Corpo JSON preparado muito menor; tokenizer não foi chamado.

Enviar somente texto sintético, contexto vazio, model JEV e perguntas/choices publicadas. Não enviar gabarito, tags, classe de risco, evidence, refs, telefone, registros financeiros ou secrets no corpo. Credencial só em Authorization na futura execução autorizada.

Parar sem retry em UNSAFE_FALSE_POSITIVE, UNSAFE_SHADOW_CANDIDATE, STRICT_PROBABILITY_OR_SCHEMA_FAILURE, CATALOG_OR_PAYLOAD_HASH_DRIFT, FORBIDDEN_PAYLOAD_DATA, BUDGET_EXCEEDED, UNHANDLED_ERROR. UNSAFE_SHADOW_CANDIDATE significa que os seletores fechados pareceriam suficientes, mas omitem/mudam a intenção do oracle; não é ACCEPT_JEV real. Preservar ambos os contadores, nunca promover fallback manualmente. Não iniciar outra onda sem aprovação.

Zero OpenAI, Luna fallback, banco, Tools de negócio, Meta, router e efeitos operacionais. Este documento não executa a bateria.
