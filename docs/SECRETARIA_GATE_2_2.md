# Gate 2.2 — Scheduling Core

## Auditoria antes da implementação

Base preservada: `codex/service-create-mvp`, `9b92138`, Gates 1/2.1 e Customers.
Somente banco descartável; `SALON_SECRETARY_ALLOW_PAID_CALLS=false`.

- `prisma/schema.prisma:1162`: Appointment exige salonId, clientId,
  professionalId, serviceId, startAt/endAt e preço. Guarda timezone, versão,
  origem e chave/fingerprint de idempotência; FKs compostas protegem tenant.
- `src/lib/appointment-service.ts:282`: serviço ativo e ProfessionalService
  ligado a profissional ativo do mesmo salão são obrigatórios. Serviço salvo
  sem vínculo continua válido no catálogo, mas não é agendável.
- `src/lib/appointment-service.ts:359`: jornada semanal + aberturas por data,
  pausas, fechamento do salão, TimeOff, reservas ativas e buffer. Intervalos são
  semiabertos. PENDING/CONFIRMED/IN_PROGRESS ocupam; finalizados/cancelados não.
- `src/lib/appointment-service.ts:541`: timezone e horário civil pelo módulo
  time; preço vigente por data via pricing; recursos e ofertas da fila também
  bloqueiam. Duração/processamento/finalização são snapshots do domínio.
- `src/lib/visit-scheduling.ts:84,235,410`: loadVisitDay/findVisitPlan/createVisit
  reutilizam as regras, cotação e locks operacionais. Não criar motor paralelo.
- `src/lib/appointment-service.ts:692`: executor serializa profissional e chave
  de idempotência, reavalia disponibilidade e limites, cria CONFIRMED, snapshots,
  eventos e notificações INTERNAS na mesma transação. Nenhuma entrega WhatsApp.
- `src/lib/appointment-events.ts:66`: outbox interno é efeito necessário do
  executor existente; não desligar eventos para contornar permissões.
- `src/app/(admin)/agenda/actions.ts:113`: OWNER/MANAGER/RECEPTIONIST e
  PROFESSIONAL podem criar; profissional somente sua agenda/clientes permitidos.
  Secretária já restringe acesso aos três primeiros: este gate não amplia isso.
- `docs/VISITAS_MULTIPROFISSIONAIS_2026-09-13.md`: profissional único pode ser
  atribuído automaticamente; várias opções requerem escolha neste recorte.
- `prisma/sql/manual/008_fase2_appointment_reliability.sql`: proteção de tenant,
  idempotência e exclusão de sobreposição. RLS das dependências precisa ser
  conferida no descartável antes dos testes, não reaplicada em produção.

## Mapeamento R5 e limites deliberados

Documento R5 §§6.1/7.2: T01 search_salon_customer já existe; T03 list_services,
T04 list_professionals, T05 list_appointments, T06 get_appointment,
T07 get_availability e T12 propose_appointment_create são os IDs deste recorte.
T08 e T13–T16/T21–T23 não serão publicados. Bloqueios são consultados internamente
pelo motor existente, sem Tool nova para editar ou inspecionar todo o domínio.

R5 propõe permissões abstratas e unidades; implementação usa Membership/salonId.
Neste core: um cliente existente, um serviço e um profissional por reserva;
sem convidados novos implícitos, dependentes, séries, pacotes ou vendas anexas.
O domínio administrativo permite exceções/encaixes e agendamentos passados;
este core não oferece exceções e exige início futuro. Janela pública de 60 dias
não será aplicada como se a Secretária fosse o aplicativo público.
Preços FROM permanecem indicativos, sem se tornarem preço fixo.
Não haverá remarcação, cancelamento de reserva ou alteração de expediente.

## Implementação entregue

Operações publicadas: `appointment.create`, `appointment.list`,
`appointment.read`, `availability.get`. Registry agora publica somente Services,
Customers e Scheduling. Nenhum agente interno de CRM foi alterado.

