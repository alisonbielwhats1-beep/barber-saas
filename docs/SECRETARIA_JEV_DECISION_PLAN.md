# Gate 3.1A — auditoria offline e hipótese condicional v2

22/09/2026. Somente avaliação isolada. Zero chamadas JEV/OpenAI, zero banco, zero mudança no caminho da Secretária. `SALON_SECRETARY_ALLOW_PAID_CALLS=false`. O ensaio flat v1, dataset, gabaritos e `first-run.json` permanecem preservados. O novo plano não é um router produtivo e não autoriza sua execução real.

## Evidência e causa provável

O payload real do primeiro ensaio continha uma mensagem Financial (`Quanto faturei ontem?`), contexto vazio e sete perguntas Choice: skill, operation, shape, period, metric, inventory, communication. As perguntas completas e choices estão preservadas em `packages/salon-secretary/evaluation/flat-first-response.json`, junto da resposta real. A fixture reproduz a rejeição original; não se altera o gabarito para fazê-la passar.

Seis decisões estavam corretas. Communication escolheu unspecified=0,31 contra none=0,30; EXACT=0,25, unclear=0,10, GENERATED=0,04. Confidence=0,15. A pergunta já dizia “none sem mensagem”, portanto não é correto alegar ausência total de instrução/contexto. Ela recebia a frase original, mas não recebia a resposta financial da pergunta skill.

