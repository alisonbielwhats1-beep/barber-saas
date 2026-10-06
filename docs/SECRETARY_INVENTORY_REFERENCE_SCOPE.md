# Inventory: referência, medida e contexto do turno

Esta etapa sucede o candidato dimensional documentado em `SECRETARY_INVENTORY_QUANTITY_GROUNDING.md`. É validação local, sem API paga, banco operacional, holdout ou Production. A coordenação continua responsável pelos gates integrados e pela próxima Golden real.

## Causa e contrato

O guard anterior tentava decidir o fim de um nome examinando toda a prosa depois dele. Isso confundia uma finalidade ou ação irmã com variante do produto. Na continuação, também tratava palavras após uma medida explícita como nova identidade, apesar do campo quantity já estar vinculado pelo backend. Falha de medida podia apagar produto e draft aceitos.

Luna atribui os papéis semânticos. O backend verifica spans literais atuais, fronteiras gramaticais, medidas completas, catálogo real e contexto persistido. `source_scope` é metadata transitória da operação atual. `inventory.reference` admite somente NAMED com literal ou CURRENT_FIELD com literal null; este último descreve uma relação já existente, não cria autoridade. A forma publicada LIVE é estrita e exige as chaves neutras null; a compatibilidade RECORDED histórica continua separada.

Scopes precisam ser trechos contíguos atuais, com início em pontuação ou conectivo fechado. Não podem cortar a própria referência ou medida. Ações irmãs podem compartilhar uma oração fora da prova da ação atual. Um literal de produto repetido é localizado dentro do scope único da própria ação. Sem esse escopo, uma repetição textual não ganha offsets inventados. Chaves/operações vêm da seleção atual validada; witnesses nunca vêm de histórico ou de outra sessão.

Reason literal pode delimitar complemento com conectivo explícito. Qualificador adjacente, como Premium, não vira finalidade só por receber o rótulo reason. Variantes catalogadas mais específicas prevalecem mesmo quando contêm conectivos. O catálogo factual usa leitura tenant-scoped, permissão existente e projeção id/name, em páginas de 200; não existe limite de 200 produtos nem truncamento silencioso. Falha/timeout da transação impede preparação.

Toda a mensagem continua entrando na verificação numérica. Spans semânticos não escondem sinal, fator, negação, embalagem, unidade incompatível, número residual ou variante. A ambiguidade de `por` foi corrigida por dimensão factual: um reason causal íntegro é aceito, mas denominador de unidade, objeto ERP, embalagem, medida física ou numeral permanece razão quantitativa, mesmo rotulado como motivo. O léxico é de dimensões, não de motivos ou verbos.

## Estado efetivo e correções

Uma resposta quantity fica vinculada por draft/revisão, ID/revisão do produto, unidade, expiração e pergunta publicada. O backend revalida a revisão factual do produto. CURRENT_FIELD explícito é opcional: o PATCH já aponta o campo e a ação. Prosa residual neutra não exige dicionário de sinônimos de total. Outra identidade factual, mudança explícita do seletor ou medida contraditória continuam impedindo execução.

Falha de medida remove quantidade efetiva, draft quantity e proposta, mas conserva identidade aceita quando não houve contradição. Correção explícita de produto em pedido ainda não executado invalida o journal anterior antes de liberar o vínculo. Nome novo inexistente ou ambíguo nunca deixa a próxima resposta numérica voltar ao produto antigo. A confirmação antiga fica stale. Se houver falha depois de persistir a invalidação, o estado acompanha o commit e permanece recuperável.

`source_scope`, reference e prova literal de quantidade não são persistidos como campos executáveis, nem herdados por merge no próximo turno. O executor numérico de domínio, RLS, permissões, tenant, revisão, saldo, confirmação e idempotência não foram relaxados.

## Replay e evidências

Os quatro raw arguments de Golden v10 foram preservados byte a byte em `src/test/fixtures/secretary-real-wire-golden10-inventory.json`, incluindo hashes dos arquivos originais. GF27 original agora prepara saída de 3 com o reason literal já fornecido. GF28 original mantém o draft/produto entre caixas pendentes e resposta de 12 unidades, sem adaptar o JSON histórico.