O mesmo Agent e coordenador dos gates anteriores foram estendidos. Na primeira
mensagem, seleção e interpretação são uma inferência, com catálogo resumido;
U01 carrega somente os manuais selecionados, com versão/hash. Continuação usa
somente o manual da operação pendente. Scheduling reutiliza T01 internamente,
sem carregar o manual Customers só para resolver cliente. U02/U03 e as demais
capacidades determinísticas continuam no backend: carregar um manual não concede
acesso nem instala Tools arbitrárias no Agent.

O payload do Agent tem uma Function Tool: `select_capabilities` na descoberta ou
`upsert_action_draft` na continuação. Ela entrega interpretação estrita ao
coordenador; não é acesso direto ao Prisma. `maxTurns=1`, zero retries,
`store:false`, tracing desabilitado. Confirmação usa zero inferências.
Evidência: `packages/salon-secretary/src/index.ts:23`, `:58`, `:64`;
`packages/salon-secretary/src/skill-registry.ts:11`, `:33`, `:66`.

### Contratos e handlers

| ID | Entrada validada | Saída/efeito |
|---|---|---|
| U02 | operação publicada | Campos realmente necessários; sem defaults inventados |
| U03 | patch, draft_ref/revisão quando existente | Mesmo draft, merge preservando omitidos, estado/faltantes; não cria Appointment |
| T01 reutilizada | nome do cliente | DTO mínimo e telefone mascarado para seleção |
| T03 | busca textual de serviço ativo | id/nome/duração/preço/tipo; tenant autenticado |
| T04 | serviço resolvido e/ou nome do profissional | id/nome de profissionais ativos, vínculo real quando filtrado por serviço |
| T05 | data absoluta e filtros opcionais resolvidos | Agenda do dia, DTO limitado, até 50 resultados |
| T06 | appointment_ref selecionado no backend/UI | Detalhe mínimo autorizado, horários locais/UTC, status e revisão |
| T07 | service_ref, professional_ref, data, hora/período opcional | Plano/cotação real ou ausência; até cinco alternativas reais |
| T12 | draft_ref + draft_revision READY | Proposta congelada, hash, prazo, revisão e preview |
| Confirmação existente adaptada | proposal_ref + draft_revision | Recibo real/appointment_ref, duplicate quando repetida |

Contratos: `src/lib/scheduling-contract.ts:6`, `:14`;
handlers de leitura: `src/lib/scheduling-catalog.ts:17`, `:23`, `:38`, `:67`, `:77`;
rascunho/proposta/confirmação: `src/lib/scheduling-actions.ts:43`, `:63`, `:76`.
Erros específicos incluem `PRO_SERVICE_MISMATCH`, `SLOT_CONFLICT`,
`SCHEDULE_CHANGED`, `APPOINTMENT_NOT_FOUND`, `SELECTION_INVALID`,
`AMBIGUOUS_DATE`, além dos erros de autorização/revisão do journal existente.

### Campos e resolução

Criação exige cliente, serviço e profissional resolvidos, data e hora exata.
Preço, duração, início/fim, timezone e regra de processamento/finalização vêm do
domínio. Agenda/leitura exige data; disponibilidade exige serviço, profissional
e data. Telefone, e-mail ou profissional arbitrário não são inventados.

O modelo só pode fornecer nomes, data explícita, day_offset, weekday, hora ou
período. Schema estrito recusa refs, preço/duração e operação fora do Registry.
Backend converte data relativa usando `Salon.timezone`; a data absoluta é mantida
no draft. Dois seletores de data são rejeitados. Período não vira hora presumida.

Cliente e serviço são resolvidos em paralelo, em transações tenant separadas.
Zero resultados informa ausência; ambiguidade apresenta opções reais e requer
seleção. Mais de 20 opções exige busca mais específica. Seleção revalida o registro
e mantém o mesmo draft. Profissional explicitamente inelegível não é substituído
silenciosamente. Um único elegível pode ser resolvido; vários exigem escolha.
Evidência: `src/lib/secretary-scheduling.ts:20`, `:74`, `:90`.

