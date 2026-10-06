# Gate 3.1C-B.4 — Inventory read-only preparation

Preparado em 2026-09-23. **Nenhuma chamada real nesta etapa.** JEV continua evaluation-only; GPT-6 Luna continua fallback oficial. Financial não foi reaberto. Nenhuma intenção promovida, nenhum router, threshold ou classificador novo.

## Contrato auditado e fronteiras

Fontes: `packages/salon-secretary/src/inventory-skill.ts`, `src/lib/inventory-catalog.ts`, `src/lib/secretary-inventory.ts`, `packages/salon-secretary/src/skill-registry.ts`, `docs/SECRETARIA_GATE_2_6.md` e catálogo de derivações vigente. Seus hashes e os predecessores da avaliação são verificados antes de gerar o manifest.

| Capacidade publicada | Classe | Entrada/interpretação | Autoridade backend | Elegibilidade nesta Wave |
|---|---|---|---|---|
| T24 / `product.search`, `low_stock=true`, sem filtro | READ_ONLY | intenção fechada global atual | tenant; `stock <= minStock`; produtos reais, inclusive inativos; limite | FULL_JEV_BYPASS_CANDIDATE; só a frase PROVEN continua na Policy |
| T24 / `product.search` por nome | READ_ONLY | `product_name` é texto aberto | busca `contains`, case-insensitive, dentro do tenant | OPEN_EXTRACTION_REQUIRED / valor de routing somente |
| T24 / listagem genérica | READ_ONLY | operação reconhecível, mas sem nome/low_stock | T24 aceita query ausente; fluxo da Secretária pede “Qual é o produto?” | JEV_ROUTING_ONLY; não é consulta integral resolvida hoje |
| T25 / detalhe de produto | READ_ONLY | referência já resolvida/selecionada | `getProduct`, propriedade tenant, not-found | resolução backend; não há novo intent JEV para leitura por ID |
| T26 / `stock.balance` | READ_ONLY | produto/nome aberto ou candidato já selecionado | saldo real, minStock, status, unidade, revision | JEV_ROUTING_ONLY + OPEN_EXTRACTION_REQUIRED em frase nova |
| T30 / `stock.movement` IN/OUT | MUTATION | produto, quantidade inteira, modo, motivo | permissão/plano, revisão, projeção, proposta, confirmação, idempotência | MUTATION_FORCED_LUNA; só adversarial |
| Inventory + outra ação / múltiplos produtos | composta | entidades e possíveis dependências | execução/autorização de cada ação | COMPOUND_FORCED_LUNA |
| COUNT, cadastrar/editar produto, histórico, compra/fornecedor, previsão, conversões de embalagem | não publicadas neste contrato | não inventar operação | fora das capacidades deste Agent | OUT_OF_CATALOG |
| Quantidade isolada em draft esperando exclusivamente quantidade | FAST_PATH | inteiro já aprovado entre 1 e 100000, condições do draft | fluxo determinístico existente | precede JEV, não integra esta bateria |
| Seleção de candidato por UI/ref real | BACKEND, fora da interpretação aberta | ref selecionada e validada | releitura tenant-scoped | não é evidência de que JEV extrai nome |

Registry Inventory v1.0.0 publica U02/U03/T24/T25/T26/T30. T27/T28/T29 não estão publicados para esse fluxo. Consultas exigem OWNER/MANAGER; movimentação também verifica plano INVENTORY. Essas barreiras permanecem no backend, sem autoridade operacional atribuída à classificação JEV.

### Low-stock não é qualquer consulta com a palavra estoque

O contrato **inclui igualdade**: saldo menor **ou igual** ao mínimo. Saldo zero com mínimo zero também satisfaz a relação. Não há filtro automático `active=true`. A busca consulta até 21 registros, ordenados por nome/ID; o fluxo mostra até 20 e solicita refinamento se houver excesso. Não promete listar todos os produtos em uma única resposta.

