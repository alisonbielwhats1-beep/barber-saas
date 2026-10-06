# Secretária Everflair — MVP-2 otimizado, sem chamada paga

Base: `9b92138ec7665342b60e1ddc210f04ccfa611c84`.
Branch/worktree: `codex/service-create-mvp`, `.worktrees/service-create-mvp`.
Esta atualização substitui o desenho inicial de sete chamadas por duas chamadas
no fluxo feliz e adiciona telemetria técnica persistida. Nenhuma chamada real à
OpenAI, credencial real, push, deploy, migration ou alteração produtiva foi feita.
O domínio/confirmador do MVP-1 e os sete agentes internos HQ foram preservados.

## Arquivos deste incremento de otimização

Alterados:

- `packages/salon-secretary/src/index.ts`: Agent, extração em uma chamada, encerramento do loop e contexto mínimo.
- `packages/salon-secretary/src/services-skill.ts`: manual Services adaptado à coordenação determinística.
- `src/lib/salon-secretary.ts`: U02 antes do modelo; U03 e T17 depois da interpretação; integração da telemetria.
- `src/test/scripted-services-model.ts`: fake de duas respostas, com usage explicitamente sintético.
- `src/lib/__tests__/salon-secretary-sdk.test.ts`: contagem por mensagem, payload sem hosted tools e transporte falso.
- `src/lib/__tests__/salon-secretary.integration.test.ts`: fluxo completo, persistência, RLS e falha sem escrita de negócio.
- Este relatório.

Criados:

- `packages/salon-secretary/src/usage.ts`: instrumentação por chamada, normalização por allowlist e base de tokens para cálculo futuro.
- `src/lib/salon-secretary-usage.ts`: persistência interna em AuditLog com withTenant.
- `src/lib/__tests__/salon-secretary-usage.test.ts`: ausência/zero, falhas, contadores, privacidade e persistência indisponível.

A interface `/servicos/secretaria`, suas Actions, as barreiras de ambiente e as
dependências/configurações já existentes do MVP-2 não foram alteradas neste incremento.
Os arquivos aprovados do MVP-1 continuam sem commit e foram preservados.

## Antes e depois

Antes, o fake usava sete inferências: solicitar U02; solicitar U03 com nome/preço;
escrever pergunta; solicitar U02 novamente; solicitar U03 com duração; solicitar T17;
escrever “Confirmar?”. A confirmação já usava zero inferências.

Agora:

1. Backend autentica, revalida autorização/moeda e carrega U02/getOperationRequirements.
2. Uma chamada interpreta “Cadastre uma massagem por R$50” e retorna o patch nome/preço.
3. Backend executa U03/upsertActionDraft do MVP-1. NEEDS_INPUT gera “Qual será a duração?” sem modelo.
4. Uma chamada interpreta “Uma hora”, recebendo somente requisitos e campos atuais; retorna apenas durationMin=60.
5. Backend executa o mesmo U03, preserva nome/preço e referência. READY aciona T17/proposeServiceCreate diretamente.
6. A interface mostra o preview real. Botão autenticado chama confirmServiceCreate do MVP-1, sem inferência.

Observado nos testes: uma chamada na primeira mensagem, duas acumuladas depois da
segunda, duas após confirmação e repetição; zero serviço antes e um após confirmar/repetir.
As três frases equivalentes continuam cobertas, cada uma em tenant sintético distinto.
Os fakes provam coordenação e contratos, não acurácia linguística real do Luna.

## Agent e contrato de interpretação

SDK `@openai/agents` 0.18.0, cliente `openai` 7.15.0, um `Agent` normal definido em
código, separado do pacote HQ. Nome “Secretária Everflair — Services”.
Instructions versionadas em `services-skill.ts`, sem Registry nem outras Skills.

O único Function Tool exposto ao modelo é `upsert_action_draft`, adaptador de U03:
recebe name/priceCents/durationMin anuláveis e entrega o patch ao backend. O callback
não grava: a resposta inteira e seus argumentos são verificados antes do retorno
ao domínio; então o backend chama o handler real U03, sem duplicar sua lógica.
U02/T17 continuam contratos/capacidades do MVP-1, coordenados diretamente pelo backend.