GF29 original não possui o novo scope de cada ação. O replay conserva count, expressão e fonte como pendência não executável e não inventa prova. Um teste separado do novo contrato usa scopes atuais exatos e aceita as 4 unidades na mesma mensagem original. Isso não é apresentado como PASS do raw histórico nem substitui nova validação com Luna real.

Os testes permanentes novos cobrem referência completa/variante, catálogo maior que 200, nomes encaixados em outro nome, causais e denominadores, scopes inválidos/duplicados, papel pendente expirado, revisão de produto, correção para produto inexistente, confirmação stale, prosa livre, nomes e quantidades repetidos em 1/2/5/10 ações e LIVE NEW/PATCH/RESUME. As regressões antigas de estoque continuam com mensagens e expected intactos.

Migrações explícitas de fixtures sintéticas LIVE foram arquivadas em `.demo/inventory-scope-live-fixture-originals/manifest.json`: `source_scope:null` nos dois testes de budget; literal `Da tarde` reproduzindo a fonte atual `Da tarde.` no teste de contexto residual; e source_scope na lista de opcionais do schema interno auditado. Os tetos, contexto, asserções e obrigatoriedade do protocolo LIVE permanecem. O negativo de literal com case divergente pertence à regressão do reparo de transporte. Golden e holdout não foram modificados.

Dois ajustes de testes novos tiveram causa registrada: o scope GF29 digitado como `e dá` não era substring da fonte `, dá`, e o fixture RESUME usava indevidamente shape NEW com dependências. Foram corrigidas somente as montagens novas de prova, mantendo os resultados pretendidos. A hipótese inicial de rejeitar toda prosa depois de unidades foi abandonada em favor do vínculo tipado do backend; o teste de preservação passou a usar prova literalmente inválida. O positivo causal `por solicitação da equipe` foi preservado e passou após a correção factual, sem troca de oracle.

## Limite semântico

O backend não prova uma interpretação universal do português. Finalidade versus parte de nome sem contradição factual continua sendo responsabilidade semântica de Luna. A garantia demonstrada é: presença literal, papel atual, fronteira gramatical, precedência de variantes reais, medida compatível e estado backend vigente. Não há conversão de embalagens nem novo cadastro de unidades. A próxima Golden real e o holdout independente continuam necessários antes de declarar prontidão.

## Primeiro congelamento local, supersedido pela revisão independente

O conjunto afetado fechou **493/493 em 11 suítes**, incluindo regressões anteriores intactas, em `.demo/inventory-scope-frozen-focused.log`. ESLint dos arquivos afetados passou em `.demo/inventory-scope-lint-final.log`. O diagnóstico TypeScript global em `.demo/inventory-scope-tsc-post-sdk.log` não encontrou erros nos arquivos de Inventory; apontou somente o teste novo do reparo de transporte que o worker SDK ainda ajustava. Isso não é um PASS global de TypeScript.

O worker SDK compactou seu manual após a medição de 64.601 ultrapassar o teto de 64.000. A repetição de capability-wire, residual-wire-budget e Scheduling passou **73/73**, registrada em `.demo/source-literal-repair-cap.log`. O teto não foi aumentado. O teste residual usa o literal sintético com o mesmo case da fonte atual; o original está arquivado.

Manifest de Inventory: `.demo/inventory-reference-scope-freeze.json`, status `FROZEN_FOR_INDEPENDENT_REVIEW`. Hash SHA-256 do guard principal: `9ffb031f43af9533a93f29b0e1f3530b2446c82d9646dc9918548a2a3e4ad266`; helper de escopo: `05229bd272cdaf584e7eab094a7e09bd8c477e758a77289d3929fbfbe93f6bd0`; adapter: `edd2aab7da05bb3a36911e652ae4f642804eef6ebfc33a1c5825be649333c0dd`. A coordenação mantém ownership do reparo de ciclo de vida no coordinator e fará os gates globais. Nenhum processo desta subetapa ficou em execução.

## Revisão independente: identidade explícita e prova dentro do próprio scope

