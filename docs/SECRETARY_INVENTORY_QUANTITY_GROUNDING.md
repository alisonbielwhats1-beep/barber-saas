# Quantidade de estoque: medida literal e unidade do catálogo

Estado: candidato local congelado para nova revisão independente e validação integrada. Não declara Golden, holdout ou staging prontos.

## Falha preservada

Golden v9 GF28 recebeu “Chegaram duas caixas do Óleo Aurora.”. Luna retornou `quantity:2`; a operação descartou a unidade linguística e preparou `+2 un` confirmável. O runner interrompeu a bateria, sem mutação operacional. O output original, mensagem, SHA dos argumentos e hashes dos arquivos de origem estão em `src/test/fixtures/secretary-real-wire-golden9-inventory.json`.

A causa era de contrato: quantity era um inteiro solto, a restrição de unidade existia somente no manual e o adapter não recebia o texto original. O catálogo atual publica uma unidade fixa `un`; não existe contrato de conversão de embalagens.

## Correção

- O transporte passa quantity como `null | {value, literal}`. O literal contém a medida completa. O decoder só transforma estrutura; não converte embalagens nem decide compatibilidade.
- O guard factual confronta numeral, medida completa, composição, produto e mensagem atual. Unidades incompatíveis/sem prova ficam pendentes; números internos de fatores não viram totais.
- A unidade explícita não dispensa o vínculo ao produto. NEW exige a menção completa do produto associada à medida. Uma réplica integral de quantidade+unidade pode usar o alvo e draft vigentes sem repetir o nome; uma sentença com sujeito atual não herda essa autoridade.
- `PRODUCT_UNPROVEN` não vira pergunta somente de quantidade: query/target saem do estado efetivo e a pergunta solicita produto. A medida e source originais ficam em pendência privada; corrigir o nome exige revalidá-los contra a identidade correta. Contagem de embalagem não é promovida nesse caminho. Um número respondendo à pergunta de produto não substitui a medida anterior.
- A contagem direta do produto continua válida, incluindo concordância singular/plural. Essa comparação não cria aliases de catálogo nem resolve entidades. A entidade permanece sob as buscas tenant-scoped existentes.
- Um total fornecido explicitamente em unidades é preservado. O guard não calcula esse total a partir das embalagens.
- Um número sem unidade só responde a pergunta quantity publicada pelo backend, com produto, draft, revisão, validade e unidade compatíveis.
- `quantity_resolution` é metadata backend-owned separada de fields. Uma contagem pendente preserva a expressão e sua causa, mas remove quantity executável. U03 não recupera o valor antigo pelo merge.
- Draft, plano e pergunta usam o estado efetivo. Nenhuma proposal existe enquanto falta a quantidade na unidade válida. Proposal e hash carregam o contrato conversacional.
- Se persistir o draft falha, o estado anterior é preservado. Se o draft foi confirmado pelo storage e a preparação posterior da proposal falha, o estado em memória conserva a nova revisão e permite retry. A confirmação anterior permanece invalidada.

## Revisão independente: prova parcial positiva

A primeira revisão encontrou oito propostas indevidas em dez probes: prefixo de variante do produto, fator com tokens intermediários, sinal negativo descartado, negação, retratação, sujeito atual diferente do alvo e recuperação histórica ignorando a correção atual. Os arquivos originais `.demo/inventory-independent-*` permaneceram intactos; a repetição após a correção passa 10/10.

A correção trata propriedades da prova:

- Numerais são átomos completos com sinal, decimal ou fração. `-5`, `2.5` e `5/2` não contêm uma quantidade positiva executável `5`.
- O nome do catálogo precisa terminar em fronteira factual demonstrável. Não basta encontrar o prefixo de uma variante mais longa.
- Uma medida anterior sem unidade de catálogo torna o número interno candidato a fator; tokens intermediários e pontuação não o promovem a total. Um total explicitamente fornecido em `un` continua aceito, sem cálculo de conversão.
- Quantidade adicional do mesmo referente ou sem vínculo fica pendente. Valores de ações irmãs só são independentes quando o payload atual oferece provas distintas, completas e válidas de quantidade, unidade e produto. O coordinator passa esses witnesses de NEW/ADD/V1 ou de PATCH com item_key/op já validados. Não busca witnesses em plano antigo, sessão ou histórico.
- O backend não decide se uma oração significa IN/OUT, correção ou nova ação. Essa decomposição continua com Luna. Ele verifica os fatos de cada escopo e recusa valores residuais sem ação/prova válida.
- Recuperar quantidade pendente após corrigir produto também exige que a identidade seja comprovada no turno atual, sem uma nova quantidade ou negação conflitante. Só então a medida original é revalidada. A fonte histórica não prevalece sobre uma correção atual contraditória.