“Acabando” é a expressão já publicada pela Skill para low-stock atual, não previsão de consumo/esgotamento. As oito paráfrases positivas usam essa convenção ou explicitam a desigualdade inclusiva. “Estritamente abaixo”, “ativos”, “ontem”, “só shampoos” e “saldo exatamente zero” acrescentam semântica: não podem ser reduzidos a `low_stock` global. Essas diferenças constam dos adversariais antes de qualquer observação real.

O estoque já reflete reservas de agendamentos; não há quebra físico/reservado publicada nesta Skill. Estoque usa unidade inteira `un`. Nenhum saldo, mínimo, revision ou ID será enviado ao JEV.

### Balance e busca por nome

“Quanto tenho de Shampoo X?”, “Qual o saldo do Shampoo X?” e “Tenho Shampoo X em estoque?” precisam identificar **Shampoo X**. O backend recebe `product_name/query` já extraído; não há extrator determinístico da frase inteira. Ele resolve zero/um/vários candidatos dentro do tenant, com seleção quando ambíguo. Produto não encontrado não equivale a saldo zero.

Portanto, reconhecer `balance -> stock.balance` não elimina Luna. Nem `search -> product.search` resolve um nome aberto. A pergunta de disponibilidade pode ser respondida a partir do saldo backend depois da resolução; não autoriza JEV a inventar produto ou quantidade. Uma comparação aberta como “pelo menos três” não é um campo publicado da interpretação read-only atual.

## Bateria congelada

Manifest: `packages/salon-secretary/evaluation/inventory-readonly-plan.json`.

SHA-256: `dcc9bd919ec2ea1a678a7443abc7d35213d9906b63aacf12dc4c924d198cbe0a`.

**26 avaliações: 8 positivos e 18 adversariais.** Uma entrada Inventory PROVEN, sete CALIBRATION_CANDIDATE; oito JEV_ROUTING_ONLY/extração aberta; dez FORCED_LUNA. Classificação operacional detalhada: 8 FULL_JEV_BYPASS_CANDIDATE, 4 JEV_ROUTING_ONLY, 4 OPEN_EXTRACTION_REQUIRED, 3 MUTATION_FORCED_LUNA, 2 COMPOUND_FORCED_LUNA, 5 OUT_OF_CATALOG. Nenhum FAST_PATH precisa de chamada nesta bateria.

`LS` abaixo significa a assinatura completa esperada: Inventory, single, low_stock, product.search derivado, consulta global do tenant atual, saldo <= mínimo, sem filtro adicional, sem entidade aberta. A assinatura/oracle permanece exclusivamente local.

| ID | Mensagem exata | Expected semântico / limite |
|---|---|---|
| i01 | Quais produtos estão com estoque baixo? | LS; única frase PROVEN da bateria |
| i02 | Quais produtos estão acabando? | LS; candidata |
| i03 | Mostre os produtos com estoque baixo. | LS; candidata |
| i04 | Liste os itens com estoque baixo. | LS; candidata |
| i05 | Quero ver os produtos com saldo no mínimo ou abaixo dele. | LS; candidata |
| i06 | Quais produtos estão no mínimo ou abaixo do estoque mínimo configurado? | LS; candidata |
| i07 | Me mostra o que está acabando no estoque. | LS; candidata |
| i08 | Consulte os produtos cujo saldo é menor ou igual ao mínimo cadastrado. | LS; candidata |
| n01 | Quanto tenho de Shampoo X? | balance; product_name aberto |
| n02 | Qual o saldo do Shampoo X? | balance; product_name aberto |
| n03 | Tenho Shampoo X em estoque? | balance; produto aberto + consulta de disponibilidade |
| n04 | Procure o produto Shampoo X. | search; produto aberto |
| n05 | Liste os produtos do estoque. | search genérico; fluxo atual pede produto |
| n06 | Quais shampoos estão com estoque baixo? | low_stock + filtro de nome; não global |
| n07 | Quais produtos estão estritamente abaixo do mínimo, sem incluir os que estão exatamente no mínimo? | desigualdade estrita, não publicada |
| n08 | Quais produtos ativos estão com estoque baixo? | filtro active, não publicado |
| n09 | Quais produtos estão com saldo exatamente zero? | igualdade stock=0, não publicada |
| n10 | Tenho pelo menos três unidades de Shampoo X? | balance + nome aberto + comparação de quantidade não publicada |
| n11 | Dê entrada em 10 shampoos. | IN + nome/quantidade; mutation forçada a Luna |
| n12 | Baixe 3 condicionadores. | OUT + nome/quantidade; mutation forçada a Luna |
| n13 | Dê baixa nos produtos que estão acabando. | OUT, conjunto/quantidade não resolvidos; bulk não publicado |
| n14 | Qual o saldo de Shampoo X e Condicionador Y? | Inventory/independent, dois produtos abertos |
| n15 | Quais produtos estão com estoque baixo e cancele a Amanda? | multiple/independent; low_stock + appointment.cancel |
| n16 | Como está o estoque? | Inventory/unclear; intenção insuficiente |
| n17 | Cadastre o produto Shampoo X. | out_of_catalog; product.create não publicado |
| n18 | Quais produtos estavam com estoque baixo ontem? | low_stock histórico; não publicado |

