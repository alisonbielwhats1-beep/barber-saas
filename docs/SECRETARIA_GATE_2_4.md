# Gate 2.4 — Scheduling Batch

Implementação local sobre `9b92138ec7665342b60e1ddc210f04ccfa611c84`, branch
`codex/scheduling-batch`, worktree `service-create-mvp`. Alterações dos Gates
anteriores preservadas. Não implantado. Zero chamadas reais à OpenAI.

## Auditoria R5 e domínio

R5, §§6.1, 7.2/T21 e 10.1: `propose_action_batch`, operação lógica
`action.batch`, itens tipados, dependências explícitas, estado projetado e
atomicidade local. T21 não significa executar qualquer Tool ou habilitar
Communication. Este recorte implementa apenas `all_or_nothing` com duas ações:
`appointment.cancel → appointment.create` no horário liberado.

Evidências da implementação real auditada antes da alteração:

- `src/lib/appointment-service.ts:1392`: cancelAppointmentReliably recebe `Tx`,
  bloqueia appointment/profissional, valida versão/status/início futuro, exige
  motivo STAFF e preserva Appointment. Atualiza status/versão/metadados, cancela
  pedidos de remarcação pendentes e grava evento/outbox na mesma transação.
- `src/lib/appointment-service.ts:1573`: só cancelamento CLIENT promove fila
  automaticamente. STAFF preserva a fila. O batch mantém STAFF, sem promoção
  paralela nem alteração de regra de fila.
- `src/lib/visit-scheduling.ts:413`: createVisit recebe `Tx`, idempotencyKey e
  quote, bloqueia profissional, reconstrói o plano e chama createAppointment.
  Preços/duração vêm do catálogo/preço por data; itens são snapshots do domínio.
- `src/lib/appointment-service.ts:692`: createAppointment revalida relações,
  disponibilidade, limites, recursos e insere Appointment/AppointmentService,
  AppointmentEvent e NotificationOutbox. Não há chamada externa no executor.
- `src/lib/visit-scheduling.ts:78,239`: loadVisitDay/findVisitPlan consideram
  jornada, aberturas, fechamentos, TimeOff, buffer, reservas, recursos e ofertas
  da fila. O novo adaptador usa esse mesmo motor.
- `src/lib/scheduling-mutations.ts:41`: snapshot recusa produtos anexos e
  dependentes; congela versão, serviços históricos, recursos e fila.
- `src/lib/secretary-journal.ts:33`: confirmJournalAction já centraliza
  autorização, journal lock, revisão/hash, prazo e replay do recibo.
- `src/lib/prisma-tenant.ts:99`: withTenant fornece UMA transação com GUCs
  locais; cancelamento e criação recebem exatamente esse mesmo objeto Tx.

Diferenças/decisões delimitadas: motivo do cancelamento continua obrigatório;
a frase de exemplo sem motivo abre um draft incompleto. Não inventar motivo
nem copiar o serviço de Amanda. O profissional novo precisa ser elegível e,
neste Gate, ser o mesmo da reserva liberada; vários elegíveis exigem seleção.
Criação nova mantém o status real CONFIRMED do executor. Não é remarcação de
cliente com conta e não reutiliza indevidamente PENDING_ACCEPTANCE.

## Contratos e representação

- U01: Scheduling v1.2.0, T21 acrescentada às capacidades existentes.
- U02: `getOperationRequirements("action.batch")` / batchRequirements.
- U03: `upsertBatchDraft({plan,draft_ref?,expected_revision?})` usa o mesmo
  actionJournal/AuditLog; não cria tabelas nem segundo mecanismo de confirmação.
- T01/T03/T04/T05/T06/T07: consultas e resolução já aprovadas.
- T21: `proposeActionBatch({draft_ref,draft_revision})`, proposta única.
- Confirmação: `confirmActionBatch({proposal_ref,draft_revision})`, por
  confirmSecretaryOperation → contexto autenticado → withTenant. Zero modelo.
- T12/T14: executores do domínio reutilizados; não criar duas propostas
  individuais confirmáveis para um plano dependente.

Exemplo estrutural, chaves `a`/`b` locais ao plano, nunca IDs do banco:

```json
{
  "execution_policy": "all_or_nothing",
  "items": [
    {"key":"a","operation":"appointment.cancel","depends_on":[],
     "fields":{"customer_name":"Amanda","time":"10:00","reason":"Motivo informado"}},
    {"key":"b","operation":"appointment.create","depends_on":["a"],
     "released_slot_of":"a","fields":{"customer_name":"Fábio","service_name":"Corte masculino"}}
  ]
}
```

O backend acrescenta refs depois de resolver os candidatos autorizados. Schema
de interpretação não aceita refs, tenant, SQL ou Tools. `batch_ref` é o UUID
do draft específico do lote, também exposto como draft_ref para reutilizar o
journal; batch_revision é a mesma revisão. Proposal e receipt têm UUIDs próprios.
Recibo contém resultado/referência real por item e duplicate.

