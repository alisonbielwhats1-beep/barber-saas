# Gate 2.3 — Scheduling Actions

## Auditoria prévia

Base de implementação: worktree service-create-mvp, branch codex/service-create-mvp,
HEAD 9b92138; Gates anteriores locais preservados. Sem chamadas reais à OpenAI.
R5 confrontada com código, não com comportamento hipotético de aceite.

- R5 §7.2: T05/T06 localizam; T13 propose_appointment_reschedule,
  T14 propose_appointment_cancel, T15 propose_schedule_block. T16/T21/T23 fora.
- `src/lib/reschedule-proposals.ts:163`: requestStaffReschedule é a entrada real
  da equipe. Cliente com conta: **move imediatamente** pelo executor existente,
  cria RescheduleProposal PENDING e evento RESCHEDULE_REQUESTED. Horário novo
  fica reservado, origem liberada; aceite posterior não move novamente.
  Cliente sem conta: remarcação direta. Secretária deve retornar estado real,
  incluindo PENDING_ACCEPTANCE, sem anunciar aceite do cliente.
- `src/lib/appointment-service.ts:1059`: rescheduleAppointment usa versão,
  locks Appointment→Professional→Resource, snapshots históricos de serviço/preço,
  preserva recursos físicos e produz evento/outbox. Não recalcular preço de catálogo
  ao mover apenas horário. Fila existente pode ocupar a origem liberada.
- `src/lib/appointment-service.ts:1392`: cancelAppointmentReliably exige motivo
  da equipe com pelo menos três caracteres, versão, início futuro e estado ativo;
  preserva histórico, cancela propostas pendentes e registra evento/outbox.
  Cancelamento STAFF **não promove fila automaticamente**, ao contrário de CLIENT.
- `src/app/(admin)/agenda/actions.ts:297`: cancelamento OWNER/MANAGER.
  Remarcação também permite recepção; acesso PROFESSIONAL próprio existe na agenda,
  mas não é acrescentado à Secretária neste gate.
- `src/app/(admin)/agenda/availability-actions.ts:49`: bloqueio OWNER/MANAGER ou
  profissional próprio, intervalo validado por availabilityOccurrences; motivo
  opcional. Permite sobrepor reservas e operar fora do expediente, preservando-as.
  Reutilizar esse executor via extração mínima, sem segunda regra de bloqueio.
- `prisma/sql/manual/019_product_depth.sql:218`: product_update_resources precisa
  acompanhar remarcação/cancelamento. Ausente no descartável do Gate 2.2.
- Enum real: PENDING/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED/NO_SHOW.
  PENDING_ACCEPTANCE será estado do recibo da Secretária, não novo status Prisma.

## Banco autorizado

Preflight identificou exatamente 127.0.0.1:55441/everflair_service_mvp e diretório
everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data. RLS/FORCE já existentes.
Usuário autorizou explicitamente ajuste local delimitado: grants necessários aos
executores e função/trigger product_update_resources existente, com backup/rollback.
Admin somente administração/fixtures; runtime mvp_service_runtime sem bypass.
Sem grant Product; operações com produtos anexos serão recusadas neste recorte
antes da proposta, evitando ampliar Inventory. Sem SQL remoto ou migration inteira.

## Implementação e contratos

| R5 | Contrato real | Implementação |
|---|---|---|
| T05/T06 | Localizar reserva ativa futura por cliente/data/hora/profissional/serviço; máximo 50 registros, escolha explícita em ambiguidade | `scheduling-mutations.ts:31`, catálogo existente |
| T07 | Disponibilidade com snapshots históricos e cada recurso físico da reserva; alternativas consultadas em intervalos de 15 min, até 5 | `scheduling-mutations.ts:62`, `inspectAppointmentAvailabilityWithServiceSnapshots` |
| T13 | `appointment.change`: appointment_ref resolvida pelo servidor + date/time destino | `proposeSchedulingAction`, `requestStaffReschedule` |
| T14 | `appointment.cancel`: appointment_ref + reason real com mínimo 3 caracteres | `proposeSchedulingAction`, `cancelAppointmentReliably` |
| T15 | `schedule.block`: professional_ref + date/time/end_time; end_date e reason opcionais | `proposeSchedulingAction`, `executeAvailabilityBlock` |

Entrada do modelo: nomes, seletores de data e horas. `source_*` é a origem da
remarcação; `date/day_offset/weekday/time` é o destino. O modelo nunca fornece
refs. Se apenas a nova hora for informada, o backend preserva a data da origem
resolvida. Datas relativas viram absolutas com `resolveSchedulingDate` no fuso
autorizado. Não existe mudança de serviço/profissional neste recorte.