null significa omitido: a chave é removida e não apaga dados anteriores. Parâmetros
extras, texto livre, ferramenta inesperada, múltiplas chamadas ou resposta incompleta
causam erro controlado sem escrita em draft/proposta/serviço. A telemetria registra
a tentativa. Validação de duração/preço/nome continua no domínio real.
Patch totalmente vazio não altera o draft nem prepara nova proposta. “Sim” no chat
nunca executa cadastro; uma proposta já existente pode continuar sendo apresentada.

`toolUseBehavior="stop_on_first_tool"`, `maxTurns=1`, toolChoice U03, sem chamadas
paralelas. Dois bloqueios locais impedem uma segunda inferência no mesmo turno.
Sem retries do cliente e do modelo. Falha não inicia correção automática por IA.
`store=false`, `preserveRawUsage=true`, maxTokens=1200, prazo do turno 45 segundos,
timeout HTTP 30 segundos. Tracing desativado por Runner, sem alterações globais no HQ.

Ao modelo são enviados apenas manual, schema da função, requisitos reais, campos
atuais do draft e mensagem atual. Não são enviados histórico acumulado, referências
de draft/proposta, session_id, salon_id, userId, papéis, permissões ou telemetria.

## Usage persistido por chamada

O modelo é envolvido por `instrumentServicesModel`. Persistência ocorre em
transações curtas independentes das escritas de negócio, sempre com withTenant.
AuditLog existente, `entityType=SALON_SECRETARY_USAGE`; não há mudança de schema.

- Antes do despacho: MODEL_CALL_STARTED, status STARTED, usage_status UNKNOWN, requests=null, tokens=null.
- Ao receber resposta: MODEL_CALL_FINISHED com contadores brutos disponíveis, antes de validar/aplicar a interpretação.
- Em erro/timeout/aborto: MODEL_CALL_FINISHED com status correspondente, usage_status UNKNOWN e tokens null quando não fornecidos.
- Resposta sem usage: SUCCEEDED/UNAVAILABLE. Parcial: PARTIAL. Totais básicos presentes: AVAILABLE; detalhamentos ausentes continuam null.

`requests=1` no evento terminal é uma contagem local de tentativa de chamada,
não uma afirmação de que o provedor faturou exatamente uma requisição. STARTED ainda
não prova despacho. Não há retry automático que esconda tentativas adicionais.
SUCCEEDED descreve a chamada do provedor, não sucesso de cadastro: saída inválida
ou falha posterior de domínio pode coexistir com usage válido já persistido.

Campos: schema_version, call_id, run_id local, session_id interno, salon_id interno,
model_id_requested, model_id_returned, request_id, response_id, requests,
input_tokens, cached_input_tokens, cache_write_tokens, output_tokens,
reasoning_tokens, total_tokens, timestamp, status e usage_status.

Fonte de tokens: rawUsage preservado pelo SDK, ou providerData.usage. Não se usam
zeros normalizados de Usage como substituto de informação ausente. Detalhes vêm de
input_tokens_details.cached_tokens/cache_write_tokens e output_tokens_details.reasoning_tokens.
Não são inferidos totais faltantes. Zero explícito do provedor é mantido como zero.

Reasoning é detalhamento de output. `billableTokenBasis` retorna output_tokens
inalterado, sem somar reasoning. Input é o total informado, incluindo subdivisões
de cache: um cálculo futuro deverá separar essas categorias, sem somá-las ao total.
Não há preços hard-coded, carteira, cobrança ou cálculo monetário neste incremento.
Referência: https://developers.openai.com/api/docs/guides/reasoning

Persistência usa allowlist estrita: nunca prompt, mensagens, telefone, nome do
serviço, API key, headers completos, corpo de erro ou secrets. Identificadores do
tenant/sessão/run são anexados pelo servidor, não pelo modelo. Os registros não
são incluídos na resposta da interface nem em tracing remoto.

Para reconciliar, agrupar por salon_id + call_id: usar o evento FINISHED, se existir;
senão manter STARTED como pendência UNKNOWN. Não somar eventos STARTED e FINISHED
como duas chamadas. run_id muda a cada mensagem; session_id permanece no fluxo.