A revisão encontrou duas falhas factuais nesse primeiro congelamento. CURRENT_FIELD reutilizava o produto aceito mesmo quando a resposta trazia seu nome com continuação lexical incompleta. E o scope próprio precisava conter somente o átomo numérico, permitindo cortar sua unidade ou referência. A matriz independente registrou 12 falhas em 63 casos; o adapter confirmou duas propostas indevidas em três testes. Os arquivos e oracles anteriores permanecem preservados.

A correção não exige reconhecer toda a prosa da resposta. Quando o produto está explicitamente mencionado, um prefixo de nome sem fronteira completa é somente evidência de contradição, nunca uma referência resolvida. Essa contradição impede reutilizar o target antigo, inclusive sem tag CURRENT_FIELD. Quando não há nome explícito, a vinculação válida ao campo pendente continua aceitando prosa livre. Nomes que também são cardinais preservam seus papéis: `cinco unidades` é uma medida para o produto chamado Cinco; `de Cinco Premium` é uma referência incompleta e permanece bloqueada.

O scope próprio deve conter o literal completo e a medida efetivamente usada, incluindo a referência anexada ou retrospectiva quando ela fundamenta a vinculação. Uma prova atribuída à ação irmã não pode ser consumida pela ação atual, inclusive quando esta omite source_scope. O mesmo contrato vale para resposta numérica nua. A inspeção numérica da mensagem inteira continua ativa; esse containment não remove negações, fatores, operadores ou números residuais.

Antes do reparo, os testes permanentes novos registraram 14 FAIL em 83 testes em `.demo/inventory-scope-boundary-before.log`. O subeixo de nomes cardinais registrou três FAIL adicionais em `.demo/inventory-current-numeric-name-before.log`; os mesmos oracles passaram após preservar o papel count+unit. Os bytes anteriores dos arquivos afetados estão em `.demo/inventory-scope-boundary-before/manifest.json`.

O helper factual de catálogo foi movido para `src/lib/inventory-reference-catalog.ts`. Ele importa a permissão existente e preserva tenant, projeção id/name e páginas de 200. `inventory-catalog.ts` foi restaurado byte a byte ao SHA-256 `2901aacfd741cf650d829e39302da4c1d2e29e9c0604c13ea52b053691e3192f`. Os pins fechados de JEV não foram atualizados nem relaxados. Nos testes novos, somente o import/mock do helper migrou para seu novo módulo; mensagens e expected históricos ficaram intactos.

O conjunto final afetado passou **472/472 em 11 suítes**, incluindo o contrato JEV restaurado, em `.demo/inventory-scope-boundary-regressions-final.log`. Essa seleção difere das 11 suítes do primeiro congelamento: inclui os testes de JEV e identidade aceita, além das regressões de Inventory. ESLint final passou em `.demo/inventory-scope-boundary-lint-final.log`; TypeScript global passou em `.demo/inventory-scope-boundary-tsc-final.log`. O manifest desta revisão é `.demo/inventory-scope-boundary-freeze.json`; guard final SHA-256 `5d968949b9e1297b61f23affd679a31bc0fa74c79f8e1fa6781f425ba45098d6`. Isso continua sendo um congelamento local para gates integrados, não prontidão de staging.

A revisão independente final repetiu os oracles no mesmo hash: **63/63** no guard, **3/3** no adapter e **9/9** nos controles de nomes cardinais. Evidências: `.demo/inventory-independent-scope-review-v3.json`, `.demo/inventory-independent-current-field-identity-v3.json` e `.demo/inventory-independent-numeric-name-role-v1.json`. Os originais que demonstraram os bugs foram preservados; a única migração de montagem foi o mock do helper para o novo módulo. Nenhum processo desta etapa ficou ativo.

## Golden v11: hint contextual e posição do conectivo

A Golden real v11 encerrou com GF28 e GF29 falhos no candidato anterior. GF28 publicou CURRENT_FIELD em uma ação NEW apesar de trazer o nome explícito. O guard comparava o produto catalogado com um ID de contexto inexistente, criando uma contradição factual falsa e descartando o nome válido. GF29 trouxe o scope da leitura começando depois de `e`; o guard exigia que o conectivo fizesse parte do quote. O primeiro call de GF29 realmente continha um trecho inexistente e foi reparado pelo SDK; o segundo call já era literal e ainda assim foi recusado pelo guard.