### Disponibilidade, proposta e confirmação

T07 chama `loadVisitDay/findVisitPlan`, considerando jornadas, pausas, aberturas
por data, closures, TimeOff, buffer, reservas, recursos e ofertas vigentes.
Nenhuma agenda alternativa foi criada. Serviço/profissional/recurso inativo falha.
A grade de sugestões usa 15 minutos, no mesmo dia, até cinco opções posteriores
ao horário solicitado; o horário pedido pode ter qualquer minuto válido.

U03 registra apenas draft no AuditLog existente. READY não escreve Appointment.
T12 reconsulta o domínio e congela cliente/serviço/profissional, revisão do serviço,
cotação, data absoluta, horário, timezone e preço. A UI mostra proposta separada
por operação e confirmação autenticada. Cancelar operação descarta a proposta,
sem implementar cancelamento de agendamento.

Confirmação reutiliza `confirmJournalAction` e `createVisit`. Reautoriza,
revalida revisão/expiração/hash/referências/cotação/disponibilidade, trava o
profissional, mantém locks de catálogo, executa e guarda recibo na transação.
O motor existente usa locks operacionais e constraints para profissional/recurso.
Se outra reserva ocupar o horário, falha sem criar conflito. Repetição devolve o
mesmo appointment_ref e `duplicate=true`. Evidência:
`src/lib/scheduling-actions.ts:76`, `src/lib/salon-secretary.ts:267`.

Pedidos compostos têm estados/drafts/proposals separados por operação, no mesmo
coordenador. Três Skills independentes foram testadas sem mistura de referências
ou escrita prévia. Não existe transação global ou dependência automática entre
“criar um cliente” e “agendar esse novo cliente”. Scheduling exige cliente existente.

## Banco local e segurança

Alvo reconfirmado antes de fixtures/DDL:
`127.0.0.1:55441/everflair_service_mvp`, cluster nativo
`C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data`.
APP_ENV=test; fixtures novas sintéticas, sem login/dado real. Aplicação e testes
funcionais: `mvp_service_runtime`, sem superuser/BYPASSRLS. Administração/fixtures:
`mvp_test_admin` somente no descartável, conforme duas autorizações explícitas.

O preflight encontrou dependências sem RLS/grants e ausência de proteções de
concorrência do domínio. Foi aplicado somente o recorte autorizado de objetos
versionados de 008/018/019/023, não as migrations inteiras:

- RLS/FORCE + policies tenant em AppointmentService/AppointmentEvent,
  ProfessionalOpening, WaitlistOffer, ResourceBooking e PhysicalResource.
- SELECT nas dependências de consulta da agenda; INSERT em Appointment,
  AppointmentService, AppointmentEvent e NotificationOutbox.
- ResourceBooking: INSERT nas seis colunas usadas pelo trigger; UPDATE apenas
  startAt/endAt/active/retired para o ON CONFLICT do trigger existente.
- `appointment_no_overlap`, `resource_no_overlap`, extensão btree_gist;
  funções existentes `product_reserve_resource` e `booking_offer_guard`, triggers
  necessários à criação em Appointment/AppointmentService/ResourceBooking.
- Funções SECURITY INVOKER; sem DELETE, sem UPDATE Appointment, sem bypass de RLS.
  Não foram instalados fluxos de atualização/cancelamento de recursos.

Script reproduzível: `scripts/setup-scheduling-mvp-access.ts`. Exige flag de
autorização administrativa explícita, paid=false e valida host/porta/database/
diretório reais. Backup completo via pg_dump antes da mudança, ACLs/policies e SQL:
`C:/Users/USURIO~2/AppData/Local/Temp/everflair-scheduling-backup-1789968906570`.
Arquivos: `before.dump`, `security-before.json`, `applied.sql`, `rollback-access.sql`.

