# Gate 3.1C-B.2 — expansão de cobertura JEV, somente avaliação

Preparação offline em 23/09/2026, worktree `service-create-mvp`. Nenhuma inferência,
consulta a banco, Tool de negócio, Meta ou alteração do runtime. A autorização
futura de uma onda não autoriza automaticamente a próxima.

## Decisão

**Manter a policy e sua allowlist PROVEN intactas.** Ampliar o experimento por
intenção, com candidatos e adversariais; não inscrever paráfrases automaticamente.
Não há threshold, regex de aceitação, router ou bypass operacional novo.
`GPT-6 Luna → Registry → Skills → Tools` continua sendo o caminho oficial.

Os contratos permitem investigar seis métricas Financial fechadas. O catálogo
`decision-derivations-v1` já contém todos os mappings necessários: seis Financial,
cinco Inventory e dois Communication. **Zero mappings novos são necessários.**
Reutilizar o catálogo com versão, SHA-256 e hash da publicação evita uma segunda
tabela de relações. Ausência, ambiguidade, incompatibilidade ou drift falha fechada.
Mapping válido não demonstra interpretação correta e não autoriza execução.

## Matriz A–G das seis Skills

A JEV_CLOSED_DECISION; B DETERMINISTIC_DERIVATION; C BACKEND_RESOLUTION;
D OPEN_EXTRACTION; E COMPLEX_OR_COMPOUND; F FAST_PATH; G OUT_OF_CATALOG.
Essas letras não substituem as categorias A/B/C/D do golden dataset antigo.

| Skill e operações publicadas | A: decisão fechada | B: derivação | C: backend | D/E: Luna | F: antes de IA | G: exemplos excluídos |
|---|---|---|---|---|---|---|
| Services: service.create, service.change | skill, shape, operation | nenhuma nova; operation conhecida no draft | service_ref, requisitos, revisão, autorização | nome/alvo, preço, duração; múltiplas ações | duração em draft elegível | status/desativação, publicação, vínculo profissional |
| Customers: customer.search/read/create/change | skill, shape, operation | operação do draft | customer_ref, contato, duplicidade, tenant | nome composto, telefone/e-mail, patch/remoção | seleção autenticada de candidato já resolvido | papel, credenciais, exclusão, ficha clínica |
| Scheduling: appointment.create/list/read/change/cancel, availability.get, schedule.block | skill, shape, operation | não criar alias redundante cancel→cancel | todas as refs, data absoluta, elegibilidade, disponibilidade, autorização | nomes, datas/horas, motivos, origem/destino; batch/dependências | data/hora/fim nos formatos e drafts aprovados | expediente, desbloqueio, operação não publicada |
| Financial: financial.report | skill, shape, metric, period | seis métricas → financial.report | timezone, período absoluto, Payment, valores, ticket, percentuais, rankings | comparação de dois períodos, group_by, múltiplas métricas, seletores ambíguos | nenhum novo | estorno, lucro, taxas, previsão, filtros por entidade |
| Inventory: product.search, stock.balance, stock.movement | skill, shape, inventory | low_stock/search→product.search; balance→stock.balance; IN/OUT→stock.movement | product_ref, stock/minStock/unidade, projeção, tenant | produto, quantidade, motivo; combinação de ações | quantidade e seleção de candidato em draft elegível | criar produto, compras, fornecedor, conversão de unidade |
| Communication: customer.message | skill, shape, EXACT/GENERATED/unspecified | EXACT/GENERATED→customer.message | destinatário/telefone, preview, autorização, Outbox/status | destinatário, conteúdo EXACT/GENERATED, canal e dependências | canal em draft elegível | SMS/campanha, envio externo real |

A matriz gerada no manifest enumera individualmente as 18 operações, risco,
evidências, decisões, extrações e responsabilidades. Nenhuma Tool é chamada.

## Fronteiras de risco e valor

- `READ_ONLY_CANDIDATE`: consulta fechada sem filtro/entidade/agrupamento aberto.
- `MUTATION_CANDIDATE`: estado previsto no tipo, **zero casos inscritos**.
- `MUTATION_FORCED_LUNA`: toda mutação e Communication; classificar o verbo ou
  modo de mensagem não extrai os demais campos nem permite envio.