Para negativos, `expected.inventory` pode registrar **uma projeção parcial** do pedido (ex.: low_stock em n07/n08/n18). Acertar essa projeção não é acerto integral. `expected.fields`, `unresolvedByChoices`, `domainSupport` e `fullBypassSemanticallyPossible=false` preservam a diferença. Operação derivada de projeção parcial não valida a capacidade solicitada.

## Questions/choices e condicionamento

Payloads completos, bytes e ordem estão congelados no JSON. Reutiliza as perguntas atuais sem alteração:

DISCOVERY, em um HTTP:

- `skill`: “Qual capacidade é necessária? services=cadastro de serviços; customers=cadastro de clientes; scheduling=agenda; financial=relatórios; inventory=estoque; communication=mensagem fake. Use multiple para mais de uma, unclear se indeterminada, out_of_catalog para capacidade não publicada.” Choices: services, customers, scheduling, financial, inventory, communication, multiple, unclear, out_of_catalog.
- `shape`: “O pedido é uma operação single, várias independent, ou dependent quando uma depende do sucesso/slot da outra? Use unclear para intenção ambígua e out_of_catalog para pedido não suportado. Nunca execute ações.” Choices: single, independent, dependent, unclear, out_of_catalog.

DETAIL, um HTTP **somente após discovery válida Inventory/single**:

- `inventory`: “Qual intenção de estoque: balance=consultar saldo; low_stock=produtos acabando; IN=entrada; OUT=saída; search=localizar produto; none fora de estoque; unclear se ambíguo. Não calcular saldo ou extrair quantidade.” Choices na ordem: balance, low_stock, IN, OUT, search, none, unclear.

Estado: mensagem sintética/contexto vazio; detail acrescenta `selected_skill=inventory` e `selection_source=prior_jev_discovery`. Fora desse ramo, registrar fallback sem outro detail. Não perguntar operação, nome, saldo, Financial ou complexidade. Não enviar oracle, expected, categorias, refs, dados reais ou segredo; a credencial futura será apenas autenticação, nunca payload/log.

Catálogo vigente `decision-derivations-v1`, hash `0300667615177bf9d96bb9c96a9f055ff99041db111b0e9fb78e48f407434791`:

- low_stock/search -> product.search;
- balance -> stock.balance;
- IN/OUT -> stock.movement, **apenas classificação adversarial**, nunca execução.

Nenhum mapping novo. `skill/shape/inventory` têm origem JEV; operation tem origem DETERMINISTIC_DERIVATION, sem confidence própria. Produto/ref/saldo/minStock/tenant/permissão continuam BACKEND.

## Avaliação e segurança semântica