Autorização de Scheduling preserva OWNER/MANAGER/RECEPTIONIST, salão aprovado,
Membership e contexto withTenant. Selecionar Skill não concede papel. DTOs usam
select explícito; não incluem passwordHash/credenciais/objeto bruto de clientes.
RLS positivo e negativo, ausência de contexto e referências cross-tenant foram
testados com runtime. O serviço Massagem do salão demo permaneceu R$60/60min;
o histórico real de usage permaneceu em nove chamadas anteriores.

## Manual versionado

Manual final: `packages/salon-secretary/src/scheduling-skill.ts:29`.
Scheduling v1.0.0 publica apenas os quatro intents deste core, usa nomes como
seletores, exige resolução no backend, preserva draft, exige seleção diante de
ambiguidade e proíbe inventar referência, valor, duração ou disponibilidade.
Explica datas relativas, período sem hora presumida, preço FROM, confirmação e
conflito. Proíbe remarcação/cancelamento/bloqueios/expediente e Skills privadas.
U01 registra hash/versionamento pelo mecanismo já existente.

## Arquivos deste gate

Criados:

- `packages/salon-secretary/src/scheduling-skill.ts`
- `src/lib/scheduling-contract.ts`
- `src/lib/scheduling-catalog.ts`
- `src/lib/scheduling-actions.ts`
- `src/lib/secretary-scheduling.ts`
- `src/lib/__tests__/secretary-scheduling.test.ts`
- `src/lib/__tests__/secretary-scheduling.integration.test.ts`
- `scripts/setup-scheduling-mvp-access.ts`
- `docs/SECRETARIA_GATE_2_2.md`

Adaptados, preservando Gates anteriores:

- `packages/salon-secretary/src/index.ts` e `skill-registry.ts`
- `src/lib/service-contract.ts` e `salon-secretary.ts`
- `src/app/(admin)/servicos/secretaria/actions.ts`, `secretary-chat.tsx`, `page.tsx`
- `src/test/secretary-capability-plan.ts`
- `src/lib/__tests__/secretary-registry.test.ts` e `salon-secretary-ui.test.tsx`

Sem alteração em schema Prisma, migrations versionadas, domínio operacional
existente, sete agentes CRM, API key/projeto/billing ou configuração produtiva.
Há vários arquivos pré-existentes não commitados no worktree; a lista acima é
deste gate, não equivale ao git status inteiro.

## Validação sem OpenAI

- `npm run lint`: passou.
- `npx tsc --noEmit --incremental false`: passou.
- `npm run build`: passou, incluindo `/servicos/secretaria`. Usou banco local,
  API keys vazias e NEXTAUTH_SECRET sintético apenas no processo. A primeira
  tentativa encontrou DLL Prisma ocupada pelos testes Windows; após seu término,
  a repetição do build passou sem alteração de código/configuração persistente.
- `npm test -- --maxWorkers=2`: 227 arquivos, 1.267 testes passaram; depois foi
  acrescentado um teste de UI Scheduling e validado na rodada direcionada abaixo.
- Rodada final direcionada: seis arquivos, **54 testes passaram**:
  Scheduling unitário (3), Scheduling PostgreSQL (17), Registry PostgreSQL (7),
  Customers PostgreSQL (10), Services change PostgreSQL (10), interface (7).
- PostgreSQL cobre A–P: proposta/zero-before/one-after, conflito/alternativas,
  cliente/serviço ausente ou ambíguo, elegibilidade, campos faltantes/mesmo draft,
  cross-tenant, proposta obsoleta, concorrência, repetição e composição de 3 Skills.
- Corrida entre profissionais distintos pelo mesmo recurso físico: somente uma
  confirmação vence. Recursos, TimeOff, fechamento e jornada usam domínio real.