- `COMPOUND_FORCED_LUNA`: múltiplas operações/Skills ou dependência, mesmo read-only.
- `OPEN_FORCED_LUNA`: leitura com seletores que o plano não representa.

`FULL_JEV_BYPASS` nos artefatos significa **potencial do oracle**, não aceitação
aprovada nem resultado observado. `JEV_ROUTING_ONLY` significa classificação
parcial possível, ainda exigindo Luna. Não promete ganho de latência: chamar JEV
e depois Luna pode aumentar latência/custo. Ambiguidade, continuação não coberta,
compostos e OOC não são forçados para uma Skill apenas para contar coverage.

Estados de evidência de bypass:

- `PROVEN`: as duas entradas exatas anteriores, contexto vazio e decisões esperadas.
- `CALIBRATION_CANDIDATE`: demais consultas fechadas planejadas, ainda sem inscrição.
- `FORCED_LUNA`: não elegível ao bypass desta fase; pode ter valor de routing.

## Financial e Inventory

| Intenção | Fonte de linguagem / destino canônico | Limite |
|---|---|---|
| service_revenue | metric JEV → financial.report derivado | serviços COMPLETED por data do atendimento; não pagamento |
| received_revenue | metric JEV → financial.report derivado | Payment.amountCents/paidAt; não líquido de taxas/estornos |
| outstanding_receivables | metric JEV → financial.report derivado | saldo atual de COMPLETED sem Payment, serviços+produtos; period=none |
| average_ticket | metric JEV → financial.report derivado | service_revenue/completed_count, calculado no backend |
| realized_revenue | metric JEV → financial.report derivado | inclui produtos; não confundir com recebido |
| completed_count | metric JEV → financial.report derivado | conta atendimentos COMPLETED, não itens/serviços vendidos |
| low_stock | inventory JEV → product.search derivado | stock <= minStock do domínio, inclusive zero e inativos |
| balance/search | inventory JEV → stock.balance/product.search | produto textual permanece extração aberta; somente routing |
| IN/OUT | inventory JEV → stock.movement | mutações excluídas de bypass; quantidade/nome abertos |

Financial fechado admite today/yesterday/this_week/last_week/this_month/last_month.
Recebíveis não admitem histórico; `quanto tinha a receber ontem` não pode virar
saldo atual. `comparison` não contém o par de períodos; `multiple` não contém o
conjunto de métricas. Não inventamos esses seletores. Rankings exigem group_by.
Backend continua único responsável por valores/percentuais; nenhum dado financeiro
bruto é enviado. `Quanto vendi ontem?` fica ambíguo; evitamos ensinar equivalência
frágil entre venda, faturamento de serviços concluídos e pagamento.

## Golden original: 40 casos, expected preservado

O manifest `coverage-expansion-plan.json.goldenAudit.rows` contém, para **cada**
caso, categoria/rota anterior, valor proposto, Skill, risco, evidência, lacunas,
decisões, derivações com provenance, backend e necessidade de Luna.

| Valor potencial | Casos | Proporção do golden artificial |
|---|---:|---:|
| FULL_JEV_BYPASS | 4 | 10% |
| JEV_ROUTING_ONLY | 19 | 47,5% |
| LUNA_REQUIRED | 9 | 22,5% |
| FAST_PATH | 5 | 12,5% |
| OUT_OF_CATALOG | 3 | 7,5% |

Os quatro candidatos integrais são financial-revenue, financial-received,
financial-outstanding e inventory-low. Os dois novos ainda são CALIBRATION_CANDIDATE.
Baseline de policy permanece 5 FAST_PATH, 2 JEV_CANDIDATE, 30 FORCED_LUNA e 3 OOC.
Os 19 routing-only **não** são somados aos 4 para declarar Luna evitado. No total,
28 casos continuam precisando Luna para interpretação, além de 3 fora do catálogo.

## Nova bateria: 64 avaliações em ondas

| Onda | Foco | Casos | Potencial integral | Routing-only | Máximo HTTP | Teto estimado USD |
|---|---|---:|---:|---:|---:|---:|
| 1 | Financial + negativos próximos | 32 | 18 | 6 | 64 | 0,172032 |
| 2 | Inventory read-only + negativos | 16 | 3 | 8 | 32 | 0,086016 |
| 3 | Services/Customers routing | 8 | 0 | 7 | 16 | 0,043008 |
| 4 | Scheduling/Communication exploration | 8 | 0 | 5 | 16 | 0,043008 |
| Total | | 64 | 21 | 26 | 128 | 0,344064 |

