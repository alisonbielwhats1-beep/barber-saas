# Gate 2.1 — Registry, U01 e seleção automática

Base: Gate 1 e Customers aprovados, worktree `service-create-mvp`, branch
`codex/service-create-mvp`, referência `9b92138`. Zero chamadas reais OpenAI.
Nenhum novo grant, migration, deploy, agente interno ou domínio funcional.

## Escolha arquitetural e auditoria do SDK

Revisão 5: Registry versionado, IDs publicados, U01 restrito, manuais seletivos,
operações autorizadas pelo servidor. O SDK realmente instalado é @openai/agents
0.18.0 / openai 7.15.0 (`packages/salon-secretary/package.json`).

Evidências locais do SDK:
- `packages/salon-secretary/node_modules/@openai/agents-core/dist/tool.d.ts:202`:
  Function Tools possuem deferLoading.
- `packages/salon-secretary/node_modules/@openai/agents-openai/dist/tools.d.ts:154`:
  toolSearchTool retorna HostedTool. Por padrão executa no provedor; modo client
  exige protocolo tool_search_call/output e o runner suporta o schema padrão paths.
- `packages/salon-secretary/node_modules/@openai/agents-core/dist/agent.d.ts:212`:
  conjunto de Tools é configuração do Agent, não efeito implícito de uma Tool U01.

Não habilitado toolSearchTool, deferLoading, hosted tool, shell, MCP ou container.
A alternativa escolhida usa Function Tools locais e o Runner já comprovado.
Existe UMA definição operacional/fábrica de Agent, instanciada por run curto como
antes. Nenhum Agent Services/Customers separado, subagent, clone ou handoff.

Primeira mensagem: catálogo curto + contratos U02 compactos, sem manual completo.
A Function Tool `select_capabilities` retorna seleção E interpretação em uma única
resposta. O schema publica apenas seis operações dos dois pacotes; até quatro
operações independentes. Toda resposta é validada antes de qualquer handler.

Depois: backend revalida autorização do plano inteiro, chama U01/loadSkills,
registra versões/hashes, resolve referências e aplica os adaptadores U03/T17/T18/
T19 já existentes. Nenhuma segunda inferência para carregar, propor ou formular
pergunta. A primeira interpretação é provisória até passar pelo domínio real.

**Limite explícito:** no primeiro turno o modelo não lê o manual completo antes
de extrair campos; usa o catálogo compacto e as regras essenciais de extração.
U01 carrega o manual no backend após a seleção. O manual completo entra no input
do modelo apenas se houver continuação daquela operação. Não alegamos que U01
modifica retroativamente o input ou Tools de uma inferência já encerrada.
Isso preserva uma inferência por mensagem, com validação determinística existente.

## Registry final e U01

Fonte única: `packages/salon-secretary/src/skill-registry.ts`. Só duas entradas,
ambas enabled, versão 1.0.0. Arrays/entradas congelados para evitar mutação casual.

| ID | Operações | Capacidades | Autorização |
| --- | --- | --- | --- |
| services | service.create, service.change | U02, U03, T17, T18 | OWNER/MANAGER; salão aprovado; confirmação de escrita |
| customers | customer.search, customer.read, customer.create, customer.change | U02, U03, T01, T02, T19 | OWNER/MANAGER/RECEPTIONIST; salão aprovado; DTO/confirmar escrita |

Cada entrada possui descrição de descoberta, manual_ref estático, versão, estado,
operações, capacidades, papéis e requisitos de autorização. Nenhuma Skill futura
foi registrada como executável. Registry não é uma concessão de permissão.

Contrato U01: `loadSkills({skill_ids: ["services", "customers"]})`.
Saída: manuals com metadados, texto e SHA-256 efetivo; capabilities em união sem
duplicatas. Lista de IDs validada, limitada e deduplicada. Não recebe caminhos,
URLs, nomes de arquivos, Tool livre, código ou SQL. Campo extra é rejeitado.
manual_ref é informativo e fixo; não é usado como caminho controlado por input.

Plano estruturado: `{skills, independent, operations:[{operation,target_name,
name,priceCents,durationMin,phone,email,requested_fields,clear_fields}]}`.
Campos não informados são null. A validação impede mistura de campos entre
domínios, operação inexistente, ID/ref inventado e inconsistência skills/operações.

