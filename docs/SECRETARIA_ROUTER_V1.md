# Gate 3.1C-C — Router V1 preparado, desligado

Implementação local, sem deploy e sem validação real neste Gate. GPT-6 Luna
continua interpretador geral; GPT-5.6 Luna continua rollback de modelo.
Os resultados experimentais Financial/Inventory não foram promovidos.

## Auditoria e integração

Entrada: Server Actions autenticadas → `assertSecretaryEnvironment` →
`SalonSecretary.send` → lock de sessão e autorização → fast-path existente.
Continuações automáticas são encaminhadas ao filho existente antes de qualquer
nova descoberta. `inheritedInterpretation` impede tratar esse filho como contexto
vazio, mesmo antes da primeira resposta do usuário.

Integração mínima: antes de `runServicesTurn(..., "discovery")` em `sendAutomatic`,
e antes de Luna em sessões explícitas Financial/Inventory novas. Somente uma
interpretação aceita é adaptada ao mesmo `CapabilitySelection` validado pelo
Registry. A adaptação não resolve entidade nem calcula valores. O coordenador
existente continua carregando Skills, reautorizando e chamando as funções de
domínio. Drafts, propostas, confirmações, concorrência e idempotência não mudam.

`secretary-router.ts` é a única ponte para cinco primitivas já auditadas em
`evaluation/`: provider derivado, parser/plan, policy, catálogo e endpoint.
Não importa datasets, golden expected, scorer nem runners de avaliação. Esses
arquivos históricos continuam byte a byte iguais; seus comentários anteriores
"evaluation only" descrevem sua origem. Esta entrega autoriza apenas seu reuso
pela ponte opt-in, não os runners nem resultados experimentais.

## Configuração e eligibility

`SALON_SECRETARY_JEV_ROUTER_ENABLED=false` por padrão, inclusive `.env.example`
e `.env.local` ignorado. Só a string `true` ativa o ramo. JEV real também exige
`SALON_SECRETARY_ALLOW_PAID_CALLS=true`; ambos continuam false localmente.
Sem flag, não se lê a chave JEV nem se despacha transporte JEV.
Antes de qualquer envio, o Router fixa versões do plano/Policy, hash do
catálogo e fingerprint das duas inscrições. Mudança futura de avaliação não
amplia silenciosamente o runtime: exige revisão explícita desses pins.

Eligibility é igualdade exata com `initialAllowlist`, em sessão nova e escopo
auto ou Skill compatível. A validação de mensagem já existente retira espaços
externos; não se adicionou normalização, regex, similaridade ou heurística.

| Entrada PROVEN | Perguntas | Derivação | Backend |
|---|---|---|---|
| Quanto faturei ontem? | skill, shape; metric, period | service_revenue → financial.report | timezone, intervalo e T09 |
| Quais produtos estão com estoque baixo? | skill, shape; inventory | low_stock → product.search | stock <= minStock, tenant, produtos |

Qualquer paráfrase, outra métrica/período, filtro, ranking, produto nomeado,
mutação, dependência, composto ou outra Skill continua diretamente Luna.
Sem valor de bypass, não há chamada de pré-classificação.

## Fluxo e barreiras

1. Fast-path aprovado de duração/data/horário/quantidade/canal: zero IA.
2. Sem inscrição exata ou com contexto: Luna atual.
3. Elegível e flags ativas: adapter oficial, no máximo dois POSTs, zero retries,
   10 segundos por HTTP, discovery e detail condicional.
4. Guard adicional compara URL/método/redirect/body com os dois payloads
   reconstruídos do plano aprovado. Skill diferente não pode enviar detail
   de outra Skill. Só texto inscrito, contexto vazio e decisões publicadas;
   nunca IDs, saldo, valor, nome real, expected ou secrets no corpo.
5. KEEP_STRICT → catálogo versionado/hash → Policy imutável → ACCEPT_JEV.
6. Qualquer erro/estado desconhecido, 0,99, JSON/schema inválido, unclear,
   ausência, conflito, hash divergente, timeout ou HTTP 4xx/5xx retorna Luna.

O Router não captura falhas de autorização/domínio para tentar contorná-las
com outra interpretação. Essas falhas continuam bloqueadas pelo backend.
ACCEPT_JEV não concede permissão de consulta, escrita ou confirmação.

OpenAI permanece no client dedicado, Responses, `store=false`, tracing off,
`maxRetries=0`, `maxTurns=1`, `parallelToolCalls=false`, uma Function Tool local
(`select_capabilities` ou `upsert_action_draft`). Cost guard e bloqueios de
hosted tools/containers não foram alterados.

## Telemetria e provenance

Uma trilha `SECRETARY_ROUTER` no AuditLog existente, tenant-scoped via
`withTenant`, por mensagem externa. Parent → child compartilha contexto
AsyncLocalStorage; mensagens simultâneas não compartilham estado. Não há
migration, wallet ou cobrança ao cliente.

