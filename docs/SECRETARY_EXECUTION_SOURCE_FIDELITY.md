# Fidelidade da fonte no harness de execução

Em 27/09/2026 UTC, a regressão de execução parou no caso 7 com `PLAN_NOT_READY`: seis casos passaram, um falhou e treze não foram executados. O modelo estático fornecia estoque de duas unidades de Shampoo X, mas o helper enviava somente uma frase genérica de preparação. A fonte não comprovava produto nem quantidade. O guard de quantidade recusou corretamente essa entrada.

O arquivo original está preservado em `.demo/execution-source-fidelity-before/secretary-execution-e2e.integration.test.ts`, SHA-256 `93b9302a372ee4421addc8bf33f8b4210222299e82daf3772e3c92d07f502c33`. A análise sintática comprova a preservação, na mesma ordem, das 121 asserções completas originais, incluindo seus argumentos e resultados esperados. O primeiro registro chamou os 242 nós de chamada da árvore sintática de asserções; cada asserção contém uma chamada expect e uma chamada ao matcher. Essa contagem foi corrigida em `assertion-preservation-count-correction.json`, preservando também o registro anterior.

O harness agora usa mensagens estáticas explícitas em `src/test/fixtures/secretary-execution-source.json`. Elas expressam os mesmos valores e alvos já fornecidos pelos modelos estáticos: serviço, estoque, grupo misto e reagendamento. A evidência salva a mensagem efetivamente enviada, inclusive quando o helper usa seu valor padrão. Nenhuma quantidade, seleção, efeito esperado, contrato de confirmação ou regra de domínio foi alterada.

O teste `secretary-execution-source.test.ts` mantém a frase genérica original como controle negativo. Ela continua sem poder autorizar estoque. Os controles positivos exigem prova literal do mesmo produto e quantidade. A mensagem de grupo expôs, antes da correção, uma segunda falha no runtime: valores monetários e duração eram tratados como quantidades residuais de estoque. Essa falha exige correção por papel factual e nova regressão, sem relaxar o controle negativo.

Esta mudança corrige uma fixture sintética de execução. Não é evidência de compreensão por Luna. Golden Free Use, seus resultados esperados e o holdout independente permanecem separados e imutáveis. A nova execução completa ainda deve passar antes da entrega manual; o resultado anterior com falha permanece preservado.

## Correção do cenário de mudança apenas de horário

A repetição passou os dez primeiros cenários, incluindo estoque em grupo, dependências e rollback, e parou no caso 11. A nova fonte sintética repetia `amanhã` no destino, enquanto o modelo estático original só fornecia a data de origem e os dois horários. O backend exigiu corretamente o campo de data de destino que a fonte mencionava e o modelo omitia. Não houve falha de execução permissiva.

A fixture foi alinhada ao contrato original de mudança apenas de horário: a data vem do agendamento selecionado e não de um campo novo de destino. O output estático e as 121 asserções completas continuam intactos. A frase anterior está preservada no JSON como `moveWithUnprovidedDestination`, além do arquivo arquivado `secretary-execution-source-before-time-only.json`.

Dois controles novos provam a diferença: a fonte que exige data de destino, sem essa informação no output, permanece rejeitada como `SOURCE_TEMPORAL_CONFLICT/date/MISSING`; a fonte de mudança apenas de horário preserva exatamente data de origem e horários fornecidos. São 5/5 testes de fidelidade aprovados, em `.demo/execution-source-time-only-final.json`. O runtime não foi alterado para aceitar a fixture incompleta.

A revisão independente aprovou a equivalência em `.demo/inventory-independent-execution-source-review.json`. A execução completa seguinte passou 20/20: `packages/salon-secretary/evaluation/results/execution-e2e/2026-09-27T02-38-53-376Z`. O relatório confirma preservação dos registros anteriores e zero chamadas externas. As duas rodadas anteriores, seus STOPs e as revisões explícitas de correção permanecem arquivados.
