# Gate 3.1C-A — Acceptance Policy JEV (somente avaliação)

Data: 23/09/2026. O Agent oficial continua `gpt-6-luna → Registry → Skills → Tools`; o JEV não é chamado pelo runtime. Esta policy é uma função pura no diretório `evaluation/`. Seu `ACCEPT_JEV` significa somente que uma interpretação fechada **poderia dispensar Luna numa futura arquitetura aprovada**. Não autoriza Tool, leitura de banco, escrita, proposta ou confirmação. O backend manterá autorização, RLS/tenant, resolução de referências, regras de domínio e confirmação.

## Evidência e cobertura inicial

O Registry publicado tem seis Skills e 18 operações. O catálogo auditado `decision-derivations-v1`, com versão e hash da publicação, prova `service_revenue → financial.report` e `low_stock → product.search`. As revalidações JEV reais anteriores resolveram exatamente `Quanto faturei ontem?` e `Quais produtos estão com estoque baixo?`. O flat anterior fez uma pergunta Communication irrelevante; o condicional anterior errou a operação Inventory e a rejeitou. Esses resultados não calibram paráfrases, mutações nem confidence numérica.

A allowlist v1 contém **somente essas duas mensagens exatas**, no contexto vazio, Skill única, `shape=single`, decisões relevantes completas, derivação íntegra e resposta do provider coerente. Um texto adicional, outra métrica, período ou intenção torna a entrada não inscrita. Não há parser textual de intenção e não há threshold numérico. A identificação exata é uma restrição transitória de evidência, não promessa de generalização. A primeira calibração deve medir quantos pedidos corretos cairão em fallback.

| Caso inscrito | Decisões JEV obrigatórias | Derivação tipada | Risco | Backend continua responsável |
|---|---|---|---|---|
| `financial-revenue` | skill=financial, shape=single, metric=service_revenue, period=yesterday | financial.report | READ_ONLY | timezone, intervalo absoluto, T09, valor, tenant/autorização |
| `inventory-low` | skill=inventory, shape=single, inventory=low_stock | product.search | READ_ONLY | consulta de produtos/saldos, estoque mínimo, tenant/autorização |

## Matriz de risco do catálogo

| Skill | READ_ONLY | MUTATION | COMMUNICATION |
|---|---|---|---|
| Services | — | `service.create`, `service.change` | — |
| Customers | `customer.search`, `customer.read` | `customer.create`, `customer.change` | — |
| Scheduling | `appointment.list`, `appointment.read`, `availability.get` | `appointment.create`, `appointment.change`, `appointment.cancel`, `schedule.block` | — |
| Financial | `financial.report` | — | — |
| Inventory | `product.search`, `stock.balance` | `stock.movement` | — |
| Communication | — | — | `customer.message` |

`COMPOUND_MUTATION` acrescenta risco quando há várias operações e alguma mutação/comunicação, inclusive `appointment.cancel → appointment.create` e `appointment.cancel → customer.message`. `OPEN_EXTRACTION_REQUIRED` acrescenta risco para nomes, textos, motivos, datas/horas complexas, valores/quantidades, comparações ou relações abertas. `OUT_OF_CATALOG` representa pedidos sem operação publicada. Os marcadores são cumulativos; uma operação de leitura com nome de produto ainda exige extração aberta. Todas as mutações, Communication, pedidos compostos e extrações abertas são **FORCED_LUNA** nesta versão. `FAST_PATH` autorizado pelo draft permanece antes de JEV.

## Contrato de aceitação e falha fechada

`assessJevAcceptance(input, result)` aceita `unknown` e nunca lança exceção para payload malformado. Exige `derived-v3`, resultado JEV `OK`, duas etapas coerentes com as perguntas reconstruídas, um único plano, escolhas publicadas, probabilidades válidas, confidence presente, liderança única da escolha, dimensões `ASKED` ou `NOT_APPLICABLE` corretas, `closedCoverage=true`, `requiresLuna=false`, zero dependências, `NO_ACCEPTANCE_POLICY` como único marcador legado e operação `DERIVED` sem resposta de operation inventada. Recalcula a derivação contra o catálogo e publicação auditados, incluindo hash/versão. Confere o resultado com a inscrição exata; um erro linguístico que por acaso derive uma operação válida continua errado. Nenhuma confidence é atribuída à operação derivada nem a campos de backend.

Ausência de confidence e empate exato top-1/top-2 causam fallback. Margens pequenas **são registradas**, mas não viram um corte arbitrário: nesta v1, a aceitação só é possível nas duas entradas exatas já observadas e com todas as decisões estruturais corretas. Isso não prova calibração; uma bateria maior deve fundamentar qualquer regra numérica futura, por decisão/Skill/risco. `none` e `unspecified` permanecem distintos; `unspecified` relevante nunca é convertido em `none`.

Resultado canônico: `ACCEPT_JEV` ou `FALLBACK_REQUIRED`, `reason` tipado, inscrição, classes de risco, decisões exigidas, interpretação, provenance, campos exclusivos do backend e observações de confidence. Os códigos incluem `ACCEPTED_CLOSED_DECISION`, `INVALID_PROVIDER_RESPONSE`, `FAST_PATH_PRECEDENCE`, `OUT_OF_CATALOG`, `COMPOUND_REQUEST`, `UNSUPPORTED_SKILL`, `UNSUPPORTED_RISK_CLASS`, `OPEN_EXTRACTION_REQUIRED`, `UNCALIBRATED_INPUT`, `INCOMPLETE_DECISIONS`, `UNSPECIFIED_DECISION`, `UNCLEAR_DECISION`, `CONTRADICTORY_DECISION`, `INVALID_DERIVATION`, `CATALOG_VERSION_MISMATCH`, `CONFIDENCE_NOT_CALIBRATED` e `AMBIGUOUS_PROBABILITIES`. Qualquer estado não reconhecido cai em fallback.

