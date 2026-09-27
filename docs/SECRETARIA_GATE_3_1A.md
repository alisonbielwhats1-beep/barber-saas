# Gate 3.1A — preparação isolada da avaliação JEV

Data: 22/09/2026. Branch: `codex/jev-evaluation`, no worktree `service-create-mvp`.
Estado: infraestrutura local preparada; **nenhuma inferência JEV ou Luna executada**.
Não há integração ao caminho operacional da Secretária nem conclusão empírica sobre precisão/economia do JEV.

## Segurança e escopo

A primeira ação verificou, sem imprimir o segredo: `.env.local` existe; uma definição não vazia de `TYPESAFE_API_KEY`; arquivo ignorado pelo Git e não rastreado/staged; valor ausente dos blobs do índice. A chave não foi copiada, serializada, registrada, alterada ou utilizada. A verificação não comprova validade/autorização da conta junto ao provedor.

`SALON_SECRETARY_ALLOW_PAID_CALLS=false` permanece em vigor. Não houve acesso ao banco, alteração de grants/RLS, deploy, instalação de dependência, container ou hosted tool. Todos os testes usam transportes falsos; os comandos de verificação também recebem bloqueio de rede no processo Node. Não foi feita consulta externa à documentação nesta execução: foram reutilizadas as fontes oficiais da auditoria anterior.

## API oficial e escolha do adapter