Se STARTED não puder ser persistido, o modelo não é chamado. Se persistir o final
falhar, nenhuma escrita de negócio ocorre e STARTED permanece como UNKNOWN para
reconciliação. Queda do processo pode deixar apenas STARTED; não significa custo zero.
Ainda não há reconciliação automática com faturamento do provedor, nem painel de consumo.

## Evidência sintética consultada no PostgreSQL

Registro real de telemetria persistida por fake, não consumo real OpenAI:

```json
{
  "schema_version": 1,
  "run_id": "07285730-d7d1-4aad-bce3-5993b1f5cc95",
  "session_id": "01a64ae0-3f5c-42a3-a807-c0cfdc0aefc9",
  "salon_id": "8fb3303b-7561-4fe1-80e5-0919b81c545d",
  "call_id": "e860adfa-7574-4044-8ae0-0f919c9a6a1d",
  "model_id_requested": "fake-services",
  "model_id_returned": "fake-services",
  "request_id": "req_fake_2",
  "response_id": "resp_fake_2",
  "requests": 1,
  "input_tokens": 400,
  "cached_input_tokens": 100,
  "cache_write_tokens": 50,
  "output_tokens": 80,
  "reasoning_tokens": 30,
  "total_tokens": 480,
  "timestamp": "2026-09-21T01:35:35.433Z",
  "status": "SUCCEEDED",
  "usage_status": "AVAILABLE"
}
```

A data acima é UTC; o teste ocorreu em 20/09, horário de São Paulo.
A mesma consulta encontrou TIMEOUT/UNKNOWN com total_tokens=null.

## Segurança e ambiente

Sessões locais em memória por usuário/salão, TTL 20 minutos, 20 turnos, 10 sessões
por usuário e 200 por processo. Operações concorrentes da mesma sessão são
serializadas. Não há transação de banco aberta durante inferência. Sessão perdida
ou outro worker falha fechado. Sem memória avançada/distribuída.

Autenticação e OWNER/MANAGER continuam exigidos, com autorização revalidada pelo
domínio. Revisão/hash/expiração, locks, confirmação idempotente e RLS do MVP-1
foram preservados. A confirmação e sua repetição não entram no adaptador do modelo.

Preflight dos testes verificou o cluster nativo descartável:
`127.0.0.1:55441/everflair_service_mvp`, diretório
`C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data`.
Role mvp_service_runtime sem superuser/BYPASSRLS; FORCE RLS em Service, AuditLog,
Salon e Membership. ClientProfile, Appointment, Product e Payment permaneceram zerados.
Nenhum cliente real, migração ou SQL de alteração de schema foi usado.

## Validação

- `npm run lint`: passou.
- `npx tsc --noEmit --incremental false`: passou.
- `npx vitest run src/lib/__tests__/salon-secretary.integration.test.ts src/lib/__tests__/service-create-mvp.integration.test.ts src/lib/__tests__/salon-secretary-sdk.test.ts src/lib/__tests__/salon-secretary-usage.test.ts --maxWorkers=2`: 50 testes passaram (30 integrações + 20 de SDK/usage).
- `npm test -- --maxWorkers=2`: 221 arquivos, 1.210 testes passaram.
- `npm run build`: passou; 61 páginas estáticas e rota `/servicos/secretaria` compilada.

Cobertura adicional: uma inferência por mensagem, pergunta sem inferência,
T17 automático, confirmação/repetição sem modelo, usage persistido por chamada,
reasoning sem dupla contagem, ausência preservada, erro/timeout, erro de gravação
de telemetria, saída inválida sem escrita de negócio, isolamento real de RLS,
contexto mínimo sem histórico, payload somente function e store=false.
Os testes anteriores de autorização, revisão, cancelamento, idempotência, concorrência
e interface permanecem. Os mocks antigos foram adaptados à coordenação aprovada.

## Configuração e ponto de parada

Mantidos Agent normal, Services somente, nenhum SandboxAgent, Code Interpreter,
Shell, computer use, hosted MCP, container, environment openai_hosted ou filesystem
hospedado. Essas capacidades não estão nas Tools do Agent. O teste HTTP usa fetch
falso e inspeciona o payload; não se conecta à OpenAI.