### Gramática numérica exata

A segunda revisão encontrou três classes adicionais até proposal: `2.000` interpretado como 2 em vez de 2000, sinal textual `menos` descartado e soma livre de cardinais incompatíveis. A regressão permanente adicionada antes da correção apresentou 12 falhas. A gramática agora valida composições de unidades, dezenas, centenas e mil, com seus conectores; não soma uma sequência arbitrária de palavras. Ponto representa agrupamento válido de milhares pt-BR e vírgula representa decimal. Frações e agrupamentos inválidos não fornecem quantidade executável.

Prefixos numéricos são consumidos integralmente antes de avaliar exatidão. Cadeias de sinais, comparadores matemáticos Unicode/ASCII, limites, aproximações e intervalos não podem ser recortados até sobrar um inteiro. O átomo tem classificação factual EXACT/NON_EXACT. O léxico é de operadores e descritores numéricos, sem inferir operação ou intenção. Uma matriz cartesiana de cinco prefixos, duas posições, três espaçamentos, três quantidades e dois recortes da prova cobre 450 combinações. O primeiro replay falhou em `++1`; após a correção todas recusam a cadeia inválida.

O token de unidade inclui `un.`: seu ponto não quebra o vínculo com o produto. Essa correção foi medida por três controles positivos independentes antes falhos. A matriz consolidada independente contém 262 probes: 50 aceites de valores exatos corretos, 212 clarificações seguras, zero aceite inseguro e zero falha funcional dos controles obrigatórios. O script e os oracles permaneceram intactos; o resultado anterior às abreviações foi preservado em `.demo/inventory-independent-exactness-before-abbreviation.json`.

Uma quantidade repetida pelo modelo não preserva automaticamente um valor antigo quando o turno contém outro átomo numérico, inclusive inválido. Revalidação e invalidação de proposal usam a fonte atual. Três regressões adicionais partem de proposal válida, aplicam os átomos defeituosos com o mesmo número normalizado e provam fields/draft sem quantity e confirmação anterior stale.

### Papéis de identidade e operadores

A execução PostgreSQL da coordenação encontrou uma regressão funcional no teste histórico com a frase original “Quanto faturei ontem e dê entrada em 10 Shampoo X.”. O token X do nome era tratado como multiplicação. O teste de integração, a mensagem e o expected permaneceram intactos. A reprodução offline e a tabela de regressão exibiram sete falhas antes da correção, incluindo Cada/Por e pontuação distinta dentro de identificadores.

O guard agora mantém duas representações posicionais: o texto normalizado original para vínculo do produto e prova literal, e uma cópia do mesmo comprimento com somente os nomes completos comprovados mascarados. Números, operadores, fatores, agregadores, negação e delimitadores de cláusula são analisados fora desses trechos de identidade. Pontuação dentro do nome também é comparada literalmente: `X+2` não comprova `X-2`. Prefixos não comprovados, como Shampoo X dentro de Shampoo X Premium, não são protegidos. Fonte e literal originais permanecem intactos.

A tabela independente de nomes contém 143 casos, com 76 aceites corretos e 67 clarificações seguras, sem aceite inseguro ou falha funcional. Inclui nomes com X, Cada, Por, Total, Cinco, números, ponto e símbolos; operadores reais fora dos nomes continuam bloqueando fatores e limites. Os helpers de nome e provenance passaram 45/45 na revisão independente. A verificação PostgreSQL posterior pertence à coordenação e não é substituída por essas provas offline.

### Fronteira completa de identificadores

