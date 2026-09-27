# Gate 3.1C-B.3.6 — resultado interrompido

Execução real exclusivamente JEV, manifest f2bb218a6744fab61cefe9748cecde1c1276c420219ecd118815a8b15b7a7af2.
31/40 avaliações, 56/80 HTTP, zero retries. Parada obrigatória em m17: FALSE_SIMPLE.
Não executados m18 e u01–u08. Nenhuma tentativa repetida. Nenhum arquivo congelado foi alterado.

## Evidência crítica

Mensagem: “Quanto eu tinha a receber ontem?”
Expected: MODIFIED (recebíveis históricos, não suportados pelo saldo atual).
Retorno válido: financial / single / outstanding_receivables / yesterday / SIMPLE.
Complexity: SIMPLE=0,48; MODIFIED=0,32; UNCLEAR=0,20; confidence=0,23; runner-up MODIFIED; margin=0,16.
Métrica: p=1, confidence=0,99. Período: p=1, confidence=1.
Derivação financial.report íntegra, sem confidence. A semântica histórica foi reconhecida no período, mas não no detector.

O contrato adicional ainda bloqueou o candidato: PERIOD_INCOMPATIBLE, pois outstanding_receivables exige none. Zero aceite/bypass operacional.
Isso NÃO elimina o FALSE_SIMPLE: a definição autorizada é qualquer MODIFIED/UNCLEAR rotulado SIMPLE válido.
O campo legado score.falseSimple é mais restrito (exige candidato de bypass); score.detectorFalseSimple=true é o campo correspondente à definição desta execução. A classificação persistida é FALSE_SIMPLE e provocou STOP imediato. Não houve alteração do avaliador.

## Métricas e denominadores

- TRUE_SIMPLE=11; FALSE_SIMPLE=1; FALSE_COMPLEX=1; TRUE_MODIFIED=8.
- TRUE_UNCLEAR=0 observados; nenhum dos oito expected UNCLEAR foi executado, portanto taxa não estimável.
- SAFE_FALLBACK por discovery=5; INVALID_PROVIDER_RESPONSE=5; accepts=0.
- Simple precision do detector: 11/12 = 91,67% (SIMPLE válidos emitidos).
- Simple recall operacional nesta amostra positiva: 11/14 = 78,57%, incluindo dois inválidos como indisponibilidade. Condicionado a respostas válidas: 11/12 = 91,67%.
- Modified detection rate entre details válidos expected MODIFIED: 8/9 = 88,89%. Sobre os 17 MODIFIED executados: 8/17 = 47,06%; cinco short-circuits e três inválidos não são acerto do detector.
- HTTP success: 56/56 = 100%. Provider validity: 51/56 = 91,07%. Invalid/probability contract failure: 5/56 = 8,93%.
- Avaliações integralmente válidas: 26/31 = 83,87%; 21 tiveram detail válido.
- Skill/shape/metric/period compatíveis em 21/21 details válidos: acerto dos seletores não equivale a completude.
- Complexity correta em 19/21 details válidos = 90,48%; os erros são s06 e m17.
- Entre todas as 123 decisões válidas observadas, 118 coincidem com o oracle (95,93%); isso inclui discovery parcial e não é accuracy de pedido completo.
- POTENTIAL_FULL_JEV_BYPASS=11/14 positivos (78,57%), ou 11/31 executados (35,48%). Zero PROVEN_RUNTIME_BYPASS. Somente esses onze satisfizeram a assinatura completa revisada.

## Pares críticos

- s01 “Quanto faturei ontem?” SIMPLE versus m01 “Quanto faturei com Ana ontem?” MODIFIED: separação correta; confidence 0,60 vs 0,90, margins 0,47 vs 0,90.
- s04 “Quanto recebi ontem?” SIMPLE versus m03 “Quanto recebi da Amanda ontem?” MODIFIED: separação correta; confidence 0,76 vs 0,91, margins 0,69 vs 0,89.
- s12 “Quanto faturei este mês?” SIMPLE; m06 “Qual profissional faturou mais este mês?” inválido na discovery (shape soma 0,99). Par NÃO comprovado; detail não executado.
- s02/m02 e s08/m05 distinguiram filtros com mesma métrica/período. s06 saldo atual virou UNCLEAR; m17 histórico virou SIMPLE, falha justamente na fronteira atual/histórico.