A [documentação oficial previamente auditada](https://docs.typesafe.ai/primitives) descreve perguntas avaliadas independentemente/paralelamente sobre o mesmo state. Uma pergunta não consome a resposta de outra na mesma chamada. Não há evidência de dependência condicional intra-request nesse contrato. Nesta tarefa não houve nova consulta de rede.

O desenho flat solicita uma classificação Communication irrelevante, com vários rótulos de mensagem concorrentes, mesmo quando não existe pedido de mensagem. Isso introduz uma oportunidade adicional de erro e uma obrigação de consistência entre respostas independentes. É uma causa de desenho plausível para o ruído observado, **não uma causalidade comprovada**. Uma única amostra não distingue efeitos de idioma, instructions, classes, modelo, independência ou acaso. Não foi provado que o modelo “pensou” em outro domínio.

O parser não rejeitou null ou formato equivalente: o payload de resposta tinha tipos, labels e distribuições válidos; ele rejeitou uma contradição semântica real entre campos. Essa defesa continua intacta. Não houve normalização unspecified → none.

## Hipótese escolhida e alternativas

O flat é útil como baseline diagnóstico, mas não é um bom desenho final para obrigar sete decisões em toda solicitação. Adota-se **somente como hipótese experimental versionada**:

1. Continuação conhecida: devolver ao fluxo de draft/fast-path existente, sem JEV. A avaliação não reimplementa o parser.
2. Descoberta: uma requisição com `skill` e `shape` (single/independent/dependent/unclear/out_of_catalog).
3. Somente se a descoberta validada indicar uma Skill única + single: outra requisição com perguntas pertinentes. O state dessa chamada contém `selected_skill`, identificado como resultado JEV anterior, nunca como verdade/autorização de domínio.
4. Compound, dependente ou ambíguo: parar após descoberta e marcar fallback/insuficiência; não tentar gerar grafo, nomes, refs ou texto. Fora do catálogo: indisponível, sem forçar Skill existente ou chamar Luna.

| Skill única descoberta | Perguntas da segunda requisição | Omitidas nesta ramificação |
|---|---|---|
| Services | operation | period, metric, inventory, communication |
| Customers | operation | period, metric, inventory, communication |
| Scheduling | operation | period financeiro, metric, inventory, communication |
| Financial | operation, metric, period | inventory, communication |
| Inventory | operation, inventory | period, metric, communication |
| Communication | operation, communication | period, metric, inventory |

`period` é período **financeiro**, não data/hora da agenda. Scheduling decide apenas operação e explicita necessidade de extração/resolução posterior. Financial preserva operação como verificação: `financial.report`, multiple, unclear e out_of_catalog; não se assume consulta válida só porque a Skill foi reconhecida. O mesmo vale para operações das demais Skills, cujas choices são filtradas para a Skill e mantêm escape de ambiguidade/fora do catálogo.

As duas perguntas de descoberta continuam independentes; respostas inconsistentes são recusadas. Na segunda chamada as perguntas pertinentes podem ser paralelas, com validação cruzada no backend: por exemplo low_stock exige product.search, não stock.movement. Metric/period também não são resolvidos por data hardcoded. Ausência de período em métrica que o exige permanece insuficiência.

Não se escolheu uma cascata de quatro chamadas skill→operation→metric→period: elevaria round-trips sem necessidade demonstrada. Tampouco foi implementada uma única classe combinando todas as Skills/métricas/períodos: multiplicaria combinações e mudaria demais a avaliação. Sem entrada confiável anterior, selecionar Financial/Inventory localmente pelo gabarito seria vazamento; isso é proibido.

**Trade-off explícito:** os casos simples agora podem consumir duas requisições em vez de uma. A hipótese não é arquitetura produtiva aprovada. Menos bytes/perguntas não prova menor custo faturado ou latência.

## none, unspecified e ausência da pergunta

- `none`: ausência semântica legítima. Ex.: período ausente na consulta de recebíveis atuais; permanece uma resposta do provedor quando a pergunta foi feita.
- `unspecified`: existe intenção de mensagem, mas o modo não foi estabelecido. Conserva o valor e exige esclarecimento/fallback. Nunca converter globalmente para none.
- Pergunta não aplicável após Skill simples validada: não enviar. A projeção para o contrato canônico legado pode conter none, mas com `dimensionSources=NOT_APPLICABLE`, sem `answers`, confidence ou probabilidades fabricadas.
- Pergunta ainda não respondida em plano múltiplo/ambíguo: `NOT_RESOLVED`, `decision=null`; não preencher none e fingir um plano completo.
- Communication selecionada + communication=none: conflito, não aprovação. Financial + metric=none: conflito. Campo fora da Skill ou pergunta extra: rejeição.

Confidence ausente mantém fallback. Confidence baixa é preservada para calibração futura, sem threshold arbitrário nesta etapa. Nenhuma confidence autoriza aprovação: `accepted=false`, `executable=false` e `NO_ACCEPTANCE_POLICY` permanecem mesmo quando há cobertura fechada. `closedCoverage` indica suficiência do contrato experimental, não certeza/acerto. Scheduling, entidades abertas e conteúdo de mensagem continuam exigindo Luna/backend; não há chamada automática.

`scoreConditionalDecisions` mede somente dimensões efetivamente perguntadas e separa N/A/não resolvidas. Financial correto passa a contar 5/5 respostas, não 7/7 com duas respostas fabricadas. A projeção canônica completa permanece disponível para comparações de contrato, com proveniência explícita; não confundir essa métrica com acerto das respostas do modelo.

## Auditoria dos 40 casos

`conditional-audit.json` contém, **para cada caso**: classe A/B/C/D, caminho, perguntas iniciais/condicionais, condição, dimensões omitidas/não aplicáveis/não resolvidas, requisitos abertos, indicação de Luna, requisições e bytes antes/depois. `conditional-audit.ts` gera o artefato deterministicamente sem rede.

O planejamento offline usa o expected para mostrar a ramificação hipotética correta. Isso é marcado `oracleOnlyOfflinePlan=true`; o adapter/coordenador real não recebe caso, classe ou expected. Sua ramificação depende exclusivamente da descoberta recebida. Um teste força descoberta Inventory sobre texto Financial para comprovar ausência de roteamento pelo oracle.

Os cinco casos A permanecem no fast-path aprovado. Duas continuações C (serviço e período ambíguo) voltam ao fluxo de draft/modelo existente; não são reclassificadas. Os demais casos passam pela descoberta. Pedidos compostos independentes e dependentes interrompem antes do detalhe, incluindo múltiplas operações dentro de Financial. Casos D não são forçados a Skill publicada.

Distribuição exata de caminhos: 5 fast-path; 2 continuações no fluxo existente; 24 descoberta + detalhe condicional; 9 descoberta + fallback/indisponível. A/B/C/D e expected do dataset original não foram alterados.

## Payload e custo teórico

Bytes abaixo são JSON UTF-8 minificado, somando todas as requisições planejadas. Não são tokens, tráfego total com headers nem cobrança medida. Planos pressupõem descoberta correta; erro pode interromper antes.

| Cenário | Perguntas v1 → v2 | HTTP v1 → v2 | Bytes v1 → v2 |
|---|---:|---:|---:|
| Financial simples | 7 → 5 | 1 → 2 | 3.583 → 2.580 |
| Inventory baixo | 7 → 4 | 1 → 2 | 3.602 → 1.954 |
| 40 casos, plano literal | 280 → 105 | 40 → 57 | 144.520 → 54.333 |
| Mesmos 33 casos elegíveis, sem continuações | 231 → 105 | 33 → 57 | 119.127 → 54.333 |

Financial: redução de 28,6% das perguntas e 28,0% dos bytes. Inventory: 42,9% e 45,8%. O total inclui exclusão de sete continuações; não atribuir ao mecanismo condicional uma economia de fast-path que já existia. A comparação dos mesmos casos elegíveis é calculada no artefato/entrega. Há 24 detalhes condicionais e 33 descobertas, portanto 57 requisições potenciais; isso **aumenta** chamadas HTTP.

Somente como sensibilidade explícita, usando 4 bytes JSON/token e US$0,042/milhão de input: Financial passa de US$0,0000376215 para US$0,000027090; Inventory de US$0,000037821 para US$0,000020517. Soma teórica nova US$0,000047607. O proxy não é previsão: o primeiro JEV real usou 1.236 input tokens para 3.583 bytes JSON e custou estimados US$0,000051912, demonstrando que não se deve equiparar JSON/tokenização/instruções internas. Custo real futuro exige usage do provedor em **ambas** as chamadas. Envelope conservador publicado para quatro chamadas ×64k: US$0,010752, não hard limit contratado.

Não há nova latência medida. Único dado real: JEV ~873,8ms, n=1; Luna histórico ~4.055ms com outro contrato/instrumentação, não pareado. Duas etapas sequenciais podem piorar latência. Não declarar ganho com estes números offline.

## Revalidação mínima preparada — NÃO executar

Artefato: `conditional-revalidation.json`, versão conditional-v2, somente:

1. `Quanto faturei ontem?`: discovery(skill,shape); somente se financial/single, detalhe(operation,metric,period). Expected financial.report/service_revenue/yesterday; Inventory/Communication não perguntadas.
2. `Quais produtos estão com estoque baixo?`: discovery(skill,shape); somente se inventory/single, detalhe(operation,inventory). Expected product.search/low_stock; Financial/Communication não perguntadas.

Máximo **duas mensagens, quatro chamadas HTTP**: cinco decisões Financial + quatro Inventory = nove perguntas no total. Zero retries, zero fallback Luna, deadline 10s por chamada. Parar em erro, descoberta inesperada ou divergência material. Não trocar silenciosamente para outra ramificação no ensaio delimitado. Os payloads exatos condicionais e seus expected separados estão no artefato; enviar somente payload, jamais expected. Nenhum Scheduling ou caso complexo está nesta proposta.

## Implementação e preservação

- `jev-provider.ts`: extensão tipada opcional de protocolo de avaliação para reutilizar transporte/timeout/segurança. O protocolo flat continua sendo o default; não muda suas instructions, choices, parser ou rejeição do caso real.
- `conditional-plan.ts`: etapas, requests, validação estrita e composição com proveniência.
- `conditional-provider.ts`: coordenador isolado, orçamento HTTP próprio padrão zero, no máximo duas etapas por avaliação. Reutiliza transporte aprovado; não importa DB/Tools/Luna.
- `conditional-audit.ts` e `.json`: auditoria offline de todos os casos e medições.
- `conditional-revalidation.json`: plano de duas mensagens aguardando autorização.
- `flat-first-response.json`: golden real negativa imutável nesta entrega.
- `jev-conditional-evaluation.test.ts`: regressões A–J e limites adicionais.

`runEvaluation` existente continua utilizável com provider injetado; seu maxCalls conta avaliações, enquanto `ConditionalJevProvider.maxCalls` limita requisições HTTP reais entre etapas/casos. Ambos precisam ser delimitados. Nenhum threshold/router produtivo foi adicionado. Não houve alteração de Agent/Registry/Skills/Tools/prompts produtivos/backend/banco/credenciais. O dataset de 40 casos, gabaritos e baselines permanecem inalterados.

## Limitações e rollback

A hipótese ainda não foi testada com JEV real. Uma descoberta errada pode omitir perguntas necessárias; ramificações e regras de consistência não tornam classificação infalível. O desenho não extrai entidades, valores, datas, texto ou grafos. As médias de acerto flat e condicional precisam considerar coverage/proveniência, não contar none derivado como resposta adicional correta do modelo.

Rollback: restaurar somente a extensão opcional de protocolo em `jev-provider.ts` e retirar os arquivos novos desta auditoria. Não alterar `.env.local`, dataset, gabaritos, first-run original ou outros Gates. Backup anterior da avaliação em `%TEMP%/gate31a-conditional-backup`; inventário SHA-256 em `%TEMP%/gate31a-conditional-before.json`. Sem migration, deploy ou dados a reverter.

## Verificação local

- Testes direcionados flat + conditional: **105 aprovados** (79 anteriores + 26 novos), incluindo A–J, payload real negativo, orçamento por etapa, isolamento de perguntas e ausência de consulta ao oracle no coordenador.
- Suíte geral: **1.602 testes aprovados em 238 arquivos**, incluindo Services, Customers, Scheduling, Financial, Inventory, Communication e o harness anterior.
- `npm run lint`: exit 0.
- `npx tsc --noEmit --incremental false`: exit 0.
- `npm run build`: exit 0, offline com mock de fonte; compilação, tipos e prerenderização concluídos.
- `git diff --check`: sem erros de whitespace.
- Dataset original, expected e first-run v1: idênticos ao backup.
- Inventário: somente `evaluation/jev-provider.ts` mudou entre arquivos preexistentes; oito arquivos novos listados nesta entrega. Core, Registry, prompts operacionais, banco e credenciais preservados.

Comandos executados com HTTP/sockets bloqueados no processo Node. Build usa mock de Google Fonts suportado pelo Next instalado e configuração sintética exclusivamente no processo; nenhuma fonte, secret ou dependência é baixada. Não houve teste PostgreSQL, acesso externo ou inferência real. Evidências em `%TEMP%/gate31a-conditional-{tests,suite,lint,tsc,build}.log` e `gate31a-conditional-verification.json`.