Isto é uma distribuição deliberadamente concentrada, não frequência de produção.
21/64 (32,8125%) é potencial fechado, 26/64 (40,625%) routing-only. Não são taxas
empíricas de acerto/aceitação. As mensagens/gabaritos/payloads estão congelados no
manifest gerado e em TS. Perguntas/choices reutilizam o derived-plan aprovado,
sem edição de prompts do runtime ou perguntas antigas.

Cada intenção Financial tem direto/paráfrase/período (recebíveis usa histórico
incompatível como negativo), vizinho, ambiguidade, composto, OOC/mutação próxima
e teste sintético de erro com confidence 0,99. Parte dos negativos é compartilhada
entre intenções, explicitamente referenciada em `adversarialCoverage`; não é
contada como repetição independente. Inventory inclui saldo, busca, saldo zero
(não equivalente a baixo), IN/OUT, compra e cadastro não publicado. EXACT,
GENERATED e cancelamento→mensagem continuam como exploration com Luna obrigatório.

Só enviar `payloads.discovery` ou a ramificação autorizada de `detailBySkill`.
Nunca enviar o envelope que contém expected, tags, baseline ou classificação.
Discovery decide a ramificação; oracle não escolhe o detail. Skill única fora da
onda, compound/ambiguidade/OOC → parar o caso sem detail. Máximo dois HTTP/caso;
retries=0. Casos anteriores 1–19 não serão repetidos por este preparador; novas
avaliações futuras precisam da autorização da respectiva onda.

## Policy atual versus hipótese de expansão

O harness offline `summarizeExpansionTrials` aplica **a policy v1 inalterada** a
resultados fornecidos; não tem transporte, credencial, banco ou chamada Luna.
Novos positivos corretos continuam fallback e são registrados separadamente como
`calibrationOnlyCorrectNotAccepted`. Não são falsos fallbacks da policy v1: ainda
não foram inscritos. `falseFallback` é reservado às entradas PROVEN elegíveis.

Também medimos `unsafeShadowCandidate`: interpretação que parece fechada no
derived-plan, mas está errada ou omite intenção aberta do oracle. Exemplo concreto
offline: `Qual profissional faturou mais este mês?` pode projetar metric+period
corretos, mas perder group_by. Isso não é ACCEPT_JEV nem falso positivo aceito;
mostra por que simplesmente retirar a inscrição exata seria inseguro.
O plano propõe parar também nesse achado antes de ampliar cobertura.

Para futura policy por intenção ainda falta uma defesa comprovada contra omissão
de filtros, agrupamentos, negações, restrições e ações secundárias. Reconhecer os
mesmos seletores fechados não basta. As ondas produzem evidência para essa decisão;
esta etapa não cria nem aprova tal policy.

## Métricas, confidence e histórico

Métricas preparadas: full bypass aceito, routing-only correto, forced Luna,
fallback, correct accept/fallback, false fallback, unsafe false positive, accuracy
among accepted e cortes por Skill/risco/intenção. Registros incluem selected
choice/probability, confidence, runner-up/probability, margin, acerto da projeção,
latência por HTTP/total, tokens conhecidos, custos conhecidos e casos sem custo.
Nenhuma confidence é atribuída à operação derivada ou ao backend. Nenhum corte
numérico foi criado. p95 é descritivo, não promessa de serviço.

O manifest inclui projeção das **19 avaliações históricas completas**, com hashes
dos dois relatórios originais e dados por decisão. Seis accepts e treze fallbacks,
nenhum falso positivo aceito, não calibram frases novas. Caso 19 Financial com
confidence 0,71 continua evidência de erro de Skill/operação não publicada. O caso
20 e sua distribuição de soma 0,99 permanecem preservados e rejeitados; não foram
incluídos como avaliação concluída nem reprocessados para aceite.

Os dois relatórios completos fornecem 56 decisões perguntadas preservadas. Na
projeção histórica de received_revenue há quatro decisões corretas com confidence
entre 0,44 e 1; outstanding_receivables, quatro corretas entre 0,25 e 0,97, margem
mínima 0,03. Low_stock possui nove decisões entre 0,72 e 1. São intervalos misturando
dimensões (skill/shape/metric/period), não calibração de um threshold. O erro OOC
do caso 19 com confidence 0,71 ilustra por que confidence não substitui contrato.
Resultados corretos dessas entradas isoladas não provam generalização para uma
intenção inteira. O manifest permite separar cada dimensão/intenção posteriormente.