JEV é um modelo de decisões fechadas da TypeSafe AI. O contrato oficial recebe `state`, `model` e `questions`; perguntas Choice retornam classe, probabilidades e confidence. Não equivale a um gerador livre de nomes, números, datas, textos e grafos completos. Fontes previamente auditadas: [API](https://docs.typesafe.ai/api), [primitivas](https://docs.typesafe.ai/primitives), [modelos](https://docs.typesafe.ai/models), [confidence](https://docs.typesafe.ai/confidence), [limitações](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

Adapter `JevDecisionProvider`, usando HTTP oficial `POST https://api.typesafe.ai/v1/systemone`, modelo fixado `jev-1.13.0`, Bearer vindo exclusivamente de `TYPESAFE_API_KEY` na factory de configuração. O SDK oficial `@typesafe-ai/sdk` foi considerado, mas não está instalado; utilizar HTTP evita download/rede e mudanças de manifests/lockfile nesta etapa. O [SDK oficial](https://docs.typesafe.ai/sdk/javascript) não é necessário para este contrato pequeno e testável.

Transporte e relógio são injetáveis. Não há fetch ambiente, carregamento automático de `.env`, import de banco/Tools/OpenAI, fallback automático, logs de conteúdo ou entrypoint que dispare rede. A factory exige autorização explícita de rede e OpenAI desabilitado; o harness tem orçamento padrão de zero chamadas. Deadline total de 10s incluindo corpo da resposta; uma tentativa, zero retries; redirects proibidos. O adapter aceita somente endpoint fixo.

Respostas são validadas por schema estrito, opções publicadas, consistência entre classes e distribuição de probabilidades. Erros são códigos constantes; corpos de erro não são lidos nem registrados. `confidence` ausente vira `null` e exige fallback; não é inferida da probabilidade máxima. Usage ausente permanece desconhecido, nunca custo zero. Modelo retornado divergente ou schema inesperado falham de forma controlada.

## Contrato canônico

Entrada: mensagem sintética e contexto mínimo opcional (`operation`, `waiting_for`, `inventory_mode`). O contexto não contém refs, telefone, tenant, sessão ou registros do domínio.

Decisão: sete dimensões fechadas — `skill`, `operation`, `shape`, `period`, `metric`, `inventory`, `communication`. O catálogo congelado possui seis Skills e 18 operações publicadas; não concede autorização nem altera o Registry atual.

Saída de avaliação: decisão, probabilidades/confidence por pergunta, modelo solicitado/retornado, request ID sanitizado quando fornecido, latência, usage, custo estimado ou `null`, código de erro, motivos de fallback e `executable=false`. Custo efetivamente faturado é desconhecido. Metadados arbitrários do provedor não são repassados.

`multiple`/`dependent` classificam a forma do pedido; **não** comprovam extração de cada operação ou grafo. Dependências não extraídas ficam `null`; apenas planos simples/fora do catálogo recebem `[]`. Nomes, valores, datas absolutas, mensagem EXACT/GENERATED e referências não são solicitados ao JEV. O gabarito mantém esses requisitos em `domainFields`, exclusivamente como oracle de cobertura, nunca no payload. O harness não declara field exact match para campos que o adapter não extrai.

## Dataset pré-definido

40 casos com expected estruturado, classificação anterior à execução e referências de origem por arquivo/âncora:

| Classe | Casos | Significado |
|---|---:|---|
| A | 5 | Fast-path existente: duração, hora, data relativa, quantidade, canal |
| B | 14 | Candidatos a classificação JEV; alguns ainda exigem extração aberta/Luna |
| C | 18 | Complexos, ambíguos ou dependentes; fallback esperado |
| D | 3 | Escrita financeira, alteração de papel e campanha SMS fora do catálogo |

Distribuição principal: Services 4, Customers 5, Scheduling 10, Financial 5, Inventory 5, Communication 5, compostos/fora do catálogo 6. Contando participações em compostos: Services 6, Customers 6, Scheduling 11, Financial 7, Inventory 6, Communication 5. Essas participações se sobrepõem e não devem ser somadas como número de casos.

Fontes: golden outputs reais já existentes, testes dos executores e relatórios dos Gates. Frases adaptadas são identificadas como evidência histórica, não como execução pareada. O output que fragmentou “Amanda Communication Sintética” é evidência **negativa**; o expected usa a resolução e defesa posteriormente aprovadas. Não foi usado output futuro do JEV para definir gabarito.

Seis baselines reais Luna sanitizados foram recuperados de artefatos anteriores: cinco Financial e a revalidação dependente Communication. Incluem provenance, fingerprint da entrada, modelo, usage/latência disponíveis e projeção das decisões. Não contêm credenciais, telefone, dados financeiros brutos ou IDs de domínio. São `decision_only`: mensagens comparáveis, mas prompts/contexto/instrumentação distintos; nenhuma alegação de speedup pode decorrer dessa comparação histórica.

## Harness e métricas

`runEvaluation` recebe providers injetados, parser determinístico opcional, arquivos históricos e `maxCalls` explícito. Valida o dataset, envia somente input ao provider, executa sequencialmente, para ao primeiro erro e não faz retries. Nunca executa ações e nunca chama Luna; a baseline Luna é replay de arquivo com fingerprint conferido.

O teste utiliza os parsers puros aprovados para os cinco casos A; não há reimplementação de fast-path no produto. O harness em si não importa runtime. Nenhum threshold de confidence foi escolhido. Sem policy experimental, decisões JEV permanecem em fallback; isso é uma proteção de configuração, não uma taxa medida de incapacidade do modelo.

Métricas definidas antes de resultados:

- **Skill accuracy:** conjunto exato de Skills / casos; `multiple` sem conjunto completo não recebe crédito integral.
- **Operation accuracy:** operações e multiplicidade / casos; `multiple` sozinho não é plano correto.
- **Decision accuracy:** igualdade das sete dimensões fechadas, sem comparar texto gerado ou valores não extraídos.
- **Dependency accuracy e coverage:** grafo exato / todos os casos e proporção com grafo disponível; `null` não vira acerto.
- **Unsafe false-positive:** decisão mutável incorreta que uma policy experimental aceitaria; contagem, taxa sobre aceites e sobre todos os casos. Sem aceites, taxa entre aceites é `null`, não zero certificado.
- **Fallback rate:** ausência de aceite / casos, incluindo erro e cobertura insuficiente. Oracle pode apenas restringir cobertura no experimento; não é roteador de produção.
- **Latency p50/p95:** nearest-rank, incluindo timeout; p50 de sucessos separado. Amostra vazia retorna `null`.
- **Custo/request e por 1.000:** uso faturável × tarifa, separado por provider; qualquer custo ausente impede total inventado. Não inclui futuro custo de fallback Luna.

Precisão, latência real, calibração e economia JEV **ainda não medidas**. Quatro chamadas validarão apenas autenticação/contrato e decisões iniciais; 40 casos também são piloto, insuficientes para certificar segurança. Threshold futuro exige calibração e holdout separados.

## Candidatos e limites

Candidatos mais fortes a evitar uma interpretação Luna, futuramente: Financial com métrica/período fechados e consulta de estoque baixo. Mesmo esses seguem dependentes de validação, tenant e backend determinístico. Classificar cancelamento, cadastro, entrada ou saída não elimina a necessidade de extrair entidades/quantidades/datas; portanto não contar como inferência evitada.

Manter Luna inicialmente: nomes compostos, ambiguidade, GENERATED, dependências/batch, múltiplas métricas e campos abertos. Manter fast-path antes de JEV para os cinco padrões já aprovados. Nada disso implementa roteamento produtivo nesta entrega.

Privacidade: somente mensagens sintéticas revisadas e contexto mínimo. Schema estrito rejeita campos adicionais; filtro adicional recusa telefones/e-mails/URLs/atribuições de segredo, mas não é detector universal de conteúdo sensível. Não usar entrada real livre nesta fase. [Política do fornecedor](https://typesafe.ai/legal/privacy-policy): não treinamento declarado; retenção padrão não comprovada como zero. [ZDR](https://docs.typesafe.ai/legal) depende de oferta enterprise, não presumida para a conta.

## Primeiro ensaio proposto — NÃO EXECUTADO

Quatro chamadas sequenciais, sete perguntas Choice em cada requisição, zero retries, deadline de 10s por chamada. Não executar Tool, T09, banco ou confirmação. Parar diante de erro ou resposta inesperada; fallback é somente resultado de avaliação, sem chamada Luna.

1. `Quanto faturei ontem?` → Financial / `financial.report` / `single` / `yesterday` / `service_revenue`.
2. `Cancele a Beatriz amanhã às 14h. Motivo: teste controlado.` → Scheduling / `appointment.cancel` / `single`; ainda requer extração aberta e fallback.
3. `Quais produtos estão com estoque baixo?` → Inventory / `product.search` / `single` / `low_stock`.
4. `Cancele a Amanda Communication Sintética de amanhã às 14h e mande exatamente no WhatsApp: “Amanda, seu horário foi cancelado.” Motivo: teste controlado.` → `multiple` / `multiple` / `dependent` / `EXACT`; fallback obrigatório, sem presumir grafo/entidades resolvidos.

Os demais campos são `none`. O arquivo **`packages/salon-secretary/evaluation/first-run.json`** contém cada payload exato (`payload`), perguntas completas, todas as choices e expected separado. **Somente `payload` poderá ser enviado**, nunca o envelope com expected. Teste garante igualdade desse arquivo com o gerador `prepareFirstRun()`.

| Pergunta | Choices |
|---|---|
| skill | services, customers, scheduling, financial, inventory, communication, multiple, unclear, out_of_catalog |
| operation | service.create, service.change, customer.search, customer.read, customer.create, customer.change, appointment.create, appointment.list, appointment.read, availability.get, appointment.change, appointment.cancel, schedule.block, financial.report, product.search, stock.balance, stock.movement, customer.message, multiple, unclear, out_of_catalog |
| shape | single, independent, dependent, unclear, out_of_catalog |
| period | today, yesterday, this_week, last_week, this_month, last_month, comparison, none, unclear |
| metric | service_revenue, realized_revenue, received_revenue, outstanding_receivables, completed_count, average_ticket, multiple, none, unclear |
| inventory | balance, low_stock, IN, OUT, search, none, unclear |
| communication | EXACT, GENERATED, unspecified, none, unclear |

Dados enviados: uma frase sintética, `context={}`, modelo fixo e sete perguntas/classes. Nenhum expected, telefone, IDs, registro financeiro, histórico, API key no corpo ou valores calculados. Credencial somente no header de autenticação, nunca no relatório.

Tarifa auditada anteriormente: US$0,042/milhão de tokens de entrada, saída gratuita. Envelope conservador de 64.000 tokens por chamada × 4 = **US$0,010752**. É estimativa condicionada à tarifa/limite publicados, não hard limit de billing nem garantia de cobrança da conta. Tokenização e custo real ainda desconhecidos. Payloads têm cerca de 3,6–3,8 KB, muito abaixo daquele envelope. Não há reserva/compra ou chamada autorizada nesta entrega.

## Arquivos e rollback

Somente arquivos novos:

- `packages/salon-secretary/evaluation/contract.ts`: catálogo/schema canônicos isolados.
- `packages/salon-secretary/evaluation/jev-provider.ts`: adapter HTTP e validação.
- `packages/salon-secretary/evaluation/dataset.ts`: 40 casos e validação.
- `packages/salon-secretary/evaluation/harness.ts`: replay, orçamento e métricas.
- `packages/salon-secretary/evaluation/luna-baselines.json`: seis resultados históricos sanitizados.
- `packages/salon-secretary/evaluation/prepare.ts`: plano offline do ensaio.
- `packages/salon-secretary/evaluation/first-run.json`: quatro payloads para revisão.
- `src/lib/__tests__/jev-evaluation.test.ts`: mocks/contratos/dataset/harness/isolamento.
- Este relatório.

Nenhum import/export do runtime, prompt operacional, Registry, Skill, Tool, manifest, lockfile ou objeto de banco foi alterado. Rollback: remover exclusivamente esses arquivos novos; não reverter outras alterações preexistentes do worktree nem alterar `.env.local`. Não há rollback de banco ou deploy.

## Verificações locais

79 testes direcionados: chave ausente/presente sem exposição, schema inválido, erros/auth simulados, timeout total, confidence/usage ausentes, privacidade, dataset/provenance, cinco parsers existentes, seis replays históricos, orçamento/erros/métricas e ausência de imports no runtime.

| Comando | Resultado |
|---|---|
| `npx vitest run src/lib/__tests__/jev-evaluation.test.ts` | 79 aprovados |
| `npm test` | 1.576 aprovados, 237 arquivos; inclui regressões das seis Skills |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit --incremental false` | exit 0 |
| `npm run build` padrão, rede bloqueada | bloqueado exclusivamente pelo download de Inter em `next/font/google` |
| `npm run build` com mock de fonte offline | exit 0, compilação/tipos/prerenderização concluídos |

O build offline utiliza `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, mecanismo existente no Next.js instalado, apontando a fixture temporária fora do repositório. Bloqueio de sockets/HTTP continua ativo; fonte não foi baixada. `NEXTAUTH_SECRET` e URLs receberam apenas valores sintéticos no processo de build; chaves de inferência ficaram vazias nesse processo. Isso verifica build offline, não equivalência visual da fonte ou runtime autenticado. Não houve alteração de código/env para acomodar o build. Warnings preexistentes de Vite/CommonJS e cache de strings do webpack não impediram as verificações.

Comparação SHA-256 de **1.145 arquivos preexistentes**, antes/depois e novamente após o build: **zero arquivos alterados**. Nove arquivos novos delimitam toda a entrega. Nenhum teste PostgreSQL foi necessário nesta alteração isolada; nenhum banco foi acessado. Não houve fetch/PR/CI remoto por causa da proibição de chamadas externas; `origin/master` não foi atualizado nesta execução.

Evidências locais de execução em `%TEMP%/gate31a-targeted.log`, `gate31a-suite.log`, `gate31a-lint.log`, `gate31a-tsc.log`, `gate31a-build.log`, `gate31a-build-offline.log` e `gate31a-verification.json`. A configuração final continua `SALON_SECRETARY_ALLOW_PAID_CALLS=false`. Zero chamadas JEV/OpenAI; zero benchmark real.
