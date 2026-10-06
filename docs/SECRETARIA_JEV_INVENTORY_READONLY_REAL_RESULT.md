# Gate 3.1C-B.4.1 — Inventory read-only real calibration

Data: 2026-09-23. Manifest imutável: `packages/salon-secretary/evaluation/inventory-readonly-plan.json`, SHA-256 `dcc9bd919ec2ea1a678a7443abc7d35213d9906b63aacf12dc4c924d198cbe0a`.

Relatório integral sanitizado: `packages/salon-secretary/evaluation/inventory-readonly-real-2026-09-23.json`, SHA-256 `26ee9f6081b73dac94d0938b668803c53a55bf5b3f223003005bbaba51b4a380`. Contém, para cada HTTP, request congelada, status, latência, bytes, decisões/probabilidades/confidence quando válidas, usage, custo estimado e diagnóstico seguro. Não contém chave, cabeçalho Authorization ou corpo bruto inválido.

## Parada e conclusão

**15/26 avaliações; 28/52 HTTP.** Stop em **n07**, `UNSAFE_SELECTOR_ONLY_CANDIDATE`. A mensagem pede saldo **estritamente menor** que o mínimo e exclui a igualdade. JEV produziu Inventory/single/low_stock, e o catálogo derivou product.search. A consulta publicada usa `stock <= minStock`. Portanto, a interpretação **não é semanticamente completa**.

A Acceptance Policy atual retornou FALLBACK_REQUIRED/UNCALIBRATED_INPUT; **zero UNSAFE_FALSE_POSITIVE aceitos**. O plano de seleção, se fosse expandido por intenção, marcaria n07 como cobertura fechada: essa é a falha encontrada e motivou a parada. `low_stock` teve selected probability **1,00**, confidence **0,99** e margem **1,00** nesse erro semântico. Confidence não o tornou correto. Nenhum caso n08–n18 foi executado.

Recomendação **C) KEEP_LUNA** para qualquer expansão da família low_stock além da frase já PROVEN. Os oito positivos mostram reconhecimento da intenção, mas n07 demonstra que as três decisões atuais não bastam para proteger paráfrases inéditas contra modificadores/condições adicionais. Preservar i01 na allowlist atual; nenhuma promoção ou router. Não há necessidade de mais amostras do mesmo desenho para reconhecer essa limitação estrutural.

## Resultados individuais

Todos os oito positivos foram respostas válidas, Inventory/single/low_stock, com operação `product.search` derivada e sem outro campo semântico necessário nos respectivos oracles. **Somente i01 foi aceito pela Policy atual**; i02–i08 permaneceram fallback por UNCALIBRATED_INPUT. `CORRECT_CANDIDATE` é rótulo de análise do oracle, **não um aceite produtivo**.