`scheduling-batch.ts:26` valida nós únicos, referências de dependência, ciclos,
limite máximo **2**, ordena topologicamente e depois aceita somente o padrão
cancel→create. Ordem do array não concede dependência. Estrutura de grafo é
extensível, mas aumentar o limite exige implementar/testar outros padrões.

## Estado projetado e proposta

`assess` resolve ambos os clientes com T01 em Promise.all, resolve reserva,
serviço e profissional, verifica referências anteriores contra candidatos
atuais e produz NEEDS_INPUT, BLOCKED ou READY. Homônimos nunca são escolhidos
arbitrariamente; a interface oferece candidatos mínimos por item.

Após validar a origem cancelável, `schedulingSnapshot` consulta disponibilidade
com uma projeção interna `{releasedAppointmentId}`. `loadVisitDay` exclui
somente essa Appointment e seus ResourceBooking da leitura projetada. Todos
os outros compromissos, ofertas, bloqueios, recursos e regras permanecem.
Nenhum UPDATE/savepoint/rollback experimental é usado para simular a vaga.
`createVisit` na confirmação faz uma leitura normal, sem projeção.

T21 revalida o plano inteiro e apresenta uma única proposta: cancelamento
antes, novo atendimento depois, motivo, profissional, preço, início/fim e
timezone reais, fila preservada e dependência explícita. Uma criação mais
longa que invada o próximo atendimento é bloqueada.

## Atomicidade, revisão e concorrência

`confirmActionBatch` usa confirmJournalAction dentro de withTenant:

1. Revalida tenant, ator e papel OWNER/MANAGER, inclusive em replay.
2. Bloqueia o batch, confere revisão/hash/prazo e busca recibo anterior.
3. Bloqueia o appointment/profissional na ordem do domínio. Protege leitura de
   serviço/cliente com FOR SHARE, usando permissões existentes.
4. Resolve e valida novamente TODO o plano projetado. Compara snapshot da
   origem, fila/recursos, cotação, versões de serviço/cliente/profissional/recurso.
5. Chama executeSchedulingMutation → cancelAppointmentReliably.
6. Chama createVisit → createAppointment, sem mudar suas regras.
7. Grava recibo e commit único. Qualquer exceção desfaz as duas operações,
   eventos, outbox, recursos e recibo.

Constraints/triggers de recursos e sobreposição existentes continuam sendo a
última barreira concorrente. Duas confirmações do mesmo batch retornam o mesmo
receipt_ref, uma com duplicate=true. Dois batches diferentes disputando o mesmo
recurso físico deixam só um vencedor; o original do perdedor é preservado.

Não há compensação externa a implementar: o fluxo só usa escritas PostgreSQL.
NotificationOutbox é gravada atomicamente pelo domínio; consumo/entrega segue
o mecanismo existente, depois do commit. Nenhum worker de entrega foi acionado
nestes testes; latência de entrega não foi medida e não é declarada zero.

## Conversa e Progressive Disclosure

O Agent único interpreta intenção e dependências na mesma inferência inicial
`select_capabilities`. Apenas Scheduling é carregada; Customers/Services são
resolutores internos mínimos, não manuais adicionais. Continuação usa a mesma
fábrica de Agent, manual Scheduling e uma Function Tool upsert_action_draft
com schema de patch por item_key. `scheduling-batch` é um modo de interpretação
do mesmo Agent, não outra Skill publicada ou outro Agent.

Operações independentes anteriores continuam em seus cartões e confirmações
individuais. Um batch aparece em um único cartão com “Confirmar alterações”.
Cada continuação altera só um item; grafo, draft_ref, operação e campos dos
outros itens permanecem. Nova revisão invalida proposta antiga.

O fast-path existente é consultado apenas com um campo pendente inequívoco e
sem candidatos. Nome de serviço/cliente não ganha parser determinístico: a
resposta “Corte masculino” usa interpretação fake/real autorizada. Não se
promete economia de inferência para nomes. Confirmação sempre usa zero.

## Segurança e banco

Preflight real: 127.0.0.1:55441/everflair_service_mvp, cluster
`C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data`.
Branch codex/scheduling-batch, commit-base 9b92138.
RLS/FORCE em Appointment, AppointmentService, AppointmentEvent,
NotificationOutbox, ResourceBooking, ClientProfile e AuditLog confirmados.
Runtime mvp_service_runtime: rolsuper=false e rolbypassrls=false.
Admin foi usado somente em identificação/fixtures sintéticas e leitura de
evidências. Todos os executores/testes funcionais usaram runtime com withTenant.
Nenhum GRANT, policy, constraint, trigger, função ou migration foi alterado.

Agent/Runner normais, store=false, maxTurns=1, retries=0, tracing desabilitado.
Uma Function Tool por inferência. Sem container, hosted tools ou CRM interno.
Credenciais, projeto, billing e hard limit não alterados.

## Arquivos deste incremento

Criados:
- src/lib/scheduling-batch.ts
- src/lib/secretary-batch.ts
- src/lib/__tests__/scheduling-batch.test.ts
- src/lib/__tests__/scheduling-batch.integration.test.ts
- docs/SECRETARIA_GATE_2_4.md

