# Gate 3.1A — decisões linguísticas e derivações de catálogo

Auditoria offline de 22/09/2026, worktree `service-create-mvp`, branch existente
`codex/jev-evaluation`. Somente avaliação: não muda Agent, Registry, Skills,
Tools, backend ou prompts operacionais. Zero novas chamadas JEV/OpenAI.
Este documento sucede a hipótese conditional-v2 de `SECRETARIA_JEV_DECISION_PLAN.md`;
os arquivos v1/v2 e seus resultados permanecem como históricos, sem reescrita.
O `origin/master` foi apenas identificado no cache local; não houve fetch/PR/CI remoto.

## Evidência e causa do trabalho

Na revalidação real v2, Financial acertou cinco decisões: 783,3 ms e custo
estimado US$0,000050484. Inventory acertou Skill, formato e low_stock, mas
escolheu stock.balance (probabilidade 0,44; confidence 0,33), contra
product.search (probabilidade 0,16). A composição rejeitou
INVENTORY_OPERATION_CONFLICT; nenhum resultado errado foi aceito como resolvido.

`conditional-real-response.json` preserva as quatro respostas reais e os
vetores de probabilidades. O teste mantém a rejeição v2 e comprova que a resposta
antiga, contendo operation extra, NÃO passa silenciosamente pelo parser v3.
Não se apagou uma resposta errada para contabilizar uma execução nova correta.

Perguntar operation e inventory independentemente exige que o modelo reaprenda
uma relação que já está publicada. Essa redundância permite a contradição
observada. Retirar uma decisão redundante não demonstra melhora da classificação
que continua linguística, nem permite escolher threshold a partir do erro 0,33.

## Fontes reais, sem alteração do produto

| Fonte | Evidência usada |
|---|---|
| `packages/salon-secretary/src/skill-registry.ts` | Seis Skills habilitadas, 18 operações e associação operação/Skill; discoveryInstructions publica low_stock em product.search |
| `src/inventory-skill.ts` no pacote | inventoryOperation e manual: low_stock/search → product.search, balance → stock.balance, IN/OUT → stock.movement |
| `src/financial-skill.ts` no pacote | financialRequirements publica financial.report, seis métricas e períodos; saldo a receber é atual |
| `src/communication-skill.ts` no pacote | communicationRequirements publica customer.message; manual/schema distinguem EXACT e GENERATED |
| `src/services-skill.ts`, `src/customers-skill.ts`, `src/scheduling-skill.ts` no pacote | Duas, quatro e sete operações respectivamente; a Skill não determina uma única operação |
| `src/lib/secretary-inventory.ts` | searchProducts resolve estoque baixo; a condição `operation === product.search || low_stock` também tolera stock.balance + low_stock |
| `src/lib/secretary-financial.ts` | T09 e regras de período/métrica, agregação somente backend |
| `src/lib/secretary-communication.ts` | Preview/conteúdo/contato/dependência são posteriores à interpretação |

**Nuance Inventory:** product.search é a operação canônica inequívoca publicada
para intenção low_stock. O schema/executor é mais permissivo e tolera uma
representação alternativa. Portanto a derivação afirma a convenção de roteamento
do catálogo, não que stock.balance + low_stock seja impossível no backend.
Nada foi alterado nesse executor ou em sua tolerância.

## Matriz de responsabilidade A/B/C/D/E

A = LINGUISTIC_DECISION; B = DETERMINISTIC_DERIVATION; C = BACKEND_RESOLUTION;
D = LUNA_REQUIRED; E = FAST_PATH. Essas letras não substituem as categorias
pré-existentes A/B/C/D do dataset. N/A não é uma classificação nem uma pergunta.