SALON_SECRETARY_MODEL permanece configurável; exemplo gpt-5.6-luna. O acesso da
conta/projeto ao modelo continua não verificado. SALON_SECRETARY_ENABLED e
SALON_SECRETARY_ALLOW_PAID_CALLS permanecem false no exemplo; nenhuma chave real
foi configurada. Não há fallback para a chave do HQ. A futura chamada exige chave
exclusiva e SALON_SECRETARY_OPENAI_PROJECT explícito, ambiente local e nova autorização.

Limitações: qualidade da interpretação real pendente; saída inválida retorna erro
sem autorreparo por IA; persistência indisponível bloqueia o fluxo; uso desconhecido
exige reconciliação posterior. Não foram adicionados outros domínios/Skills/Tools,
voz, WhatsApp, mídia, carteira, billing ou deploy. Variantes, preço FROM, processamento,
finalização e checkout da base continuam no domínio real, sem novos argumentos de IA.

Rollback operacional: manter as flags desativadas e reiniciar o processo local.
Rollback de código: reverter somente esta otimização nos arquivos listados, mantendo
MVP-1/MVP-2 anteriores. Não usar reset/clean porque há mudanças aprovadas sem commit.
Nenhum rollback de schema é necessário; preservar AuditLog. Nenhuma exclusão de
histórico ou alteração produtiva faz parte do rollback.

PARE antes de qualquer chamada real: a otimização não autoriza consumir crédito.

## Incremento após o primeiro ensaio real: nome determinístico

O primeiro ensaio autorizado respondeu corretamente com nome `massagem`, preço
5000 e duração faltante, mas foi interrompido pelo critério literal `Massagem`.
Este incremento não realiza outra chamada ao provedor.

Auditoria do comportamento existente: `serviceFields.name` faz trim nas
extremidades e valida comprimento; o formulário envia o nome digitado, sem
capitalização. O parser demonstrativo do MVP-1 eleva a primeira letra, mas não
é um normalizador conservador de domínio (alteraria iPhone), portanto não foi
reutilizado nem alterado.

`normalizeSecretaryServiceName` reaproveita o campo/validação do domínio e eleva
somente a primeira letra quando todo o nome é composto por letras minúsculas,
marcas combinantes e espaços. Não faz Title Case, não reduz outras letras para
minúsculas, não expande caracteres como ß e preserva nomes mistos, siglas,
pontuação e dígitos. Espaços internos continuam preservados, como no domínio.
Não tenta inferir marcas ou intenção semântica: um nome inteiramente minúsculo
composto só por letras/espaços recebe a inicial maiúscula.

O coordenador chama o helper somente quando o patch contém name, antes de U03.
Respostas contendo apenas duração não alteram o nome existente. Nenhuma mudança
em SDK, modelo, Skill, U02/U03/T17, confirmação, usage, autenticação ou RLS.

Testes novos: tabela de nomes (incluindo acentos, espaços, siglas, iPhone, pH,
e.l.f. e idempotência) e fluxo com SDK/modelo falso que comprova patch normalizado
antes de U03, ausência preservada e duas inferências simuladas. Nenhum banco é
gravado por esses testes. Quatro arquivos de testes relacionados: 39 casos passaram.

Preparação do próximo ensaio: banco local, OWNER sintético, salão aprovado,
runtime sem superuser/BYPASSRLS, RLS/FORCE RLS, projeto/modelo e credencial presente
reconferidos. O único usage real continua sendo o ensaio anterior. Será necessária
uma nova sessão, pois sessões são locais ao processo; preservar o histórico anterior
e comparar os novos registros por session_id, não exigir AuditLog global vazio.
SALON_SECRETARY_ALLOW_PAID_CALLS permanece false; cluster encerrado após a leitura.

Validação deste incremento: lint e TypeScript passaram; suíte completa com 223
arquivos/1.226 testes passou; build passou (61 páginas estáticas e rota da
Secretária compilada). O build recebeu NEXTAUTH_SECRET sintético somente no
processo, sem alterar configuração persistente. Chaves de API foram esvaziadas
nesse processo de validação e a flag paga permaneceu false.