Os três raw calls foram preservados sem adaptação em `src/test/fixtures/secretary-real-wire-golden11-inventory.json`, com hashes dos arquivos de origem e dos arguments. GF28 usa attempt 40; GF29 preserva attempts 41 e 42. A mensagem e o expected da Golden não foram alterados. O replay novo demonstrou **9 FAIL em 97 testes** antes da correção, registrado em `.demo/inventory-golden11-replay-before.log`, e **97/97 PASS** depois em `.demo/inventory-golden11-replay-after.log`.

Conflito com a referência corrente agora exige o ID realmente vinculado pelo backend. Um hint CURRENT_FIELD incorreto não cria vínculo nem descarta uma prova nominal independente completa da própria ação. Sem essa prova, continua impossível usar o hint como autoridade. Prefixos incompletos, outro produto, revisão factual, fatores, negação e unidade incompatível continuam bloqueados. Em GF28, as caixas continuam não executáveis; o produto é preservado para a pergunta correta de unidades.

A fronteira de uma ação pode citar o conectivo ou começar imediatamente depois dele, desde que esse conectivo esteja literalmente presente na mensagem. O separador gramatical integra a delimitação da identidade, não altera a fonte e não retira fatos da verificação numérica. O scope continua sujeito a unicidade, limites, prova completa, conflito com variantes catalogadas e separação da prova própria. Não existe reconhecimento de verbos, intenções ou frases da Golden nesse reparo.

GF28 turn 2 não foi enviado na Golden v11 porque a pergunta correta não apareceu. O teste de continuação de 12 unidades é declarado como controle offline sintético, não como execução real daquele turno. GF29 attempt 41 continua rejeitado por source_scope não literal; o attempt 42 original prepara quatro unidades usando os scopes originais de serviço e leitura. Não houve adaptação de raw para obter PASS.

Regressões locais desta correção: **488/488 em 11 suítes**, em `.demo/inventory-golden11-regressions.log`; ESLint PASS em `.demo/inventory-golden11-lint.log` e TypeScript global PASS em `.demo/inventory-golden11-tsc.log`. Somente `inventory-quantity.ts`, `inventory-source-scope.ts`, testes novos e documentação mudaram. SDK, coordinator, executor, pins JEV e dados operacionais permaneceram intactos. O candidato anterior e sua build ficam supersedidos; validação real e gates integrados continuam obrigatórios antes da entrega.

## Proteção da identidade original contra recorte semântico

A revisão do candidato b525/d5bc demonstrou oito aceitações indevidas quando a expansão da fronteira de uma ação irmã consumia o último token de um nome factual. A mensagem original ainda continha a referência incompleta, mas o texto após masking já não a continha; o vínculo contextual aceitava a quantidade sem confrontar essa contradição. O caso existia com CURRENT_FIELD ou sem tag e com ou sem source_scope próprio. A Golden 12 foi retirada durante PREPARE, sem chamada de API; esses resultados não são uma nova Golden.

O reparo protege os spans de referência reconhecidos na fonte original antes de qualquer exclusão semântica. Uma exclusão pode conter uma referência inteira de outra ação ou ficar fora dela. Se cortar parcialmente a referência, o backend registra CONFLICT e impede que o contexto antigo forneça autoridade à quantidade. A propriedade independe de NAMED e do conteúdo particular do nome. Um segundo conectivo externo à referência continua delimitando uma ação irmã, preservando GF29.

Os oito oracles independentes foram reexecutados sem alteração: **0/8 antes e 8/8 depois**, em `.demo/inventory-connector-protection-before.json` e `.demo/inventory-connector-protection-after.json`. O conjunto permanente mostrou **8 FAIL em 99 testes** antes, em `.demo/inventory-protected-reference-before.log`; guard e adapter passaram **112/112** depois, em `.demo/inventory-protected-reference-after.log`. Os novos testes incluem controles positivos com separador externo ao nome. O snapshot anterior está em `.demo/inventory-protected-reference-before/manifest.json`.