| Skill única / nova solicitação | A: JEV | B: código | C: backend | D: inicialmente Luna | E: continuação existente |
|---|---|---|---|---|---|
| Services | skill, shape, operation | operação já conhecida em contexto de draft | service_ref, requisitos, normalização, revisão | nome/alvo, preço/duração abertos | durationMin inequívoca |
| Customers | skill, shape, operation | operação do draft | customer_ref, duplicidade, contatos e autorização | nome composto, busca/alvo, patch de contato | sem parser específico novo |
| Scheduling | skill, shape, operation | operação do draft; snapshots vêm do backend | refs, timezone/data absoluta, preço/duração, vagas/recursos | entidades, datas/horas abertas, motivo, grafo | time/date nos formatos já aprovados |
| Financial | skill, shape, metric, period | metric suportada → financial.report | intervalo absoluto, números/T09, tenant | comparações com dois períodos, ranking/group_by, múltiplas métricas | nenhum novo |
| Inventory | skill, shape, inventory intent | intenção → operação publicada | product_ref, saldo/mínimo/unidade/projeção | nome do produto, quantidade/motivo abertos | quantity inteira no draft correto |
| Communication | skill, shape, communication mode | EXACT/GENERATED → customer.message | recipient_ref/telefone, validação EXACT, canal, Outbox | destinatário, texto literal/gerado, dependências | channel no draft correto |

`derived-audit.json.matrix` enumera as sete dimensões para cada uma das seis
Skills, inclusive N/A, e as responsabilidades adicionais C/D/E.

Detalhes das sete dimensões originais:

- skill e shape continuam linguísticas na descoberta. Nenhum gabarito seleciona
  a ramificação real. Em continuação, o estado autorizado tem precedência;
  não se reclassifica o pedido pelo JEV.
- operation continua uma decisão linguística para Services/Customers/Scheduling.
  Perguntar "cancel intent" e depois mapear para appointment.cancel apenas
  renomearia a mesma escolha. O verbo cancelar sozinho também pode se referir
  a pagamento, mensagem ou operação não publicada. Não foi criado parser por verbo.
- metric e period são linguísticas somente no detalhe Financial. O período é
  rótulo financeiro, não uma data de agenda. Sua conversão absoluta é C.
- inventory é linguística somente no detalhe Inventory. Quantidade/saldo não
  são extraídos/calculados por essa classificação.
- communication é linguística somente no detalhe Communication. Modo não
  comprova destinatário, texto, canal ou grafo.
- Dimensões irrelevantes não são perguntadas nem recebem probabilidades.
  none canônico de N/A tem proveniência NOT_APPLICABLE; não é resposta do JEV.

A classificação depende do que já se sabe: uma operation publicada já conhecida
determina sua Skill pelo Registry (B); um plano já resolvido determina shape por
quantidade de operações/dependências (B/C). No início dessas mensagens não há
operation nem grafo confiáveis. Por isso discovery skill/shape continua A no
desenho condicional. Substituí-la por uma pergunta global de todas as operations
seria outra hipótese, com mais choices e outra avaliação; não foi introduzida.
No contexto autorizado de draft, operação e Skill conhecidas não são perguntadas
novamente. Perguntas não feitas não entram na accuracy/confidence do modelo.

## Catálogo fechado e precedência

`derivation-catalog.ts` contém 13 bindings tipados e suas fontes:

| Skill / decisão | Operation derivada |
|---|---|
| Financial: service_revenue, realized_revenue, received_revenue, completed_count, average_ticket, outstanding_receivables | financial.report |
| Inventory: low_stock, search | product.search |
| Inventory: balance | stock.balance |
| Inventory: IN, OUT | stock.movement |
| Communication: EXACT, GENERATED | customer.message |

Só há derivação após Skill única e shape=single validados. Múltiplas operações,
dependências e fora do catálogo param após discovery. `multiple`, `unclear`,
`none` e `unspecified` não recebem operação por default. Em particular,
Communication unspecified é preservado em answers e requer fallback; não vira
none nem GENERATED. Financial period=none continua legítimo para recebíveis
atuais; período explícito junto de recebíveis é incompatível e não tem cobertura.

O catálogo experimental importa somente descritores puros publicados, em leitura.
Não importa index do Agent, coordenadores operacionais, executores ou banco.
O fingerprint fixa versões/enablement/operações do Registry, requisitos Financial,
operações/manual Inventory e requisitos/manual Communication. Não envia esses
manuais ao JEV. A relação Inventory hoje textual fica tipada neste catálogo
isolado e vinculada ao hash de sua fonte, sem editar a fonte produtiva.

