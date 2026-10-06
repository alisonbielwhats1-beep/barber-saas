# Inventário: prova factual delimitada por ação e total explícito

27/09/2026. Correção de classe motivada pelos resultados já observados V208 e V223 do holdout V2. O holdout permanece reprovado; seus resultados, mensagens e expectativas não foram alterados. Estes replays agora são regressões de desenvolvimento, não uma nova medição independente.

**Gate aberto.** A primeira implementação foi reprovada pela revisão independente: 16 FAIL em 84 controles. A correção conservadora subsequente tem 468 PASS / 6 FAIL nos 474 testes focados. Os seis positivos restantes estão preservados nos arquivos e bloqueiam o fechamento. Nenhuma build pronta é demonstrada por este documento.

## Primeiro ponto de perda

V208, `turns.jsonl:15–16` e `provider-observations.jsonl:15–17`, em `evaluation/results/free-use/holdout-v2-20260927-final-v1`:

1. Luna publicou quantidade 3 e literal `três unidades`, ambos corretos. A primeira saída continha um `e` inexistente em source_scope; o reparo limitado retirou somente esse byte semântico de transporte. O objeto inventory ficou idêntico.
2. O backend invalidava a prova inteira porque uma ação irmã de serviço vinha depois de uma introdução terminada em dois-pontos. A fronteira gramatical da irmã não era reconhecida.
3. Isolando essa dependência, o motivo causal com contração de `por` não ganhava o papel de complemento. Seu texto era tratado como continuação desconhecida do nome do produto.
4. Admitidas essas fronteiras em sondas contrafactuais de diagnóstico, a cardinalidade da introdução do lote ainda entrava na lista global de números concorrentes. A quantidade continuava bloqueada como ambígua.
5. `applyInventoryInterpretation` removia quantity ao receber NEEDS_INPUT. Draft, ActionPlan e UI projetavam esse estado de maneira consistente, repetindo a pergunta após o segundo turno preencher somente a duração de outra ação. A perda original estava no guard factual, não no merge ou no transporte.

V223, `turns.jsonl:41–42` e `provider-observations.jsonl:42–44`:

1. A primeira mensagem fornece embalagens. A pendência de total em unidades é correta e continua obrigatória.
2. A resposta fornece literalmente doze unidades ao todo. Luna preservou 12 e a medida completa; o reparo alterou somente source_scope.
3. O guard reconhecia o operador de total apenas antes do numeral. Como o operador aparecia depois da medida, o número explicativo por embalagem continuava sendo interpretado como fator concorrente. O backend removia 12 e repetia a pergunta.

## Contrato implementado

- A própria prova continua exigindo ocorrência literal exata e única, limites completos e nenhuma sobreposição com uma prova irmã. Sem source_scope próprio, permanece a validação conservadora anterior.
- Uma prova irmã disjunta, cuja fronteira não seja demonstrável, não pode mascarar caracteres da fonte nem vetar automaticamente uma prova própria completa. Ausência/ambiguidade do literal e sobreposição continuam bloqueadas.
- Dois-pontos admite a delimitação literal de uma ação, mas não demonstra que um preâmbulo seja cabeçalho em vez de medida. Qualquer número ou operador no preâmbulo permanece vinculado até uma fronteira independente forte (`.;!?`). Isso não recorta a mensagem usada para verificar identidade, operadores, negação, unidade ou qualificadores.
- A análise de resíduos numéricos admite localidade depois de uma fronteira independente. Medidas literais, contagens vinculadas ao mesmo produto e operadores através de dois-pontos permanecem conservadores. Não se adicionou uma lista de substantivos de embalagem ou cabeçalho. A consequência conservadora, ainda não resolvida, é pedir clarificação diante de cabeçalhos legítimos numéricos imediatamente anteriores à primeira ação.
- A classe gramatical de `por` inclui suas quatro contrações com artigo. O mesmo conjunto também passa pela detecção de denominadores, evitando aceitar uma razão aparente como `pela caixa` enquanto total em unidades.
- Total é um operador vinculado à medida literal, antes ou depois dela. Um total explícito pode ter uma explicação de distribuição adjacente introduzida por `cada`, sem depender de uma lista de nomes de recipientes. Essa explicação não fornece o total por cálculo; o valor precisa estar escrito e coincidir com o valor estruturado. Outro produto, quantidade aproximada, embalagem ou denominador continuam pendentes.
- A magnitude lexical e a exatidão de seu operador são fatos separados: uma quantidade qualificada de clientes pode pertencer a outra dimensão; um numeral malformado como `R$2.00` não ganha essa dispensa. O mesmo parser de números fornece ambas as verificações.
- Provas semânticas delimitam papéis; não substituem o catálogo. Uma identidade completa ou uma variante mais específica na fonte original continua prevalecendo sobre uma máscara de motivo ou de ação irmã.