| Caso | Interpretação / classificação | Policy | HTTP | Tempo total ms | Input / output | Custo estimado USD |
|---|---|---|---:|---:|---:|---:|
| i01 “Quais produtos estão com estoque baixo?” | low_stock → product.search; CORRECT_CANDIDATE | ACCEPT_JEV | 2 | 1379,5 | 919 / 207 | 0,000038598 |
| i02 “Quais produtos estão acabando?” | low_stock → product.search; CORRECT_CANDIDATE | FALLBACK | 2 | 736,1 | 919 / 207 | 0,000038598 |
| i03 “Mostre os produtos com estoque baixo.” | low_stock → product.search; CORRECT_CANDIDATE | FALLBACK | 2 | 854,5 | 919 / 207 | 0,000038598 |
| i04 “Liste os itens com estoque baixo.” | low_stock → product.search; CORRECT_CANDIDATE | FALLBACK | 2 | 699,9 | 919 / 207 | 0,000038598 |
| i05 “Quero ver os produtos com saldo no mínimo ou abaixo dele.” | low_stock → product.search; CORRECT_CANDIDATE | FALLBACK | 2 | 603,8 | 929 / 207 | 0,000039018 |
| i06 “Quais produtos estão no mínimo ou abaixo do estoque mínimo configurado?” | low_stock → product.search; CORRECT_CANDIDATE | FALLBACK | 2 | 698,3 | 935 / 207 | 0,000039270 |
| i07 “Me mostra o que está acabando no estoque.” | low_stock → product.search; CORRECT_CANDIDATE | FALLBACK | 2 | 899,1 | 925 / 207 | 0,000038850 |
| i08 “Consulte os produtos cujo saldo é menor ou igual ao mínimo cadastrado.” | low_stock → product.search; CORRECT_CANDIDATE | FALLBACK | 2 | 643,9 | 933 / 207 | 0,000039186 |
| n01 “Quanto tenho de Shampoo X?” | resposta inválida, probability sum=0,99 em shape | FALLBACK | 1 | 345,6 | 502 / 138¹ | 0,000021084¹ |
| n02 “Qual o saldo do Shampoo X?” | balance → stock.balance; produto aberto; CORRECT_FALLBACK | FALLBACK | 2 | 760,4 | 917 / 206 | 0,000038514 |
| n03 “Tenho Shampoo X em estoque?” | balance → stock.balance; produto aberto; CORRECT_FALLBACK | FALLBACK | 2 | 891,2 | 917 / 206 | 0,000038514 |
| n04 “Procure o produto Shampoo X.” | search → product.search; produto aberto; CORRECT_FALLBACK | FALLBACK | 2 | 1032,9 | 917 / 206 | 0,000038514 |
| n05 “Liste os produtos do estoque.” | **balance incorreto**, search esperado; fallback seguro | FALLBACK | 2 | 751,3 | 917 / 206 | 0,000038514 |
| n06 “Quais shampoos estão com estoque baixo?” | resposta inválida, probability sum=0,99 em shape | FALLBACK | 1 | 398,5 | 505 / 138¹ | 0,000021210¹ |
| n07 “Quais produtos estão estritamente abaixo do mínimo, sem incluir os que estão exatamente no mínimo?” | low_stock parcial → product.search; **UNSAFE_SELECTOR_ONLY_CANDIDATE** | FALLBACK | 2 | 896,0 | 943 / 207 | 0,000039606 |

¹ Usage recuperado **somente do diagnóstico sanitizado** de HTTP 200 inválido; custo calculado a partir do input publicado. Não equivale a usage validado pelo parser nem a custo faturado. Em n01 e n06, detail não foi perguntado; nenhuma decisão parcial inválida contou como acerto linguístico.

Nos positivos i01–i08, a interpretação linguística e a derivação foram consistentes entre paráfrases. n02–n04 mostram apenas valor de classificação: identificar `balance/search` não extrai `Shampoo X`. n05 demonstrou erro de intenção, com `balance` selected probability 0,50/confidence 0,41, rejeitado pela Policy. n07 demonstrou o risco principal: intent aparentemente correto com semântica omitida.

## Métricas com denominadores