Antes de qualquer transporte, `DerivedJevProvider` confere compatibilidade com o
catálogo auditado. Mudança de publicação ou catálogo → CATALOG_DRIFT, zero chamadas.
Na derivação, zero bindings → MAPPING_MISSING; mais de um binding/alvo →
MAPPING_AMBIGUOUS. Destino não publicado, duplicado entre Skills ou de outra Skill
é rejeitado. Alterar um mapping para outra operação da mesma Skill também falha
por drift. Não há seleção do primeiro alvo nem operação construída por concatenação.

Cada derivação registra fonte, valor, versão/hash e operação. A saída distingue
ASKED, DERIVED, NOT_APPLICABLE e NOT_RESOLVED. Operation derivada não aparece em
answers, probabilities ou confidence. `scoreDerivedDecisions` separa acertos das
respostas JEV e acertos das derivações; a matriz para calibração futura contém
somente respostas realmente perguntadas. Nenhum threshold foi definido.

`closedCoverage` ainda significa somente suficiência do contrato experimental;
não prova acerto. `accepted=false`, `executable=false` e NO_ACCEPTANCE_POLICY
continuam. Nenhuma decisão chama Tool, banco, Luna ou confirma ação.

## Impacto offline nos 40 casos

O dataset original e todos os expected foram preservados byte a byte. Cada caso
ganhou um relatório separado com perguntas necessárias, derivação, resoluções
backend, requisitos abertos, fallback e fast-path. O plano por caso usa expected
apenas para o contrafactual offline (`oracleOnlyOfflinePlan=true`). O provider
real recebe só mensagem/contexto e usa exclusivamente discovery para ramificar.

Distribuição de caminhos preservada: cinco fast-path, duas continuações abertas
no fluxo de draft, 24 discovery+detail e nove discovery+fallback/fora do catálogo.
Foram removidas 11 perguntas operation: quatro Financial, quatro Inventory e
três Communication. Dez casos possuem derivação esperada definida; o caso
Communication unspecified continua sem operação derivada e requer fallback.

| Categoria ORIGINAL do dataset | Casos | Perguntas v2 → v3 | Média v3 por caso | HTTP planejados |
|---|---:|---:|---:|---:|
| A — fast-path | 5 | 0 → 0 | 0 | 0 |
| B — candidato JEV | 14 | 54 → 46 | 3,286 | 28 |
| C — esperado Luna/complexo | 18 | 45 → 42 | 2,333 | 26 |
| D — fora do catálogo | 3 | 6 → 6 | 2 | 3 |
| Total | 40 | 105 → 94 | 2,35 | 57 |

Casos complexos classificam apenas formato/Skill ou algumas decisões fechadas;
não se declara que o plano inteiro foi resolvido. Os cinco fast-path reutilizam
o parser existente; não houve novo parser de Financial/Customers.

## Payload e custo: somente projeção

Bytes = JSON UTF-8 minificado dos corpos, sem headers. Planos pressupõem
discovery esperado. Não são tokens, custo ou latência medidos.

| Plano | Perguntas v2 → v3 | HTTP v2 → v3 | Bytes v2 → v3 |
|---|---:|---:|---:|
| Financial simples | 5 → 4 | 2 → 2 | 2.580 → 2.200 |
| Inventory low_stock | 4 → 3 | 2 → 2 | 1.954 → 1.533 |
| Dois casos propostos | 9 → 7 | 4 → 4 | 4.534 → 3.733 |
| 40 casos | 105 → 94 | 57 → 57 | 54.333 → 49.989 |

Remoção de 4.344 bytes (aproximadamente 8,0%) no conjunto; 10,5% menos perguntas.
Não há nova latência ou economia faturada medida. Os dados reais permanecem
Financial v2 783,3 ms / US$0,000050484; Inventory v2 641,1 ms /
US$0,000043134, rejeitado. Financial flat 873,8 ms; Luna histórico 4.055 ms.
São amostras pequenas/contratos diferentes, não comparações pareadas.

## Próxima revalidação proposta — NÃO EXECUTADA

`derived-revalidation.json` contém payloads exatos, expected separado e limite:

1. **Quanto faturei ontem?** Discovery skill/shape; somente financial/single
   habilita detail metric/period. Esperado service_revenue/yesterday;
   código deriva financial.report. Quatro perguntas, duas chamadas HTTP.
2. **Quais produtos estão com estoque baixo?** Discovery skill/shape; somente
   inventory/single habilita detail inventory. Esperado low_stock;
   código deriva product.search. Três perguntas, duas chamadas HTTP.

Choices e instructions de metric/period/inventory/discovery permanecem iguais
às do plano aprovado; apenas operation deixa de ser enviada nessas ramificações.
Zero retries; 10s por HTTP; orçamento padrão do provider é zero. Nunca enviar
expected/categoria/evidência ao provedor. Parar diante de discovery incompatível,
erro ou nova incompatibilidade; não trocar silenciosamente de ramificação.
Não incluir Scheduling, Communication ou fallback Luna nesta proposta.

Envelope conservador herdado da auditoria de preço/limite: quatro chamadas ×
64.000 input tokens × US$0,042/milhão = US$0,010752. Não é cotação atualizada,
limite contratado ou previsão do custo pequeno real; não se consultou rede nesta
etapa. Custo real exige usage das quatro chamadas, se futuramente autorizadas.

## Limitações

- Uma decisão linguística errada ainda pode originar uma derivação coerente,
  mas incorreta para a frase. O catálogo elimina redundância estrutural; não
  corrige Skill, intenção, métrica ou período mal classificados.
- Discovery único errado pode ocultar parte de um pedido. Multi-skill/grafo,
  extração aberta, rankings/group_by e comparações continuam fora da cobertura
  fechada inicial. Não se generaliza o sucesso a toda frase Financial/Inventory.
- Snapshot conservador bloqueia até mudanças não semânticas no manual; revisão
  offline é necessária antes de aceitar nova versão. Nenhuma atualização automática.
- A tolerância do backend Inventory e o catálogo canônico não são idênticos;
  o experimento deriva o canônico, sem modificar o produto.
- Confidence 0,33 do erro antigo é evidência individual, não corte calibrado.

## Arquivos e rollback

Arquivos novos: evaluation/derivation-catalog.ts, derived-plan.ts,
derived-provider.ts, derived-audit.ts, derived-audit.json,
derived-revalidation.json, conditional-real-response.json;
src/lib/__tests__/jev-derived-evaluation.test.ts; este documento.
Nenhum arquivo v1/v2, dataset, expected, prompt operacional ou arquivo de domínio
precisa ser modificado. Não há dependência/manifest/migration nova.

Rollback: retirar exclusivamente esses nove arquivos novos. Não remover a
avaliação v1/v2 nem reverter outras alterações preexistentes do worktree.
Backup e inventário anteriores em `%TEMP%/gate31a-derivation-backup` e
`%TEMP%/gate31a-derivation-before.json`. Não há dados, env, deploy ou banco a reverter.

## Verificações

Resultados finais offline:

- Vitest direcionado (avaliações flat, condicional e derivada): 160 testes em
  três arquivos aprovados; 55 testes novos de derivação.
- `npm test`: 1.657 testes em 239 arquivos aprovados, incluindo regressões
  mockadas das seis Skills. Testes PostgreSQL não fazem parte desta execução;
  nenhum banco foi acessado.
- `npm run lint`: aprovado.
- `tsc --noEmit --incremental false`: aprovado.
- `npm run build`: aprovado, com avisos não bloqueantes de cache do webpack.
- Inventário de preservação: os hashes dos 1.162 arquivos preexistentes
  permanecem iguais; somente os nove arquivos novos listados acima.

Logs: `%TEMP%/gate31a-derivation-{tests,suite,lint,tsc,build}.log`;
inventário: `%TEMP%/gate31a-derivation-verification.json`.
Bloqueio de fetch/HTTP/sockets no processo Node; transportes JEV são fakes.
Build usa o mock de fonte offline já utilizado nesta avaliação; nenhuma fonte
ou dependência é baixada. SALON_SECRETARY_ALLOW_PAID_CALLS permanece false.