Alterados sobre o estado local aprovado:
- packages/salon-secretary/src/index.ts
- packages/salon-secretary/src/skill-registry.ts
- packages/salon-secretary/src/scheduling-skill.ts
- src/lib/salon-secretary.ts
- src/lib/scheduling-actions.ts
- src/lib/scheduling-catalog.ts
- src/lib/scheduling-contract.ts
- src/lib/service-contract.ts
- src/lib/visit-scheduling.ts (três adições para projeção de leitura)
- src/app/(admin)/servicos/secretaria/secretary-chat.tsx
- src/lib/__tests__/salon-secretary-ui.test.tsx

O git status inclui muitas mudanças de Gates anteriores ainda não commitadas;
não são atribuídas a este incremento. Não houve push/PR/deploy.

## Testes e métricas

- Unitários de T21: 11 testes de grafo/limite/ciclo/refs/merge/SDK/Registry.
- PostgreSQL T21: 16 testes, incluindo rollback após executar efetivamente a
  segunda ação, evento/outbox/recursos sem resíduos, fila STAFF preservada,
  cliente/serviço/profissional inválidos, continuidade, revisão, autorização,
  seleção, recurso reconfigurado, disputa de dois batches pelo mesmo recurso,
  duração que invade reserva seguinte e revisão concorrente de cliente.
- UI: proposta única, confirmação única e recibo sem inferência.
- PostgreSQL final: 8 arquivos, **119 testes passaram**. Regressões Services,
  Customers, Registry, Scheduling Core/Actions/temporal somente com fakes.
- Suíte geral: 230 arquivos, **1.317 testes passaram**.
- Lint, TypeScript e build: passaram. Build gerou /servicos/secretaria; segredo
  NextAuth sintético usado somente no processo, sem alteração persistente.

Comandos: npm run lint; npx tsc --noEmit --incremental false;
npm test -- --maxWorkers=2; npm run build.
Integração: npx vitest run scheduling-batch.integration.test.ts e as sete
suítes dos Gates anteriores, com caminhos em src/lib/__tests__, maxWorkers=1,
RUN_SERVICE_MVP_INTEGRATION=1 e URLs locais validadas pelo helper.
Fetch proibido nos testes novos. Nenhuma chamada paga ou repetição linguística.

Amostra persistida de fake + PostgreSQL local, ms (não são percentis de Luna):

| Etapa | Tempo |
|---|---:|
| Interpretação fake/SDK | 6,34 |
| Grafo | 0,05 |
| Resolução de entidades | 20,46 |
| Disponibilidade projetada | 17,40 |
| Pré-validação total | 44,78 |
| Proposta com revalidação | 43,59 |
| Interpretação + coordenação até proposta | 97,53 |
| Confirmação até retorno de commit | 99,31 |
| Corpo transacional interno | 92,38 |

Etapas aninhadas não são somáveis. Message não mede rede/browser nem persistência
posterior da telemetria. Confirmation_commit inclui limites da transação; não
isola fsync PostgreSQL. Métricas em BATCH_TIMINGS, BATCH_VALIDATED e BATCH_EXECUTED.
Usage por inferência reutiliza o recorder existente, sem duplicar reasoning.
Não há estimativa de custo real de modelo baseada nos fakes.

## Limitações e rollback

Somente cancel→create, duas ações, um serviço/profissional por nova reserva,
mesmo profissional/instante inicial da origem, sem produtos/dependentes,
overbooking, overrides, batch financeiro ou entrega externa. Plano FREE e
demais limites operacionais são rechecados pelo executor na transação: uma
falha nunca deixa cancelamento parcial. Sessões continuam locais ao processo.
Proposta não reserva vaga; a confirmação pode falhar se o estado mudar.
Não se afirma serialização universal de todos os editores legados de configuração.

Rollback: restaurar somente arquivos deste Gate pelas cópias em
`%TEMP%/everflair-gate24-before`, remover os dois módulos e testes novos,
retirar o teste T21 acrescentado à suíte de UI e o export batchRequirements
acrescentado a scheduling-contract.ts. Preservar mudanças anteriores, journal,
recibos e dados. Não usar git reset/clean. Nenhum rollback de schema necessário.
Não foi executado rollback.

## Validação Luna futura, dependente de nova autorização

1. Cancelar + substituir com entidades inequívocas e motivo explícito: verificar
   um plano/uma proposta, sem confirmar inicialmente.
2. Mesmo padrão sem serviço novo: perguntar, responder “Corte masculino” e
   conferir mesmo batch e cancelamento ainda não executado.
3. Um caso de serviço incompatível: plano bloqueado, zero ações.

SALON_SECRETARY_ALLOW_PAID_CALLS=false. Zero chamadas reais. Não avançar para
Financial nem iniciar testes reais automaticamente.

Encerramento: rodada direcionada final com 38 testes/3 arquivos aprovada após
os últimos ajustes. Cluster local iniciado nesta execução foi encerrado por
pg_ctl, com diretório e PID previamente identificados. Nenhum servidor web
foi iniciado; interface validada em jsdom, sem novo E2E no navegador.
Flag paga false reconfirmada em .env.local. Nenhum push/deploy.