U03 recebe campos resolvidos, mantém draft_ref/revisão e usa o mesmo journal.
`action_snapshot` congela origem/destino, versão, cliente, profissional,
snapshots históricos de serviços/preço/processamento, recursos, situação de
aceite e resumo/hash da fila; no bloqueio, congela também reservas atingidas.
T13/T14/T15 recebem `{draft_ref,draft_revision}` e retornam proposta real com
`proposal_ref`, hash, revisão, validade e preview. Confirmar recebe
`{proposal_ref,draft_revision}` pelo fluxo autenticado existente.

A confirmação usa `confirmJournalAction`; nenhuma inferência. Revalida papel
inclusive no replay, tenant, autor, revisão/hash/validade, snapshot e
disponibilidade. Executores e locks existentes continuam responsáveis por
eventos/outbox, fila e exclusões PostgreSQL. Recibo pode conter:
`RESCHEDULED`, `PENDING_ACCEPTANCE`, `CANCELLED` ou `BLOCKED`, referência real
e `duplicate`. O endpoint histórico `confirmAppointmentCreate` foi ampliado
internamente para despachar operações do journal, preservando seus consumidores.

## Diferenças e limites de produto

- R5 é adaptada ao domínio implantado: remarcação com conta aplica o novo horário
  imediatamente e depois solicita aceite. Não é uma reserva temporária sem efeito.
- Cancelamento da equipe exige motivo. Por isso a frase sem motivo abre um draft
  incompleto, em vez de inventar uma justificativa.
- Bloqueio sobreposto não cancela reservas: mostra quantas/quais são atingidas
  e preserva todas, seguindo a agenda existente. Fim 00:00 usa o dia seguinte.
- A fila pode ser promovida automaticamente na origem liberada pela remarcação;
  cancelamento STAFF preserva a fila. São efeitos do executor existente.
- OWNER/MANAGER: três ações; RECEPTIONIST: remarcação. PROFESSIONAL próprio
  continua no domínio da agenda, mas não foi introduzido na Secretária.
- Produtos anexados ou dependentes são recusados antes da proposta. Não há
  autorização para expandir Inventory/dependentes neste Gate.
- Uma reserva por ação e um profissional por bloqueio. Sem recorrência,
  exceção de jornada, overbooking, mudança de serviço/profissional,
  desbloqueio, expediente ou lote dependente.
- Sessões continuam locais ao processo; reinício expira conversa. Journal e
  recibos continuam persistentes. Não há promessa de suporte distribuído.

## Continuidade, fast-path e telemetria

`secretary-fast-path.ts` aceita somente quando há um campo pendente inequívoco,
sem candidatos nem proposta ativa. Exemplos: `11h`, `11:15`, `11h15`,
`45 minutos`, `amanhã`. Intervalo completo, texto com comandos adicionais,
horas inválidas e expressões vagas não entram. `amanhã` passa pelo mesmo
resolvedor de timezone. Duração passa pelo mesmo limite 5–600 do domínio.
Cliente/profissional/serviço nunca são resolvidos por esse parser.

Ambiguidade usa o modelo fake/real configurado no mesmo Agent, sem roteador
adicional. `MODEL` é registrado na telemetria de usage; `DETERMINISTIC_FAST_PATH`
em `SECRETARY_LATENCY`, com parsing, `model_avoided=true`, zero requests e custo
de modelo zero. Não se cria registro falso de tokens/provedor. Usage ausente
das chamadas do modelo continua null/UNKNOWN; reasoning não é somado duas vezes.

Métricas existentes ampliadas com localização de agendamento e parsing:
interpretação, Customers, Services, profissional, disponibilidade, proposta,
mensagem e confirmação→commit. A latência `message` mede coordenação/interpretação
no backend; não inclui transporte HTTP, renderização do navegador nem toda a
persistência posterior da própria telemetria.

Uma amostra local comparável (mesmo destino/proposta):

| Continuação | Parsing/interpretação | Disponibilidade | Preparação/revalidação de proposta | Total backend | Inferências adicionais |
|---|---:|---:|---:|---:|---:|
| `11h`, fast-path | 0,054 ms | 13,55 ms | 32,53 ms | 55,30 ms | 0 |
| `às onze em ponto`, modelo fake | 6,45 ms | 13,01 ms | 31,67 ms | 60,22 ms | 1 |

