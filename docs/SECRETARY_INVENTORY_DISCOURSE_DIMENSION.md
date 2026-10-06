# Inventário: dimensão explícita de discurso e atividade

27/09/2026. Continuação do STOP documentado em `SECRETARY_INVENTORY_ACTION_LOCAL_PROOF.md`. O freeze conservador V2, seus seis FAIL funcionais e os resultados da revisão independente permanecem preservados. Golden e holdout não foram reclassificados nem executados novamente neste subtrabalho.

## Propriedade factual

Uma contagem tem uma dimensão. Contar ações, alterações ou comentários não fornece quantidade de produto, assim como contar minutos ou reais também não fornece unidades de estoque. A correção reconhece a dimensão explícita do número; não decide a intenção da frase, não cria operações e não interpreta verbos.

O registro é fechado e dividido conceitualmente em duas classes de substantivos de contagem abstrata:

- atividade/evento: ação, alteração, ajuste, mudança, tarefa;
- discurso/texto: observação, anotação, comentário, instrução, recado.

As flexões singular/plural são explícitas. Itens, coisas e unidades são coleções ou medidas genéricas e não comprovam essa dimensão. Recipientes desconhecidos continuam desconhecidos; não foi criada uma lista de embalagens a excluir.

## Condições de exclusão

Somente os spans completos de numeral e unidade podem receber essa dimensão. O recognizer reutiliza os átomos e a validade lexical do parser factual existente. O preâmbulo inteiro precisa preceder a própria ação, terminar em dois-pontos seguido somente de espaço e ficar fora de qualquer scope de operação com fronteira validada e de qualquer identidade de catálogo observada. Uma irmã exata, mas sem fronteira demonstrável, não ganha autoridade para vetar a prova própria nem para mascarar bytes, conforme o contrato anterior.

Todos os números desse preâmbulo precisam ser exatos, inteiros não negativos e ter uma unidade explícita da dimensão abstrata. Se houver um único número sem classificação, uma unidade misturada, operador de limite, negação, fator, denominador ou medida de estoque, o preâmbulo inteiro permanece como evidência não resolvida. Nenhum valor é convertido, somado ou inferido.

Uma medida já tipada como moeda, data, horário, duração ou objeto ERP não pode receber simultaneamente a dimensão de discurso. A exclusividade usa os spans do classificador factual existente, sem uma segunda lista de moedas ou formatos. A relação de denominador `por` inclui suas quatro contrações com artigo, como nas demais verificações do guard.

O registro não presume que o número de comentários ou ajustes coincida com a quantidade de operações do plano. Ele é contexto fornecido na mensagem, não uma promessa de execução nem autorização de qualquer ação. A autoridade do grafo e dos executores permanece separada.

Identidades têm precedência: se um produto se chama “Observações” ou “Mudanças Premium”, sua ocorrência não pode desaparecer como metadado. A fonte original continua sendo usada por todos os guards de medida, unidade, produto, negação e fator. A máscara dimensional é local e não altera payload, literal, fonte ou draft.

Uma fronteira forte exige pontuação de sentença. O ponto interno de um numeral, inclusive um numeral malformado como `2.00`, não recorta o preâmbulo e não cria uma segunda contagem válida a partir de seu sufixo.

## Evidência

- Nova matriz antes da correção: **15 FAIL / 29 PASS**, 44 testes. Log `.demo/inventory-discourse-dimension-red-v1.log`.
- Primeira rodada: **96 PASS / 1 FAIL**, 97 testes. O novo negativo detectou o recorte do numeral malformado pelo ponto interno. A falha foi preservada em `.demo/inventory-discourse-dimension-focused-v1.log`; seu expected não mudou.
- Depois de corrigir a fronteira: **518/518 PASS**, onze arquivos, em `.demo/inventory-discourse-dimension-regression-v2.log`.
- Os quatro testes 1/2/5/10, os dois positivos de cabeçalho, os replays V208/V223 e as projeções permanecem com as mesmas assertions.
- Nenhum teste histórico, expected, mensagem, fixture original ou resultado de holdout foi alterado para obter PASS.

A revisão repetiu os 84 controles anteriores sem mudar expected: **84/84 PASS** no freeze inicial desta dimensão. A análise adicional gerou 38 controles dimensionais e quatro de denominador com contração: **35/42 PASS, 7 FAIL**. Os sete casos falhos foram propostos pelo autor e reproduzidos de forma independente; são regressões de desenvolvimento, não um holdout cego. Seus testes e logs RED permanecem em `.demo/inventory-v2-adversarial.dimension*`.

Os três conflitos de dimensão (`R$`/`BRL` junto a unidade abstrata) motivaram a regra de exclusividade de spans factuais. As quatro contrações motivaram a aplicação consistente da relação gramatical completa de `por`. Não houve alteração dos resultados esperados. Sete controles permanentes foram acrescentados à matriz do autor; os 44 anteriores permanecem intactos.

Após essas correções: **525/525 PASS**, onze arquivos, log `.demo/inventory-discourse-dimension-regression-v3.log`. Lint dos sete arquivos TS: PASS, log `.demo/inventory-discourse-dimension-lint-v2.log`. Os mesmos 126 controles da revisão aguardam reexecução no novo freeze; TypeScript e gates gerais são centralizados pelo coordenador.

O único runtime alterado nesta continuação é `inventory-quantity.ts`. A revisão independente deve repetir seus mesmos 84 controles e examinar a nova dimensão. Os resultados locais não demonstram PostgreSQL, staging, uma nova bateria independente conversacional ou aprovação dos gates gerais.