Somente o guard de quantidade mudou neste reparo. Helper de escopo, adapter, SDK, coordinator, regras de domínio e arquivos da Golden permaneceram intactos. O guard agora tem SHA-256 `22ad426236b3c409e715e62b92be2bb3690e403b55c48a2f6dff2971db50bdc6`; o helper de escopo permanece `d5bcfe94236b1816368cffb9fde7eeda506d9e18163dff1de6ec4cb93e841909`. O manifest anterior b525 é supersedido, sem alegação de prontidão até os gates integrados e nova medição real.

As regressões afetadas deste candidato passaram **496/496 em 11 suítes**, com dois workers, em `.demo/inventory-protected-reference-regressions.log`. ESLint e TypeScript global passaram em `.demo/inventory-protected-reference-lint.log` e `.demo/inventory-protected-reference-tsc.log`. A revisão independente do guard repetiu **118/118** (63 + 9 + 38 + 8) com seus scripts e oracles preservados. A conclusão da revisão dos adapters e de contenção integral da referência ainda integra o gate de congelamento.

O controle de contenção integral encontrou mais oito falhas da mesma propriedade no candidato 22ad: uma referência inteira ligada à medida podia ser engolida pela expansão derivada, confundida com uma referência inteira legítima dentro da literal da irmã. A matriz independente de 16 casos preservou oito positivos com segundo conectivo externo e demonstrou oito negativos falhos. O teste permanente também registrou **8 FAIL em 107**, em `.demo/inventory-whole-reference-before.log`.

A correção final separa `boundaryExtensions`, adicionadas pelo backend, do conteúdo literal original de cada irmã. A expansão não pode consumir referência ligada à medida original, nem parcialmente nem por inteiro. O vínculo factual usa count, unidade, conector nominal ou a própria prova literal contendo a referência. Um token homônimo usado apenas como conectivo externo não vira identidade. Referências inteiras realmente contidas na literal da irmã continuam possíveis. A fonte original, os valores e os scopes publicados permanecem intactos.

Guard e adapter passaram **120/120** em `.demo/inventory-whole-reference-after.log`, incluindo os raws GF28/GF29, os controles de segundo conectivo externo e oito respostas em unidades com outra ação sem repetir o nome do produto. Essa última família evita transformar a proteção em nova pergunta desnecessária por colisão lexical. Não houve alteração dos oracles independentes ou do expected da Golden.

Hashes deste reparo: guard `76679429ff1dba7b0d5f83c90bd94135eb8b1dfecab6a956e07ff5664771e519`; scope `7bdc2f83f5790e5a5aa49b7c111018efd55bdd4230aa273c437c07cb53903d95`. O catálogo pinado continua `2901aacfd741cf650d829e39302da4c1d2e29e9c0604c13ea52b053691e3192f`, e o fixture raw v11 continua `e937faef21d950675a4f7c8408ec4a6ead55851d5ed7bc316a6b400469be270b`. Os candidatos b525 e 22ad são supersedidos. Nova Golden e gates integrados ainda são necessários.

Os checks finais do candidato 7667/7bdc passaram em sequência: **504/504 em 11 suítes** (`.demo/inventory-whole-reference-regressions.log`), ESLint (`.demo/inventory-whole-reference-lint.log`) e TypeScript global (`.demo/inventory-whole-reference-tsc.log`). Nenhum processo deste worker ficou ativo. O manifest `.demo/inventory-reference-protection-freeze.json` registra a revisão independente final separadamente, sem reaproveitar o PASS do candidato intermediário.

A revisão independente final v6 concluiu **152/152 PASS** no mesmo par de hashes: matrizes 16/8/38/63/9, oito controles de reply sem nome e dez testes de adapter. Nenhum blocker local conhecido permaneceu nas classes revisadas. Parecer: `.demo/inventory-independent-v11-review-v6.md` e JSON correspondente. O manifest final é `.demo/inventory-reference-protection-freeze.json`, estado `FROZEN_FOR_INTEGRATED_VALIDATION`. A última Golden real continua sendo v11, **28/30**, e não foi reclassificada pelo replay offline.