Auditoria `SECRETARY_SKILL_LOAD / SKILLS_LOADED`: session_id, IDs, versões,
hashes e capacidades. Sem mensagem, telefone, chave, senha ou prompt.
`SECRETARY_OPERATION_PLAN / OPERATIONS_PREPARED`: conversa, operation_ref,
skill/operação, draft_ref/proposal_ref. Registra novas referências nas continuações
e seleções. O usage existente mantém run/session/tenant internos de cada inferência.

## Tools, autorização e continuidade

Descoberta: uma Function Tool `select_capabilities`, nenhuma Tool de execução.
Continuação: mesmo Agent com manual/schema selecionado e uma Function Tool
`upsert_action_draft`. T01/T02/T17/T18/T19 continuam capacidades do backend,
coordenadas deterministicamente; não são handlers SQL nem Tools genéricas.
U01 deduplica U02/U03 compartilhadas. Não amplia o conjunto de Tools do SDK no
meio do run; cada próxima chamada é configurada explicitamente pelo servidor.

Contexto autenticado determina usuário/salão; o modelo só interpreta dados.
Revalidação por operação/campo e RLS permanecem. Recepção pode selecionar um
pedido Services, mas não preparar/executar sua escrita. Plano misto sem permissão
é rejeitado inteiro antes de criar qualquer draft.

Uma operação em andamento tem prioridade sobre descoberta. Resposta de duração,
telefone/e-mail ou esclarecimento usa a mesma operação, Skill e draft. Seleção de
candidato por botão não chama modelo; esclarecimento textual usa uma inferência
no manual já escolhido e volta à resolução backend, sem aceitar IDs do modelo.

Na conversa composta, resposta sem alvo quando há vários fluxos abertos pede
escolha da OPERAÇÃO, sem inferência. Não pede escolha de Skill. Cada cartão tem
ação "Responder a esta operação", candidatos, proposta e confirmação próprias.
Referência de operação precisa pertencer à conversa e ao mesmo usuário/salão.

## Pedidos compostos

Uma mensagem pode preparar até quatro operações independentes. São estados de
operação dentro da mesma conversa/coordenador, não sessões de múltiplos agentes.
Cada estado mantém seus próprios IDs de draft, revisão, proposta e resultado.
Confirmação autenticada valida conversa → operação → proposta; não há botão
"confirmar tudo" nem execução de escrita ao receber texto.

Se qualquer preparação falhar, estados já preparados são cancelados e propostas
parciais não são oferecidas para confirmação. Logs/drafts já gravados podem ficar
no journal, mas nenhum cliente/serviço foi criado/alterado por essa preparação.
Depois de propostas válidas, cada confirmação é explicitamente independente:
se uma já foi confirmada e outra falhar, não há rollback global da primeira.
Pedidos marcados como dependentes são recusados antes de preparar drafts.

Um novo objetivo/pacote após o plano inicial exige Nova conversa. Este gate
preserva continuidade do plano; não implementa replanejamento arbitrário de
objetivos durante drafts pendentes. Sessões continuam em memória/TTL local.

## Medição com modelos fake

Teste `secretary-registry.test.ts`, medindo JSON.stringify do ModelRequest real
entregue pelo Agents SDK ao fake. Caracteres incluem instruções, schema, mensagens
e configurações. NÃO são tokens faturados nem estimativa monetária.

| Cenário | Antes: caracteres do payload | Depois | Inferências antes → depois |
| --- | ---: | ---: | --- |
| Criar massagem por R$50 | 4.630 | 4.954 | 1 → 1 |
| Cadastre Amanda Souza | 4.376 | 4.945 | 1 → 1 |
| Amanda + alteração de massagem | 9.003 em duas solicitações manuais | 4.975 em uma solicitação composta | 2 → 1 |

Antes: manual Services completo de 2.611 caracteres ou Customers de 2.159;
1 Function Tool por chamada. Depois, descoberta envia ZERO caracteres de manual
completo, 1 Function Tool; continuações enviam apenas o manual necessário, também
com 1 Function Tool. Nenhum manual do outro pacote entra na continuação.

Resultado honesto: primeira mensagem simples aumenta o payload total em cerca de
7% (Services) ou 13% (Customers), devido ao catálogo/schema multicapacidade.
Não alegamos economia de tokens nesses casos. O ganho é seleção automática,
manuais carregados seletivamente e composição sem roteador adicional. O composto
comparado usa cerca de 45% menos caracteres e uma inferência em vez de duas.
O cenário anterior composto não existia; a base medida são duas solicitações
equivalentes nos pacotes manualmente selecionados, não uma funcionalidade antiga.