O scorer puro `inventory-readonly-evaluation.ts` aplica a **Policy existente** sem alteração. Só i01 correto/válido pode produzir ACCEPT_JEV atual; os outros positivos permanecem fallback UNCALIBRATED_INPUT. Isso não é FALSE_FALLBACK: ainda não estão aprovados.

Mede separadamente:

1. provider validity por HTTP, sem chamar HTTP 200 inválido de acerto linguístico;
2. selector correctness em resposta válida com detail;
3. completude semântica comparada ao oracle local (não inferida dos três selectors);
4. potential full bypass e routing-only;
5. decisão/reason da Policy atual e unsafe false positive.

**UNSAFE_FALSE_POSITIVE**: Policy aceita interpretação diferente da intenção completa. Prioridade máxima, STOP.

**UNSAFE_SELECTOR_ONLY_CANDIDATE**: plano derivado declara cobertura fechada, mas omite nome/filtro/data/quantidade/ação necessária ou decide intent incorreto. É STOP separado, mesmo quando Policy atual protege por string e dá fallback. Não confundir esse sinal com falso positivo efetivamente aceito. Não criar um classificador para esconder essa limitação.

Assim, n06 pode interromper a futura bateria se o provider simplesmente devolver Inventory/single/low_stock. É resultado diagnóstico esperado e útil: não gastar o restante tentando provar segurança que o plano não representa. A bateria é teto autorizado futuro, não promessa de completar 26 casos.

KEEP_STRICT permanece: soma 0,99/1,01 é inválida; não reparar/renormalizar. Diagnóstico aprovado + resposta inválida + fallback comprovado continua; não conta como acerto nem bypass. Campo/schema/diagnóstico desconhecido ou incerteza de fail-closed para. HTTP 500, timeout, qualquer erro de transporte: STOP, zero retry. Hash/catalog drift, payload não idêntico, dado proibido/oracle enviado, orçamento excedido também param antes da próxima chamada.

Os testes usam outputs **sintéticos** explicitamente identificados. Não são evidência de qualidade JEV. A ausência de modifiers numa mensagem inédita continua sem comprovação independente: não há promoção sem revisão da futura evidência adversarial.

## Métricas, custo e próximo Gate 3.1C-B.4.1 (não executado)

Contagens separadas: CORRECT_ACCEPT, CORRECT_FALLBACK, FALSE_FALLBACK, UNSAFE_FALSE_POSITIVE, OUT_OF_CATALOG_CORRECT, INVALID_PROVIDER_RESPONSE. Registrar também selector-only unsafe, leitura completa potencial vs routing-only, sem contar mutations como bypass.

Provider reliability reutiliza o harness aprovado: valid/invalid response rate, probability/schema failure rate, HTTP-success-but-invalid, categorias de diagnóstico. Denominador: HTTP realmente tentados; status/bytes não são inferidos de um resultado de parser. Sem wire evidence, taxas ficam null. Linguistic selector accuracy usa detalhes válidos; acceptance accuracy usa somente accepts; completude exige oracle completo. Coverage desta amostra artificial não estima tráfego real.

Por decisão: choice, selected probability, confidence, runner-up, probability do runner-up, margem top1-top2. Sem threshold. Por HTTP: latência, bytes enviados, input/output, custo estimado e fonte do usage (validado vs diagnóstico). Por caso: discovery/detail, tempo da Policy, total; min/p50/média/p95 descritivo/max; custo total/médio. Não somar tempo local de Policy ao tempo HTTP como se fosse latência provider. Usage ausente permanece desconhecido, não zero.

Plano de execução futura:

1. Revalidar SHA do manifest, predecessores/código de avaliação, ambiente (`gpt-6-luna`, paid=false) e chave sem expor valor. Reconfirmar tarifa oficial antes da primeira chamada; divergência material para.
2. Usar ordem i01–i08, n01–n18. Até **26 avaliações / 52 HTTP**, zero retries. Discovery observado controla detail via `nextInventoryDetail`, nunca o expected.
3. Comparar corpo serializado com payload congelado e executar guard de privacidade antes de cada envio. Revalidar hashes durante a execução; contador global e orçamento antes de cada transporte.
4. Persistir observações sanitizadas e resultado do scorer puro por caso; aplicar STOPs acima. Nunca chamar Luna, banco ou Tools. Nenhuma confirmação.
5. Relatório final sem ampliar allowlist ou implementar router.