A revisão seguinte provou que um ponto interno ainda encerrava incorretamente o nome: Óleo 2 não pode comprovar Óleo 2.0, nem Shampoo X comprovar Shampoo X.Pro. A fronteira agora exige terminação real; pontuação seguida imediatamente por conteúdo de identificador permanece parte potencial da identidade. Aspas balanceadas são delimitadores explícitos do nome completo. Nomes completos com pontuação e aspas continuam aceitos; prefixos ou sufixos exteriores não comprovados permanecem pendentes.

A regressão permanente adicionada antes do reparo teve 11 falhas. A matriz independente congelada de 200 casos passou com 94 aceites corretos e 106 clarificações seguras; seu pipeline completo passou 368/368 no hash intermediário `e41513ce11a4b4ef2e3eea73ab517cd1c21fb169295d27f0f28bf0929c7990c9`. Essa evidência antecede a classificação dimensional abaixo e não é apresentada como revalidação do hash posterior.

### Dimensão de fatos numéricos de outras ações

Uma fonte completa contendo preço, estoque e duração reproduziu uma falha funcional: o guard tratava todos os números fora de identidades como contagens residuais de estoque. A nova suíte teve 15 falhas antes do reparo. A análise factual agora distingue valores com dimensão literal explícita: moeda R$/BRL ou real/reais/centavos; duração em minutos/min, horas ou segundos/seg; relógio H:mm/HH:mm válido; data completa YYYY-MM-DD ou DD/MM/YYYY com calendário válido. Essa classificação não usa o tipo de ação alegado pelo modelo. Ela não executa nem valida operacionalmente esses outros domínios.

Uma prova contendo apenas moeda ou duração não pode fornecer quantidade executável. Datas incompletas, razões como 5/2, relógios malformados, valores sem unidade e quantidades contraditórias continuam residuais. Medidas irmãs de estoque continuam dependendo de escopos literais atuais, completos, distintos e validados. Os helpers de correção/proveniência usam a mesma classificação: preço isolado não invalida uma quantidade aceita nem bloqueia a revalidação de identidade; número de estoque ou negação atual continuam impedindo recuperação indevida. Dois testes de helpers falharam antes desse alinhamento.

A revisão independente dimensional preservou oito falhas funcionais do candidato `f8b438c099dc659075b17b1b4a56e4ee0221929f6454a7e3dab8328c2cadd12e`: contagens de objetos ERP eram tratadas como estoque. A tabela factual finita agora inclui serviço, comanda, agendamento, cliente e profissional, com singular/plural. Não classifica um/uma como artigo; uma contagem desse objeto tem dimensão distinta. Um produto efetivamente chamado Serviço tem prioridade por identidade comprovada. Embalagens e outros substantivos desconhecidos continuam residuais.

A mesma revisão mostrou que o guard de fatores alcançava o preço de outra ação após o nome completo do produto. O trecho de operadores pós-medida agora termina no referente completo comprovado; fatores anexados à própria medida continuam bloqueados. Outra falha fazia a preposição de R$ ser confundida com nome de produto estrangeiro antes de um total explícito. O guard reaproveita os ranges literais de dimensões validadas para evitar essa divergência; não ignora identidades desconhecidas nem calcula o total.

As mensagens e oracles das matrizes independentes de 201 e 118 casos foram preservados. A suíte dimensional permanente final contém 61 testes, incluindo a fonte mista original, ações 1/2/5/10, escopos parciais, negação, razões, datas inválidas, objetos ERP, identidade precedendo tipo e unidades estrangeiras. O conjunto afetado passou 326/326 em sete arquivos no hash `cda8be8860db60a29fc5ffff3dceefe7a7b4ef6c88a99124c849b3c4f4b10070`, com lint afetado PASS. A revisão independente final repetiu as cinco matrizes originais (262 + 143 + 200 + 201 + 118): 924 casos, com 377 aceites corretos, 547 clarificações seguras e zero aceite inseguro ou falha funcional. Helpers 45/45, primeiros negativos de fronteira 8/8 e pipeline 687/687 passaram no mesmo hash, estável antes/depois. Os oracles e inputs foram preservados. A execução PostgreSQL posterior pertence à coordenação; esta subetapa não executou DB, API, holdout ou Production.
## Compatibilidade e limites