## Arquivos deste incremento

Novos:
- `packages/salon-secretary/src/skill-registry.ts`
- `src/test/secretary-capability-plan.ts`
- `src/lib/__tests__/secretary-registry.test.ts`
- `src/lib/__tests__/secretary-registry.integration.test.ts`
- Este relatório.

Alterados:
- `packages/salon-secretary/src/index.ts`: mesma fábrica/Runner, fase descoberta ou manual escolhido.
- `packages/salon-secretary/src/customers-skill.ts`: remove orientação de seleção manual de pacote.
- `src/lib/salon-secretary.ts`: plano/estados de operações, rastreabilidade e despacho sem nova inferência.
- `src/lib/secretary-customers.ts`: extrai aplicação determinística da interpretação, reutilizada pelos dois caminhos.
- `src/app/(admin)/servicos/secretaria/actions.ts`: início automático e ações autenticadas por operação.
- `src/app/(admin)/servicos/secretaria/secretary-chat.tsx`: remove seletor de Skill; cartões separados.
- `src/app/(admin)/servicos/secretaria/page.tsx`: descrição atualizada.
- `src/lib/__tests__/salon-secretary-ui.test.tsx`: seleção automática e composição na interface.
- `docs/SECRETARIA_CUSTOMERS.md`: referência à evolução deste gate.

## Testes e segurança operacional

Preflight: banco/porta/diretório exclusivos do MVP conferidos pelo helper antes das
fixtures; domínio/testes funcionais com mvp_service_runtime sem superuser/BYPASSRLS.
Somente fixtures sintéticas novas. Nenhum grant/policy/schema alterado neste gate.
Integrações bloqueiam fetch; modelos são ScriptedServicesModel.

- Registry/SDK: 15 testes, cobrindo A–I/N e métricas dos inputs efetivos.
- Registry PostgreSQL: 7 testes, cobrindo continuidade, disambiguação por botão/texto,
  composto com duas propostas, referências trocadas/tenant, revogação por papel,
  pedidos dependentes/ambíguos, confirmações/replay e bloqueio de Skill injetada.
- Regressão PostgreSQL: 10 Services + 10 Customers passaram, incluindo T17/T18/T01/T02/T19.
- Suíte geral: 226 arquivos, 1.264 testes passaram.
- Verificação final UI/Registry PostgreSQL: 13 testes passaram após ajuste de encerramento de plano.
- Lint e TypeScript passaram. Build gera 61 páginas; flag paga false e chave vazia
  no processo de build. Nenhuma credencial/configuração persistida modificada.

Não há prova de seleção correta por Luna real neste gate. Os mocks comprovam
contratos, número de requests e comportamento do backend, não acurácia linguística.

## Rollback e próximos ensaios

Reverter somente os arquivos deste incremento, preservando Gate 1/Customers e as
alterações preexistentes ainda sem commit. Sem reset/clean. Voltar ao seletor antigo
e Runner anterior se necessário. Encerrar conversas em memória; preservar journal,
recibos e logs novos de rastreabilidade. Sem rollback de schema ou privilégios.

Poucos ensaios reais sugeridos, somente com NOVA autorização antes de Scheduling:
1. Criação de serviço com duração faltante e continuação no mesmo draft (2 inferências).
2. Pedido Customers por nome, incluindo telefone solicitado sem valor e esclarecimento.
3. Uma mensagem composta independente; conferir duas propostas, confirmar cada uma
   separadamente e repetir somente uma confirmação sem modelo.
4. Pedido fora do catálogo ou ambíguo: esclarecimento/recusa sem escrita.

SALON_SECRETARY_ALLOW_PAID_CALLS=false. Não executar teste real automaticamente.

Verificação de encerramento: build final aprovado (61 páginas). Conexão somente
leitura com mvp_service_runtime confirmou 127.0.0.1:55441/everflair_service_mvp,
rolsuper=false e rolbypassrls=false. No salão sintético original, Massagem continua
R$60/60 minutos e os quatro MODEL_CALL_FINISHED históricos permanecem quatro.
O cluster descartável foi encerrado com pg_ctl após os testes. Nenhum servidor
da aplicação foi iniciado neste gate.