- Verificação local de schema: RLS/FORCE/policies, FKs tenant, duas exclusões e
  funções/triggers invoker. **Não equivale à execução do job CI schema-smoke**:
  esse job usa PostgreSQL em container e não foi disparado neste trabalho local.
- Agent mockado; fetch proibido no teste Scheduling; zero chamadas à OpenAI.
- UI testada em jsdom, inclusive seleção/confirmar por operation_ref e recibo real
  do backend simulado. Não foi realizado novo login/browser E2E neste gate.

Comando final direcionado (ambiente protegido do descartável):

```text
npx vitest run src/lib/__tests__/secretary-scheduling.test.ts src/lib/__tests__/secretary-scheduling.integration.test.ts src/lib/__tests__/secretary-registry.integration.test.ts src/lib/__tests__/secretary-customers.integration.test.ts src/lib/__tests__/service-change.integration.test.ts src/lib/__tests__/salon-secretary-ui.test.tsx --maxWorkers=1
```

### Latência observada

Instrumentação persiste SCHEDULING_TIMINGS no AuditLog com session_id, operação
e durações; sem prompt, conversa, telefone ou secrets. Usage continua no recorder
existente, sem somar reasoning duas vezes.

Amostra da rodada final, SDK fake + PostgreSQL local (ms): interpretação 37,60;
cliente 10,68; serviço 41,77; profissional 7,90; disponibilidade 70,69;
proposta 26,19; mensagem/coordenador 192,75; confirmação até retorno do commit 71,15.
Não são percentis nem latência real de Luna/browser. Cliente/serviço rodam em
paralelo; durações de etapas não devem ser somadas como tempo total. Em composto,
interpretação compartilhada não deve ser contada mais de uma vez.

## Limitações e aceite posterior

- Um serviço/profissional por agendamento; cliente/serviço precisam existir.
- Somente data única nas leituras; sem paginação extensa, séries ou intervalo aberto.
- Desambiguação inequívoca via opções autenticadas da UI; sem escolha arbitrária
  pelo modelo. Datas/hora ambíguas precisam de esclarecimento.
- Sem override/encaixe ou marcação passada; sugestões limitadas ao mesmo dia.
- Sem PROFISSIONAL na Secretária, embora exista no domínio administrativo.
- Sessões e pedidos compostos mantêm as limitações do Gate 2.1; sem execução
  dependente/global. Infraestrutura não foi refeita.
- Sem remarcação, cancelamento de Appointment, bloqueios/expediente, Financial,
  Inventory, Communication, WhatsApp, voz, deploy ou produção.
- Integração real Luna de Scheduling ainda NÃO validada. Próxima autorização
  recomendada: (1) criação com referências únicas, (2) falta serviço e continuação,
  (3) horário ocupado e alternativas, (4) ambiguidade de cliente. Começar somente
  com propostas, sem confirmação, e limitar inferências por mensagem.

## Rollback

Desabilitar Scheduling no Registry e reverter somente os arquivos/adaptações
deste gate, preservando os Gates aprovados e alterações pré-existentes. Cópias
dos arquivos anteriores estão em `%TEMP%/everflair-gate22-before` (o helper de
testes capability-plan tem apenas ajuste adicional de mapping).

No banco local, `rollback-access.sql` retira o acesso adicionado por este gate,
mantendo dados, RLS e proteções. Não executar contra outro banco nem como rotina
de runtime. Restauração integral do before.dump, se necessária, requer nova
aprovação explícita e banco descartável identificado; não desativar RLS nem
apagar histórico para desfazer o código. Nenhum rollback foi aplicado.

Encerramento: cluster descartável iniciado para a validação foi parado via
pg_ctl, com identificação do diretório/PID antes da parada. Nenhum servidor web
foi iniciado. `SALON_SECRETARY_ALLOW_PAID_CALLS=false` reconfirmado em .env.local;
zero chamadas OpenAI, nenhum container/hosted tool, nenhum push/deploy.