A amostra não mede Luna nem permite projetar economia de segundos ou reais.
Economia comprovada: uma chamada evitada por continuação que satisfaz o contrato.
Confirmações continuam com zero chamadas. Sem preços/tarifas assumidos.

## Registry e segurança

Scheduling v1.1.0, com T13/T14/T15. Services/Customers preservados. Descoberta usa
o catálogo compacto e uma Function Tool `select_capabilities`; continuação usa
somente manual selecionado e `upsert_action_draft`. Capacidade no Registry não
concede acesso: servidor revalida por operação. Auxiliares T01/T03/T04 não
carregam manuais inteiros de outras Skills. U01 continua com IDs publicados,
hash/versionamento e deduplicação.

Agent normal, mesmo SDK/Runner, maxTurns=1, store=false, retries=0,
tracingDisabled=true, traceIncludeSensitiveData=false. Nenhuma hosted tool,
container, Shell, MCP, busca web/file, SandboxAgent ou novo Agent. Os sete
agentes internos do CRM não foram alterados.

Todos os testes funcionais usam mvp_service_runtime, NOBYPASSRLS/NOSUPERUSER.
Admin somente preflight/backup/ACLs autorizadas/fixtures sintéticas. DTOs e
contexto do modelo não incluem hashes de senha, identificadores de autenticação
ou credenciais. A consulta interna de aceite retorna apenas boolean ao snapshot.

## Arquivos deste Gate

Novos:
- `src/lib/availability-block-domain.ts` — executor extraído da ação existente;
- `src/lib/scheduling-mutations.ts` — adaptadores do domínio, snapshots e preview;
- `src/lib/secretary-fast-path.ts`;
- `scripts/setup-scheduling-actions-mvp-access.ts`;
- `scripts/complete-gate23-guest-access.ts` — somente os dois INSERTs finais;
- `src/lib/__tests__/secretary-scheduling-actions.integration.test.ts`;
- `src/lib/__tests__/secretary-fast-path.test.ts`;
- este relatório.

Alterados:
- `packages/salon-secretary/src/scheduling-skill.ts`, `skill-registry.ts`;
- `src/lib/scheduling-contract.ts`, `scheduling-actions.ts`, `scheduling-catalog.ts`;
- `src/lib/secretary-scheduling.ts`, `salon-secretary.ts`, `salon-secretary-usage.ts`;
- `src/app/(admin)/agenda/availability-actions.ts`;
- `src/app/(admin)/servicos/secretaria/actions.ts`, `secretary-chat.tsx`;
- testes `secretary-scheduling.test.ts`, `secretary-scheduling.integration.test.ts`,
  `salon-secretary-ui.test.tsx`, `secretary-customers.integration.test.ts`,
  `service-create-mvp.integration.test.ts`, `salon-secretary.integration.test.ts`.

Os testes de regressão foram adaptados ao banco compartilhado dos Gates:
SELECT de vínculo/conta agora é autorizado internamente; escrita desses campos
continua proibida pelo contrato. Contagens de clientes/agenda dos testes Services
agora são restritas aos seus próprios salões de fixture, não ao banco inteiro.
Nenhuma alteração preexistente em outros arquivos deve ser atribuída a este Gate.

## Validação executada — 21/09/2026

- `npm run lint`: passou.
- `npx tsc --noEmit --incremental false`: passou.
- `npm test`: 228 arquivos, 1.285 testes passaram (sem suites PostgreSQL).
- Reteste direcionado dos contratos/fast-path/usage/actions/UI: 5 arquivos,
  44 testes passaram após os últimos ajustes.
- PostgreSQL, role runtime: **7 arquivos, 95 testes passaram, nenhum ignorado**
  na validação final após os dois grants adicionais explicitamente autorizados.
  Inclui os 21 testes de Scheduling Actions e regressões dos Gates anteriores.
- `npm run build`: passou com segredo NextAuth sintético somente no processo;
  nenhum ajuste persistente em NEXTAUTH_SECRET. Build final repetido após
  revisão de timezone/contratos: passou.
- Schema-smoke local: RLS/FORCE, privilégios por coluna, ausência de privilégio
  Product, role NOSUPERUSER/NOBYPASSRLS, trigger SECURITY INVOKER e constraints
  exercitados. Job remoto/schema-smoke completo não foi executado: sem CI,
  container, push ou deploy nesta rodada.