Provenance tem valores tipados `FAST_PATH`, `JEV`, `DETERMINISTIC_DERIVATION`, `BACKEND`, `LUNA`. Nesta policy, `skill/shape/metric/period/inventory` são `JEV` quando perguntados; `operation` é `DETERMINISTIC_DERIVATION`. Referências, dinheiro, saldos, disponibilidade e autorização continuam `backendOnly`, sem confidence de JEV. A avaliação não fabrica uma resposta operacional de backend.

## Classificação offline dos 40 casos

Os IDs abaixo pertencem ao dataset congelado. A rota é uma hipótese de cobertura da policy, **não um resultado JEV observado**. `auditAcceptanceDataset()` mantém por caso as decisões do plano, derivação quando candidata, classes de risco e responsabilidades do backend.

| Rota | n | IDs |
|---|---:|---|
| FAST_PATH | 5 | `services-duration`, `scheduling-time`, `scheduling-date`, `inventory-quantity`, `communication-channel` |
| JEV_CANDIDATE | 2 | `financial-revenue`, `inventory-low` |
| FORCED_LUNA | 30 | `services-create`, `services-price`, `services-rename`, `customers-create`, `customers-phone`, `customers-email`, `customers-full-name`, `customers-ambiguous`, `scheduling-create`, `scheduling-cancel`, `scheduling-change`, `scheduling-block`, `scheduling-occupied`, `scheduling-missing-service`, `scheduling-ambiguous-period`, `scheduling-batch`, `financial-received`, `financial-outstanding`, `financial-comparison`, `financial-multiple`, `inventory-balance`, `inventory-in`, `inventory-out-missing`, `communication-exact`, `communication-generated`, `communication-missing-channel`, `communication-dependent-name`, `compound-financial-services`, `compound-financial-inventory`, `compound-customers-services` |
| OUT_OF_CATALOG | 3 | `outside-financial-write`, `outside-roles`, `outside-campaign` |

Financial recebido/recebíveis e Inventory balance são estruturalmente fecháveis em parte, mas não têm evidência JEV real suficiente nesta etapa e seguem Luna. Scheduling cancel simples também não entra: requer nomes, data/hora e motivo abertos. Duas Skills ou operações independentes não viram operação única; dependências continuam Luna.

## Métricas e definição de erro inseguro

`scoreAcceptanceTrials` recebe **somente resultados offline ou futuros resultados já coletados** e usa o oracle separado do provider. Mede candidate coverage (2/40 planejados), accepted coverage, fallback rate, correct/incorrect accepted, false fallback, accuracy among accepted e coverage por Skill/classe de risco. Guarda para cada decisão perguntada selected probability, confidence, runner-up, margem, acerto depois do oracle e accepted/fallback. Sem ensaio JEV novo, não há taxa empírica de aceitação ou segurança a declarar.

`UNSAFE_FALSE_POSITIVE` é qualquer `ACCEPT_JEV` cuja interpretação linguística não corresponda à intenção validada e que poderia seguir para operação diferente. A métrica conta inclusive erro em leitura; não restringe o conceito a mutações. Prioridade: reduzir esse número antes de aumentar coverage. Casos sintéticos dos testes verificam cálculo, não são evidência de qualidade do JEV.

## Gate 3.1C-B proposto, não executado

O manifest isolado `acceptance-calibration-plan.ts` congela **20 avaliações**, no máximo **40 HTTP JEV**, zero retries e zero Luna/Tools/banco. Seis avaliações são três repetições de cada entrada inscrita para observar variação; 14 negativos difíceis são Financial recebido/recebíveis/comparação/múltiplas métricas, Inventory saldo/entrada/quantidade faltante, Scheduling cancel/batch, Communication EXACT/dependente, composto Financial+Services e dois fora do catálogo. Discovery pergunta só skill/shape; detail só depois de Skill única compatível. Requisições enviariam somente mensagem sintética e choices compactas do plano, sem expected, referências, IDs de tenant, telefone, valores financeiros, secrets ou dados de cliente reais.

Pelo preço **historicamente auditado em 22/09/2026** de US$0,042/M tokens de input JEV e teto de 64 mil tokens por HTTP, o máximo conservador teórico é **US$0,10752**; output informado como gratuito naquela auditoria. É um teto de planejamento, não custo observado nem tarifa atual garantida. Reconfirmar a tarifa oficial antes de autorizar execução. Parar sem retry em falso positivo inseguro aceito, drift de schema/catálogo, efeito de rede inesperado ou orçamento excedido. Não criar threshold nem router após a bateria sem nova decisão.

## Limitações e rollback

Esta política só generaliza para as duas frases exatas, e `ACCEPT_JEV` não é um resultado de produção. A microamostra real não estabelece taxa de erro, latência p95 nem calibration de confidence. A presença de múltiplas probabilidades próximas continua observável, mas não há corte justificado. A eventual integração futura deve validar novamente o payload e manter o backend como autoridade. Para rollback desta etapa, remover os módulos `acceptance-policy.ts`, `acceptance-audit.ts`, `acceptance-calibration-plan.ts`, o teste e este documento; o fluxo oficial GPT-6 Luna permanece inalterado. Nenhum banco, grant, RLS, credencial ou recurso remoto foi modificado.