## Confiança e falhas de contrato

TRUE_SIMPLE complexity confidence 0,53–0,97; menor confidence em s12, margem 0,39. TRUE_MODIFIED confidence 0,70–0,98; menor margem 0,65 em m13 (dinheiro). Não houve erro de complexity com confidence alta nesta amostra; o FALSE_SIMPLE teve confidence 0,23, sem que isso autorizasse escolher threshold.
Todas as decisões válidas: confidence min 0,23/p50 0,95/média 0,8338/max 1; margin min 0,03/p50 0,93/média 0,7887/max 1.
Inválidos, todos soma publicada 0,99: s07 metric; s10 metric; m06 shape; m12 metric; m16 financial_complexity. KEEP_STRICT rejeitou todos; nenhuma distribuição reparada. Detalhes sanitizados completos no JSON.

## Latências (ms)

| Medição | n | min | p50 | média | p95 descritivo | max |
|---|---:|---:|---:|---:|---:|---:|
| HTTP até headers | 56 | 244,1 | 281,1 | 305,2 | 372,5 | 712,6 |
| Discovery provider, inclui corpo/parser | 31 | 257,9 | 291,9 | 312,8 | 358,4 | 722,3 |
| Detail provider, inclui corpo/parser | 25 | 261,9 | 303,8 | 327,6 | 391,2 | 728,1 |
| Avaliador offline | 31 | 0,097 | 0,353 | 0,363 | 0,649 | 0,836 |
| Total avaliação instrumentada | 31 | 290,6 | 625,5 | 607,7 | 734,0 | 1.480,1 |

Total inclui prechecks e persistência local até a medição; não é tempo puro do provider. Não há comparação pareada com Luna ou ablação sem complexity.

## Usage e custo

Input=40.106; output=9.970; bytes enviados=100.047. Estimativa total US$0,001684452; média/avaliação US$0,000054337.
Usage validado: 35.686 input/8.922 output; US$0,001498812.
Usage somente de diagnóstico sanitizado: 4.420 input/1.048 output; US$0,000185640.
Tarifa oficial reconfirmada antes da execução: US$0,042/M input, output gratuito, em https://typesafe.ai/blog/introducing-system-one-models-and-jev . Não é valor faturado.

Complexity acrescentou 1.529 bytes em cada um dos 25 details enviados: +38.225 bytes. Payload contrafactual sem essa pergunta, mesmas chamadas/mensagens: 61.822 bytes. Zero HTTP adicional. Não há uso/custo incremental medido isoladamente: sem ablação ou tokenizador oficial, não atribuir uma parcela exata do custo à pergunta.

## Resultado individual