Cobertura inclui A–U: propostas sem escrita operacional prematura; conflito
antes/depois da proposta; disputas por profissional e recurso físico; estado de
aceite; cancelamento/replay/eventos/outbox; localização ausente/ambígua; bloqueio
com impacto e intervalo faltante; acesso entre salões; revisão; preservação da
fila no cancelamento STAFF; promoção de cliente registrado; fast-path e fallback;
Regressão Core/Registry/Services/Customers e isolamento dos pedidos compostos.

### Pendência administrativa resolvida

O caso de convidado revelou o SQL real do Prisma:
`INSERT ClientProfile (id,salonId,name,phone,phoneNormalized,sessionVersion,gender,createdAt)`.

O usuário autorizou exclusivamente INSERT(sessionVersion, createdAt) no descartável,
complementando INSERT(gender). Aplicação por mvp_test_admin via
`scripts/complete-gate23-guest-access.ts`, após conferir host/porta/database/diretório,
backup completo e ACLs. Apenas dois GRANTs foram aplicados, sem novas policies,
objetos, tabelas ou privilégios adicionais.

SQL do Prisma capturado durante o teste com runtime:

```sql
INSERT INTO "public"."ClientProfile"
("id","salonId","name","phone","phoneNormalized","sessionVersion","gender","createdAt")
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
RETURNING "public"."ClientProfile"."id";
```

Todas essas colunas já possuem o INSERT autorizado; RETURNING id utiliza SELECT
preexistente. Não houve necessidade de outro privilégio, sequence ou função.
O teste de promoção de convidado passou: reserva original remarcada; convidado
criado/promovido na origem liberada; confirmação repetida não duplica a promoção.
Cancelamento STAFF mantém fila sem promoção, como antes.

Grants finais efetivos de ClientProfile para mvp_service_runtime:

| Privilégio | Colunas |
|---|---|
| SELECT | authIdentityId, email, id, mergedIntoId, name, passwordHash, phone, phoneNormalized, salonId, userId |
| INSERT | createdAt, email, gender, id, name, phone, phoneNormalized, salonId, sessionVersion |
| UPDATE | email, name, phone, phoneNormalized |
| DELETE | Nenhum |

Sem INSERT irrestrito de tabela; sem UPDATE em sessionVersion/createdAt.
Leitura interna de conta previamente autorizada permanece fora do DTO/modelo.
Runtime reconfirmada com rolsuper=false e rolbypassrls=false. ClientProfile com
RLS=true, FORCE RLS=true e tenant_isolation USING/WITH CHECK salonId=app_current_salon().
Comparação de todas as policies e flags RLS antes/depois: idênticas.

Evidências locais: %TEMP%/gate23-approved-postgres.log (95/95),
%TEMP%/gate23-prisma-columns.log (SQL acima), %TEMP%/gate23-approved-unit.log.
Sem pendência administrativa restante para o Gate 2.3. Validação linguística
real de T13/T14/T15 permanece futura, dependente de nova autorização.

Nenhuma chamada OpenAI, nenhum dado real; `SALON_SECRETARY_ALLOW_PAID_CALLS=false`.

## Rollback

Não executar reset/clean: vários arquivos aprovados dos Gates anteriores ainda
não estão versionados. Backup anterior em `%TEMP%/everflair-gate23-before`.
Restaurar somente arquivos alterados por este Gate e retirar os novos acima;
reverter também a adição do campo MODEL na telemetria se desejado. Preservar
drafts, recibos, histórico e dados dos Gates anteriores.

ACLs e trigger: cada execução do bootstrap salva dump completo, estado de ACLs/
policies, applied.sql e rollback.sql, revogando apenas privilégios adicionados
naquela execução. Aplicar rollback na ordem inversa, somente no descartável,
com autorização; não restaurar dump por cima de dados posteriores silenciosamente.
Diretórios aplicados: `%TEMP%/everflair-gate23-backup-1789971417620` e
`%TEMP%/everflair-gate23-backup-1789972029331`; complemento final em
`%TEMP%/everflair-gate23-guest-defaults-1789980494473` (before.dump,
security-before.json, grants-after.json, applied.sql e rollback.sql).

## Validação real recomendada depois de aprovação

1. Remarcar cliente com conta para horário livre, conferir o texto de aceite
   pendente e a proposta; confirmação apenas se explicitamente autorizada.
2. Cancelar com motivo e localizar uma reserva ambígua sem escolha arbitrária.
3. Bloquear período incompleto, responder com hora exata e verificar que a
   continuação não chama Luna; comparar expressão vaga com fallback.

Não repetir Gate 2.2, não habilitar novas Skills. Nenhuma chamada real neste Gate.