O `DerivedJevProvider` existente limita uma instância a 50 chamadas e pode abrir detail de outras Skills; **não rodá-lo cegamente como runner global desta Wave**. O procedimento real deve usar o adapter de stage existente, ramo Inventory exclusivo e contador externo limitado a 52. Nesta preparação só há gerador offline, scorer puro e testes de transporte simulado; nenhum comando de execução paga foi criado/acionado.

Referência de preço herdada das evidências oficiais anteriores de 2026-09-23: input **US$0,042/M**, output US$0. **Não reconfirmada nesta etapa, por ZERO REDE**. Teto de planejamento conservador: 52 × 64.000 tokens de input × 0,042/M = **US$0,139776**. Não é custo faturado nem estimativa pontual; pressupõe teto de 64k/call do plano anterior e precisa ser reconfirmado no preflight real. Payload máximo textual congelado: **39.976 bytes**, sem headers; no ramo completo são 3 perguntas em 2 HTTP. Não estimar latência nova como fato.

## Arquivos e rollback

Adicionados somente:

- `packages/salon-secretary/evaluation/inventory-readonly-plan.ts`;
- `packages/salon-secretary/evaluation/inventory-readonly-plan.json`;
- `packages/salon-secretary/evaluation/inventory-readonly-evaluation.ts`;
- `packages/salon-secretary/evaluation/prepare-inventory-readonly.ts`;
- `src/lib/__tests__/jev-inventory-readonly.test.ts`;
- este documento.

Rollback: retirar somente esses seis artefatos novos. Sem migration, seed, banco, RLS, grants ou configuração a reverter. Preservar o grande conjunto de alterações anteriores do worktree. Parser/provider/Policy/allowlist/catalog/Registry/Skills/runtime e resultados anteriores permanecem byte a byte, verificados pelos pins. Sem deploy, mudança remota, OpenAI ou JEV.

## Validação offline

Rede bloqueada por preload (`net`, `http`, `https`, `fetch`); nenhuma integração PostgreSQL executada. Testes sintéticos não autorizam promoção.

- Teste direcionado Inventory: 48/48 na primeira versão; um cenário adicional de saldo zero foi incluído e validado na suíte final, totalizando **49 testes novos**.
- `npm test -- --maxWorkers=2`: **1966/1966, 250 arquivos**. Inclui JEV, Acceptance Policy, derivações, seis Skills e GPT-6 Golden V2. A primeira execução concorrente apresentou um timeout no teste de varredura de arquivos `no-fixed-password`; passou integralmente com menor concorrência, sem alterar esse teste ou seu timeout.
- `npm run typecheck`: passou após corrigir somente a tipagem de uma fixture nova de teste.
- `npm run lint`: passou.
- Regeração offline: manifest idêntico, hash confirmado, pins antigos intactos, `executed=false`.
- `.env.local`: ignorado/não tracked; verificados apenas booleanos seguros para modelo GPT-6 Luna e paid=false, sem exibir credenciais.

`npm run build`: **passou offline**, incluindo geração do Prisma Client e 61 páginas estáticas. Fonte Google substituída por fixture CSS local já existente, telemetria desativada e segredo NextAuth sintético exclusivo do processo. Nenhuma credencial/configuração persistente foi alterada; nenhuma conexão com banco ou serviço foi necessária. Lint final também passou.

Resultado desta fase: **preparação concluída, 0/26 avaliações reais executadas**. Próximo Gate 3.1C-B.4.1 depende de autorização separada. Nenhuma evidência nova de accuracy, reliability, latência ou custo real JEV foi produzida.