- Taxonomia pedida: **8 CORRECT_CANDIDATE**, **5 CORRECT_FALLBACK** por segurança da Policy (n02–n05, n07), **0 FALSE_FALLBACK**, **0 UNSAFE_FALSE_POSITIVE aceito**, **2 INVALID_PROVIDER_RESPONSE**, **0 OUT_OF_CATALOG_CORRECT** antes da parada. n05 foi fallback correto como decisão de segurança, embora o seletor linguístico esteja errado; n07 foi fallback correto com candidato incompleto, o sinal crítico separado.
- Policy: **1 ACCEPT_JEV correto em 1 aceite**; 14 fallbacks. Acceptance accuracy descritiva 1/1, sem inferência estatística.
- Provider: **28/28 HTTP 200**; **26/28 respostas estruturadas válidas = 92,86%**; 2/28 inválidas = 7,14%, ambas `PROBABILITY_SCHEMA_INVALID` em `answers.shape.probabilities`, soma publicada 0,99. KEEP_STRICT preservado, sem reparo/renormalização/retry.
- Seletores publicados entre 13 casos com detail válido: **12/13 = 92,31%** contra o expected parcial; n05 errou `search` como `balance`. Isso não mede entendimento integral: **8/13 = 61,54%** tinham interpretação fechada completa conforme oracle. n07 acertou o seletor parcial, mas **falhou na completude**.
- **8 POTENTIAL_FULL_JEV_BYPASS** observados nos positivos; **1 aceite pela Policy atual**; **1 candidato de seletor semanticamente inseguro** em n07. Nunca interpretar 8/8 positivos como autorização para bypass de frases novas.
- Routing-only correto: 3 (n02–n04); n05 escolheu intent errado. Negativos n08–n18 permanecem sem evidência real.

## Confidence, latência e custo

O JSON preserva, para as **39 decisões válidas observadas**, selected choice/probability, confidence, runner-up/probability e margem. Confidence: min 0,38; mediana 0,98; max 1,00. Margem top1-top2: min 0,23; mediana 0,98; max 1,00. Em n07, `skill=inventory`: p 0,93/conf 0,92/margem 0,89; `shape=single`: p 0,70/conf 0,62/margem 0,56; `inventory=low_stock`: p 1,00/conf 0,99/margem 1,00. Nenhuma confidence foi atribuída à operação derivada.

Latência HTTP, n=28: min **266,8 ms**, p50 **399,9 ms**, média **408,7 ms**, p95 descritivo **598,5 ms**, max **738,4 ms**. Avaliação mensagem→resultado/Policy, n=15: min **345,6 ms**, p50 **751,3 ms**, média **772,7 ms**, p95 descritivo **1136,9 ms**, max **1379,5 ms**. Tempos discovery, detail e Policy individuais estão no relatório.

Bytes serializados enviados: **22.031** em 28 HTTP. Usage validado: **12.009 input / 2.687 output** em 26 respostas; mais **1.007 input / 276 output** obtidos somente por diagnóstico nos dois HTTP inválidos. Total observado nas duas fontes: **13.016 input / 2.963 output**. Custo estimado das respostas validadas: **US$0,000504378**. Estimativa adicional com usage diagnóstico: **US$0,000042294**. **Total estimado: US$0,000546672**, inferior ao teto de planejamento US$0,139776; não é valor faturado.

Tarifa oficial reconfirmada antes da primeira chamada na [publicação da TypeSafe](https://typesafe.ai/blog/introducing-system-one-models-and-jev): **US$0,042/M input; output gratuito**.

## Segurança e escopo encerrado

O único tráfego de inferência gerado pelo executor foi TypeSafe/JEV; 28 requests serializadas iguais ao manifest, apenas mensagens sintéticas/contexto vazio/questions/choices. Nenhum expected, ID interno, telefone, registro de estoque, dado real ou segredo foi enviado no corpo. Key presente no processo e ausente do relatório. **Zero OpenAI/GPT-6 Luna, banco, Tools de negócio, effects Everflair, retries ou fallback executado.** `SALON_SECRETARY_ALLOW_PAID_CALLS=false` e `SALON_SECRETARY_MODEL=gpt-6-luna` permaneceram. Policy, allowlist, parser KEEP_STRICT, provider, catálogo e runtime não foram alterados. Nenhum router implementado.

Parada definitiva desta execução em n07; não repetir nem avançar n08–n18 nesta autorização. Para o encerramento formal do JEV V1, registrar que a expansão Inventory read-only não é segura com a assinatura atual; conservar somente a entrada PROVEN prévia. O Tópico 13 (Router JEV → GPT-6 Luna) depende de decisão separada e deverá preservar fail-closed e a mesma fronteira semântica.