O contrato numérico interno de U03/T30 continua explícito em unidades de catálogo. Callers internos que já fornecem esse tipo não passam por interpretação de linguagem natural. O caminho conversacional marca `quantity_origin=CONVERSATION` e exige resolução validada. Metadata de resolução e origem não são aceitas nos schemas do modelo. Uma chamada conversacional sem transcript/prova suficiente não ganha essa compatibilidade interna.

O transporte novo exige valor e literal acoplados. O decoder legado permanece apenas na fronteira interna já existente; o output preservado de GF28 é reproduzido sem alterar seus argumentos e é bloqueado pelo guard. O texto literal é descartado da projeção executável e não volta por merge de patch de outro turno.

Expressões não demonstráveis pela gramática factual conservadora pedem produto ou quantidade conforme a pendência; palavras livres depois de um nome sem uma fronteira segura não são adivinhadas como parte ou fora da identidade. Isso pode exigir clarificação em formulações ainda fora da gramática. Não há conversões, catálogo de embalagens, novos aliases, inferência de valor ou mudança de regra de negócio. RLS, permissões, saldo negativo, limites numéricos, locks, revisões, expiração, idempotência e confirmação permanecem no domínio existente.

Na implementação inicial de Inventory e em suas regressões históricas, nenhum teste, mock, mensagem ou expected histórico foi alterado. Em uma etapa separada, a coordenação corrigiu placeholders de fonte sintética da bateria de execução para fornecer os fatos que a fixture já esperava; a origem arquivada, os hashes e as 121 asserções preservadas (242 chamadas AST: expect e matcher) constam de [SECRETARY_EXECUTION_SOURCE_FIDELITY.md](SECRETARY_EXECUTION_SOURCE_FIDELITY.md). Os arquivos novos de teste cobrem o contrato adicional. Durante a implementação, um exemplo novo de numeral 105 foi explicitado com o nome do produto, porque um pedido NEW não pode inventar identidade; controles de continuação sem nome testam o contexto backend separadamente. Golden e holdout não foram modificados.

## Evidência local

- 326/326 em sete suites afetadas no candidato dimensional, incluindo os contratos históricos intactos de Inventory e identidade aceita. Replay independente original 10/10; segunda revisão pipeline 7/7 (três falhas numéricas anteriores e quatro controles 1/2/5/10); matriz consolidada numérica 262/262 sem falhas na revisão anterior; nova matriz independente de identidade 143/143 e helpers 45/45.
- Regressões com FAIL antes e PASS depois para produto errado antes/depois da medida, clipping de fator com pontuação/agrupamento, total explícito e falha de proposal após draft persistido.
- Raw GF28 preservado: NEEDS_INPUT, quantity ausente em fields/draft/ActionPlan, zero proposal/confirmation.
- Fluxo de dois turnos com produto originalmente errado: nenhuma seleção inicial; correção de produto gera proposal somente para ID/nome corretos com as 5 unidades revalidadas. A variante com duas caixas continua pedindo unidades.
- Famílias positivas: contagem direta, numeral por extenso, nomes com números, total em unidades, produto antes/depois da quantidade, continuação e 1/2/5/10 medidas independentes.
- Famílias negativas: unidade desconhecida, literal inventado/recortado, número errado, fator, negação, decimais, produto errado, contexto expirado/incompatível e confirmação stale.
- Matriz numérica nova: sinais, espaços, decimal/fração, unidades coladas, numerais por extenso, números em identificadores, variantes e totais explícitos. Coordinator real offline: 1/2/5/10 ações do mesmo produto, IN/OUT independentes, PATCH preservando chave/grafo e descartando witnesses de outro turno.
- O mock histórico de identidade omite o DTO product do draft. O runtime agora recusa esse contexto incompleto antes de acessar sua identidade; o teste/expected não foi alterado e o erro de alvo continua TARGET_ALREADY_SELECTED.
- TypeScript da etapa final é responsabilidade da execução principal. O diagnóstico TS7023 local da função cardinal foi corrigido com retorno explícito number; não se afirma um novo PASS global nesta subetapa. ESLint dos arquivos afetados PASS.

Estes testes são offline, com provider e persistência locais simulados. A execução principal precisa repetir regressão integrada, PostgreSQL autorizado, Golden real e holdout independente antes de qualquer entrega manual. Não houve chamada paga, acesso a banco operacional, holdout ou Production nesta subetapa.