`KEEP_STRICT`: parser/validator/probabilidades/confidence intactos; sem
renormalização. INVALID_RESPONSE → FALLBACK_REQUIRED. Um resultado correto de
Skill não repara vetor inválido ou autoriza enviar outra pergunta.

## Custo e próxima autorização

Preço usado apenas para planejamento: US$0,042/M input, output zero, auditado em
22/09/2026; **não reconfirmado por rede nesta etapa offline**. Teto conservador
64.000 input tokens/HTTP. Antes da futura onda, confirmar documentação oficial,
hashes e orçamento; divergência de tarifa exige parada. Não estimamos nova latência
como fato. Wave 1 completa está em `SECRETARIA_JEV_COVERAGE_EXPANSION_WAVE1.md`:
32 mensagens exatas, expected, quatro perguntas condicionais e teto US$0,172032.

Parar em falso positivo inseguro aceito, candidato shadow inseguro, schema/vetor
inválido, hash/catálogo divergente, dado proibido, erro não tratado ou orçamento.
Não repetir/reparar respostas, não avançar onda automaticamente, não criar router.

## Arquivos e rollback

Somente arquivos novos:

- evaluation/coverage-expansion.ts (matriz e reclassificação).
- evaluation/coverage-expansion-dataset.ts (64 oracles novos).
- evaluation/coverage-expansion-plan.ts (payloads e métricas offline).
- evaluation/prepare-coverage-expansion.ts (gerador explícito local).
- evaluation/coverage-expansion-plan.json (manifest e evidências projetadas).
- src/lib/__tests__/jev-coverage-expansion.test.ts.
- este documento e SECRETARIA_JEV_COVERAGE_EXPANSION_WAVE1.md.

Todos os caminhos evaluation ficam em packages/salon-secretary/. Remover somente
esses oito arquivos desfaz esta preparação; nenhum arquivo anterior, dado,
credencial, grant, RLS, modelo, histórico ou configuração remota precisa de rollback.
Não reverter o worktree inteiro, que já continha trabalho anterior não commitado.

## Verificação

Resultados offline:

| Verificação | Resultado |
|---|---|
| Vitest direcionado: expansão, flat/conditional/derived JEV, Acceptance Policy, diagnóstico INVALID_RESPONSE, GPT-6 Golden V2 | 263 testes / 7 arquivos aprovados; 69 testes novos |
| `npm test -- --maxWorkers=2 --testTimeout=30000` | 1.796 testes / 245 arquivos aprovados; seis Skills, Batch e Communication preservados |
| `npm run lint` | exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | exit 0 |
| `npm run build` offline | exit 0, compilação/tipos/prerenderização aprovados |
| Hashes de policy, dataset original, catálogo, parser e relatório inicial | testes de preservação aprovados |
| Hashes dos dois relatórios históricos | iguais aos hashes registrados no manifest; 19 avaliações completas preservadas |
| `.env.local` | ignorado pelo Git; paid=false e modelo gpt-6-luna confirmados sem exibir valores sensíveis |

A suíte inicialmente excedeu o timeout padrão de 5 s na varredura síncrona de
isolamento (leitura de arquivos do runtime, 9–11 s). Duas execuções relataram
somente essa falha de tempo. A execução final ampliou o timeout **apenas por CLI**
para 30 s; nenhuma assertion, teste existente ou configuração foi relaxada.
Logs locais: `%TEMP%/gate31cb2-targeted-final.log`, `gate31cb2-suite-verified.log`,
`gate31cb2-lint-final.log`, `gate31cb2-tsc-final.log`, `gate31cb2-build.log`.

Os processos de verificação utilizaram bloqueio de sockets/HTTP/fetch. O build
usou fixture local de fonte e configuração sintética no processo, sem downloads.
Não é teste de PostgreSQL, browser ou integração real do provider. Zero chamadas
JEV/OpenAI, zero acesso a banco, zero Tool de negócio, zero alterações remotas e
zero deploy. Nenhum arquivo preexistente do core/evaluation precisou ser editado.