| ID | Mensagem | Classificação | Complexity | Confidence | Margin | HTTP | Input | Output | Bytes | Total ms | Custo USD |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| s01 | Quanto faturei ontem? | TRUE_SIMPLE | SIMPLE | 0.6 | 0.47 | 2 | 1477 | 365 | 3729 | 1480.1 | 0.000062034 |
| s02 | Quanto faturei em serviços ontem? | TRUE_SIMPLE | SIMPLE | 0.92 | 0.90 | 2 | 1481 | 365 | 3755 | 662.7 | 0.000062202 |
| s03 | Qual foi meu faturamento de ontem? | TRUE_SIMPLE | SIMPLE | 0.69 | 0.59 | 2 | 1481 | 365 | 3755 | 616.0 | 0.000062202 |
| s04 | Quanto recebi ontem? | TRUE_SIMPLE | SIMPLE | 0.76 | 0.69 | 2 | 1475 | 365 | 3727 | 566.9 | 0.000061950 |
| s05 | Quanto entrou em pagamentos ontem? | TRUE_SIMPLE | SIMPLE | 0.81 | 0.77 | 2 | 1477 | 365 | 3755 | 697.9 | 0.000062034 |
| s06 | Quanto tenho a receber? | FALSE_COMPLEX | UNCLEAR | 0.59 | 0.53 | 2 | 1475 | 367 | 3733 | 594.6 | 0.000061950 |
| s07 | Qual é o saldo atual dos atendimentos concluídos sem pagamento? | INVALID_PROVIDER_RESPONSE | NOT_ASKED | — | — | 2 | 1495 | 366 | 3817 | 626.7 | 0.000062790 |
| s08 | Qual meu ticket médio ontem? | TRUE_SIMPLE | SIMPLE | 0.97 | 0.96 | 2 | 1475 | 364 | 3745 | 609.7 | 0.000061950 |
| s09 | Em média, quanto rendeu cada atendimento concluído ontem em serviços? | TRUE_SIMPLE | SIMPLE | 0.96 | 0.96 | 2 | 1495 | 364 | 3831 | 599.8 | 0.000062790 |
| s10 | Qual foi minha receita realizada ontem? | INVALID_PROVIDER_RESPONSE | NOT_ASKED | — | — | 2 | 1477 | 366 | 3765 | 592.7 | 0.000062034 |
| s11 | Quanto realizei com serviços e produtos dos atendimentos concluídos ontem? | TRUE_SIMPLE | SIMPLE | 0.97 | 0.96 | 2 | 1499 | 366 | 3839 | 652.7 | 0.000062958 |
| s12 | Quanto faturei este mês? | TRUE_SIMPLE | SIMPLE | 0.53 | 0.39 | 2 | 1479 | 364 | 3737 | 644.1 | 0.000062118 |
| s13 | Mais uma vez: quanto faturei ontem? | TRUE_SIMPLE | SIMPLE | 0.73 | 0.65 | 2 | 1483 | 365 | 3757 | 704.9 | 0.000062286 |
| s14 | Quanto recebi ontem, e não quanto faturei em serviços? | TRUE_SIMPLE | SIMPLE | 0.63 | 0.61 | 2 | 1493 | 365 | 3799 | 661.4 | 0.000062706 |
| m01 | Quanto faturei com Ana ontem? | TRUE_MODIFIED | MODIFIED | 0.9 | 0.90 | 2 | 1481 | 366 | 3745 | 627.8 | 0.000062202 |
| m02 | Quanto faturei em serviços de Ana ontem? | TRUE_MODIFIED | MODIFIED | 0.9 | 0.88 | 2 | 1485 | 366 | 3769 | 616.0 | 0.000062370 |
| m03 | Quanto recebi da Amanda ontem? | TRUE_MODIFIED | MODIFIED | 0.91 | 0.89 | 2 | 1479 | 366 | 3747 | 723.4 | 0.000062118 |
| m04 | Quanto a Amanda tem a pagar? | SAFE_FALLBACK | NOT_ASKED | — | — | 1 | 503 | 139 | 967 | 324.6 | 0.000021126 |
| m05 | Qual o ticket médio da Tatiana ontem? | TRUE_MODIFIED | MODIFIED | 0.88 | 0.85 | 2 | 1481 | 365 | 3763 | 697.5 | 0.000062202 |
| m06 | Qual profissional faturou mais este mês? | INVALID_PROVIDER_RESPONSE | NOT_ASKED | — | — | 1 | 504 | 138 | 980 | 334.6 | 0.000021168 |
| m07 | Quanto cada profissional faturou? | SAFE_FALLBACK | NOT_ASKED | — | — | 1 | 503 | 140 | 972 | 290.6 | 0.000021126 |
| m08 | Compare meu faturamento desta semana com a passada. | TRUE_MODIFIED | MODIFIED | 0.98 | 0.98 | 2 | 1485 | 364 | 3789 | 634.7 | 0.000062370 |
| m09 | Quanto faturei e quanto recebi ontem? | SAFE_FALLBACK | NOT_ASKED | — | — | 1 | 506 | 140 | 976 | 313.7 | 0.000021252 |
| m10 | Quanto faturei ontem e cancele Amanda? | SAFE_FALLBACK | NOT_ASKED | — | — | 1 | 506 | 140 | 977 | 331.0 | 0.000021252 |
| m11 | Quanto faturei ontem e altere a massagem para R$80? | SAFE_FALLBACK | NOT_ASKED | — | — | 1 | 513 | 140 | 990 | 326.9 | 0.000021546 |
| m12 | Quanto rendeu só o corte masculino ontem? | INVALID_PROVIDER_RESPONSE | NOT_ASKED | — | — | 2 | 1483 | 366 | 3771 | 744.7 | 0.000062286 |
| m13 | Quanto recebi em dinheiro ontem? | TRUE_MODIFIED | MODIFIED | 0.7 | 0.65 | 2 | 1479 | 366 | 3751 | 625.4 | 0.000062118 |
| m14 | Qual serviço teve o menor faturamento este mês? | TRUE_MODIFIED | MODIFIED | 0.95 | 0.94 | 2 | 1485 | 365 | 3785 | 641.7 | 0.000062370 |
| m15 | Me mostra o faturamento deste mês separado por serviço. | TRUE_MODIFIED | MODIFIED | 0.98 | 0.98 | 2 | 1487 | 365 | 3801 | 668.4 | 0.000062454 |
| m16 | Quanto faturei ontem em relação a hoje? | INVALID_PROVIDER_RESPONSE | NOT_ASKED | — | — | 2 | 1485 | 364 | 3769 | 602.1 | 0.000062370 |
| m17 | Quanto eu tinha a receber ontem? | FALSE_SIMPLE | SIMPLE | 0.23 | 0.16 | 2 | 1479 | 368 | 3751 | 625.5 | 0.000062118 |