Campos: router_path, eligibility, JEV tentado/chamadas HTTP, Policy/reason,
Luna efetivamente chamado/contagem, invalid/timeout/wire rejected, tokens e
custo separado JEV/OpenAI/total, estágios, confidence/margens válidas,
provenance e versão/hash da derivação. Nenhum texto, erro bruto, chave ou
resposta de domínio é copiado. IDs de correlação ficam somente na auditoria
interna autenticada e nunca chegam ao JEV.

Campos linguísticos aceitos vêm de JEV; operation vem da derivação, sem
confidence. Nos outros caminhos, a interpretação vem de FAST_PATH ou LUNA.
Refs, autorização, tenant, intervalo absoluto, valores, estoque e disponibilidade
continuam BACKEND. Os eventos legados `interpretation_source=MODEL` são genéricos;
`SECRETARY_ROUTER` distingue o provider, sem reescrever o histórico.

Latência JEV inclui adapter/validação/Policy e tem estágios HTTP separados.
Luna mede `Model.getResponse` (inclui overhead do client, não um tempo puro de
rede). Descoberta automática mede também a interpretação inteira do SDK.
`backend_and_orchestration` é o tempo residual da mensagem, incluindo autorização,
coordenação e auditorias internas; **não deve ser apresentado como SQL puro**.
Interpretação isolada nas demais rotas pode permanecer null; os timers de
domínio existentes são preservados. Total exclui a persistência do próprio
evento final. Falha de persistência dessa telemetria adicional não derruba a
Secretária; a auditoria obrigatória de usage Luna mantém sua semântica original.

Estimativas não são custo faturado. JEV usa a tarifa já registrada no adapter;
GPT-6 usa Standard/contexto curto da auditoria 22/09: input 0,10, cached 0,01,
cache-write 0,125 e output 0,50 USD/M. Reasoning não é somado novamente.
Modelo/counters/tarifa não demonstráveis deixam custo null, inclusive rollback
GPT-5.6 e cache-write ausente. Custos conhecidos de JEV são preservados mesmo
quando Luna é necessário. Não há débito de wallet nem interpretação de null como zero.

## Validação offline e limitações

Testes usam transporte JEV fake com parser/derivação/Policy reais, SDK Luna
scripted e SQL/tenant mocks; não equivalem a execução PostgreSQL ou a medição
de qualidade real. Cobrem as duas leituras, falhas, incompatibilidade com
confidence 1,00, catálogo stale, guard de payload, flag/paid OFF, 40 golden
entradas, Golden V2, continuação, fast-path, expiração, concorrência e cross-tenant.
Hashes preservados constam no relatório de validação deste Gate.

Não há threshold ou shadow mode. Shadow duplicaria custo sem evitar Luna e
exigiria outra autorização para cada inferência. As duas inscrições exatas
não generalizam Financial/Inventory. Worst case adiciona até dois timeouts
sequenciais de 10s antes de Luna; é uma limitação conhecida, não nova latência
real medida. Router segue desligado até revisão da validação mínima.

## Próximo ensaio — preparado, NÃO executado

Manifest: `packages/salon-secretary/evaluation/router-v1-validation-plan.json`.
A: low_stock PROVEN; B: recebido ontem direto Luna; C: duração de draft com
mocks locais; D: HTTP 500 simulado seguido de Luna. Nenhuma confirmação.
Máximo 2 HTTP JEV reais e 3 inferências GPT-6, incluindo reserva de fallback
do caso A; normalmente são 2 inferências Luna. Não executar GPT-5.6/JEV adicional.

Preços são base histórica de planejamento, não reconfirmação online neste Gate.
Sob cap explícito futuro de 64k input/HTTP e 1.200 output Luna, teto calculado
US$0,031176 (JEV US$0,005376 + OpenAI US$0,0258, considerando cache-write como
maior tarifa de entrada); orçamento de parada proposto US$0,04. Reconfirmar
tarifas e impor caps no processo de validação antes da rede; divergência para.
Só leituras no banco descartável e auditoria técnica; C inteiramente mockado.
Parar em resultado/rota inesperado, unsafe acceptance, guard, limite, tenant ou
escrita operacional. Finally desliga paid flag e Router. Nova autorização exigida.

## Rollback

Imediato: `SALON_SECRETARY_JEV_ROUTER_ENABLED=false`; todas as novas mensagens
seguem os fast-paths existentes e Luna. Uma mensagem já em voo termina sob seu
estado capturado; a flag não cancela retroativamente requests enviados.
Rollback de código: remover os imports/hooks de Router em `salon-secretary.ts`
e a configuração de `salon-secretary-runtime.ts`, remover módulo/testes novos
e a variável do exemplo/local. Preservar integralmente as alterações anteriores
do worktree e todos os artefatos históricos. Nenhum rollback de banco é necessário.
Não remover GPT-6; rollback temporário de modelo continua sendo a variável
`SALON_SECRETARY_MODEL=gpt-5.6-luna`.