Somente `inventory-source-scope.ts` e `inventory-quantity.ts` foram alterados no runtime deste subtrabalho. SDK, catálogo, permissões, executores, coordinator, wire e avaliador não foram alterados.

## Evidência preservada e validação

Antes da alteração, os dois guards e as linhas brutas dos casos foram copiados para `.demo/inventory-action-scope-v208-before/`, com hashes no freeze. As fixtures novas mantêm sources e argumentos originais dos providers, inclusive as primeiras respostas que precisaram de reparo. Nenhum oracle do holdout foi copiado para um expected adaptado.

- Nova regressão V208, antes da correção: 10 FAIL / 20 PASS em 30 casos. Log `new-regression-red.log` no diretório preservado.
- Nova regressão de total, antes da correção: 7 FAIL / 9 PASS em 16 casos. Log `explicit-total-red.log` no diretório preservado.
- Primeira rodada dos cinco arquivos de helpers: 371/371 PASS.
- Versão incluindo total explícito: oito suites, 446 PASS. Um teste novo de projeção falhou por montar diretamente uma ActionPlan com raw wire sem os defaults internos. O log da falha foi preservado, e o setup passou a usar o helper de normalização de testes existente; nenhuma assertion foi removida ou ajustada.
- Rodada final dos dois testes de projeção: 2/2 PASS, sem DB real. V208 preserva quantity=3 no draft, proposal, ActionPlan e contexto; V223 mantém o mesmo draft e prepara delta=12, saldo 9→21, após a clarificação original. Nenhuma confirmação foi executada.
- Lint dos cinco arquivos TS envolvidos: PASS.

Os casos cobrem 1/2/5/10 ações, fonte exata, intro antes/depois da movimentação, scopes irmãos sem autoridade, contrações causais, negação e qualificadores externos, fatores cruzando fronteiras, identidade truncada, variante do catálogo, denominadores e total prefixo/sufixo. As suites existentes de dimensão, produto, provas, scopes e estado de inventário foram mantidas.

Logs: `.demo/inventory-action-scope-v208-focused-v1.log`, `...-focused-v2.log`, `...-pipeline-v3.log` e `...-lint-v1.log`.

## STOP independente e correção conservadora

O freeze V1 e a evidência da revisão permanecem intactos. A revisão independente identificou que `No máximo: some sete unidades...` perdia o qualificador quando o scope começava no verbo. Medidas de recipientes fora do vocabulário antigo também desapareciam antes de dois-pontos, enquanto recipientes conhecidos bloqueavam. É a mesma falha de fronteira, não uma coleção de frases a corrigir. A revisão identificou ainda um total literal seguido de `cada embalagem...` indevidamente bloqueado por depender do nome do recipiente.

Os 84 controles independentes tiveram 68 PASS / 16 FAIL no freeze anterior; teste e relatório continuam em `.demo/inventory-v2-adversarial.*`. O novo código retém o preâmbulo conservadoramente e usa a relação distributiva sem converter embalagens. A reexecução independente do mesmo gate é pendente neste registro.

- Rodada conservadora V2: 467 PASS / 7 FAIL em 474. Além dos seis positivos de cabeçalho, um teste histórico detectou que moeda malformada passara a ser ignorada. O log foi preservado.
- Rodada conservadora V3, após exigir magnitude lexical válida: **468 PASS / 6 FAIL em 474**. Os testes históricos, os replays V208/V223 e os dois testes de projeção passam.
- Permanecem quatro testes de cabeçalho com cardinalidade 1/2/5/10, mais dois de cabeçalho `dez ajustes`/`sete observações`. Nenhum foi removido, pulado ou teve expected alterado. Eles mostram uma limitação funcional real; não há fechamento da suíte.
- Lint dos seis arquivos TS deste subtrabalho: PASS.

Logs: `.demo/inventory-action-scope-v208-conservative-v2.log`, `...-conservative-v3.log` e `...-lint-v2.log`.

Uma possível continuação é uma dimensão factual fechada de cardinalidade do plano, ligada ao grafo completo validado. O contrato atual `operation_scopes` contém apenas irmãs com scope não nulo, portanto não prova que o conjunto seja completo. Contar esse array como total do plano seria incorreto. Também não provaria os dois positivos que declaram dez/sete itens mas fornecem somente uma ação. Não foi implementada uma exceção baseada no preâmbulo.

## Limites da evidência

O reparo conservador ainda depende da reexecução adversarial independente, TypeScript e gates globais do conjunto; os seis FAIL conhecidos permanecem abertos. Os testes de projeção usam catálogo e persistência simulados; não demonstram execução PostgreSQL ou disponibilidade de staging. O replay da ação de estoque recebe todos os scopes originais do lote, mas o teste de projeção não executa os dez domínios. Uma nova medição independente será necessária após o freeze final da implementação.