NOT_ASKED na tabela significa ausência de decisão válida para scoring: nos details inválidos a pergunta foi enviada, mas sua resposta não pode ser aproveitada como SIMPLE válido. O JSON diferencia stage executado e rejeitado de short-circuit verdadeiro.

## Recomendação e preservação

C — REJECT_DESIGN nesta versão como guarda suficiente para promoção. Houve detecção útil de filtros e onze simples corretos, mas o requisito prioritário FALSE_SIMPLE=0 falhou. Isso não prova que toda abordagem de decisão única seja inviável; nenhuma correção ou nova bateria foi executada.
A amostra está truncada antes de m18 e de todos os UNCLEAR/out-of-scope, portanto não há conclusão de cobertura geral. O par de ranking obrigatório foi inválido, não validado. Não escolher threshold a partir do único FALSE_SIMPLE.

Preflight validou chave presente sem exposição, manifest/predecessores e distribuição 14/18/8. Antes de cada envio o body foi comparado ao congelado; endpoint único oficial, somente mensagem sintética/contexto mínimo/questions/choices. Expected e metadados de avaliação permaneceram locais. Zero telefone, ID interno, dado financeiro real ou secret no payload.

Registro de proveniência: decisões são JEV; financial.report é DETERMINISTIC_DERIVATION. Valores financeiros continuam BACKEND, não consultados nem inferidos nesta bateria.

Zero OpenAI/Luna/JEV extra, banco, Tools de negócio, efeitos, retries, router, threshold ou ampliação de allowlist. Modelo oficial gpt-6-luna; paid flag false. Policy/parser/provider/catalog/runtime inalterados.

Artefato primário: financial-modifier-real-2026-09-23.json, SHA-256 cccde482f4bf61a3bca0f5a0a799c0094ac8a7a3e8507710191f0c2dcec5f988.
Apenas esse relatório sanitizado e esta análise foram criados. Casos restantes não devem ser retomados sem nova autorização.
