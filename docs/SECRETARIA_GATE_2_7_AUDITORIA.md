# Gate 2.7 — Communication: auditoria inicial e decisão autorizada

Status atualizado: o responsável autorizou o ajuste local descrito abaixo e o
ajuste mínimo do contrato/prompt Communication. Implementação e testes locais
concluídos; resultados, limitações e rollback em `SECRETARIA_GATE_2_7.md`.
Zero chamadas OpenAI e zero mensagens externas. Branch `codex/communication-core`,
worktree `service-create-mvp`, base `9b92138ec7665342b60e1ddc210f04ccfa611c84`;
alterações anteriores preservadas. As seções seguintes registram o preflight e
a proposta ANTERIORES à autorização, não o estado final do banco.

## Evidências do domínio atual

| Área | Evidência | Comportamento encontrado |
|---|---|---|
| Outbox | `prisma/schema.prisma:1361` | Uma tabela existente, payload JSON, destinatário, template, status, attempts, nextAttemptAt, sentAt, readAt e lastError. eventId e appointmentId obrigatórios. |
| Integridade | `prisma/schema.prisma:1382` | FKs compostas com salonId para AppointmentEvent e Appointment. Deduplicação por eventId/recipientKey/channel/template. |
| Canais/status | `prisma/schema.prisma:449` | INTERNAL, EMAIL, MANUAL_WHATSAPP; PENDING, SENT, FAILED. Não existem WHATSAPP/provider, DELIVERED ou READ como estados do enum. readAt é leitura interna, não webhook WhatsApp. |
| Enqueue existente | `src/lib/appointment-events.ts:68` | Evento e notificações na mesma transação. Lock/idempotencyKey do evento; destinatários deduplicados. |
| Notificação interna | `src/lib/appointment-events.ts:111` | INTERNAL nasce SENT porque a própria persistência entrega o aviso interno. Não reutilizar essa equivalência para canal externo. |
| WhatsApp atual | `src/lib/whatsapp.ts:1`, `src/app/(admin)/agenda/actions.ts:555` | Link manual wa.me; marcação manual de lembrete grava MANUAL_WHATSAPP/SENT. Não comprova entrega por provider. |
| E-mail | `src/lib/mailer.ts:37` | ResendMailer faz fetch externo. Não conectar ao Gate 2.7. |
| Interface interna | `src/app/(admin)/notificacoes/page.tsx:20` | Filtra INTERNAL e USER autenticado, assume relação appointment obrigatória. Opcionalidade futura exige ajuste de tipos defensivo, preservando filtros. |
| Leitura | `src/app/(admin)/notificacoes/actions.ts:10` | updateMany restrito ao destinatário/tenant/canal para readAt. Esse campo não representa leitura WhatsApp. |
| Clientes | `src/lib/customer-catalog.ts:10` | OWNER/MANAGER/RECEPTIONIST em salão aprovado. T01 retorna candidatos limitados e telefone mascarado; T02 possui seleção explícita sem autenticação/secrets. |
| Telefone | `src/lib/phone.ts:32`, `src/lib/phone.ts:51` | Normalização BR nacional e validação DDD/estrutura; número do destinatário deve vir do backend, não do modelo. |
| Consentimento | `src/lib/client-care-profile.ts:47` | consentGiven autoriza dados de cuidados/alergias/preferências. Não equivale a opt-in WhatsApp. |
| Cancelamento | `src/lib/scheduling-mutations.ts:124`, `src/lib/appointment-service.ts:1392` | Executor existente revalida snapshot/locks/revisão e exige motivo. Cancelamento da equipe preserva fila sem promoção automática. |
| Confirmação | `src/lib/secretary-journal.ts:29` | Journal compartilhado oferece lock/revisão/hash/recibo idempotente na transação. Reutilizar. |
| Política de produto | `docs/DECISOES_PRODUTO.md:361` | Outbox interna, WhatsApp manual e falha de comunicação não desfaz negócio. |

A busca no caminho atual de aplicação não encontrou worker de despacho da
NotificationOutbox, adapter Meta, webhook WhatsApp, templates aprovados Meta,
janela de conversa ou política de opt-in/opt-out de mensagens. Campos de retry
existem, mas sua existência não comprova processamento/retry externo.
Webhooks de billing e os sete agentes internos HQ não pertencem a este escopo.

## Revisão 5 e contratos a reutilizar

Fonte: Revisão 5 anexada, seção 6.5 e fichas 7.2; texto extraído localmente em
`%TEMP%/everflair-r5.txt`, linhas 443–484, 785–808 e 913–938.

- T01: pesquisa autorizada de cliente, já existente.
- T10 `get_customer_message_context`: contexto mínimo, contato mascarado,
  finalidade/fato e requisitos de canal. No Gate, elegibilidade exclusivamente
  para simulação local; não afirmar elegibilidade Meta real.
- T11 `get_message_status`: estado persistido, erro sanitizado, tentativa e
  vínculo à ação. Não inventar entrega/leitura.
- T20 `propose_customer_message`: operação R5 `customer.message`, draft/revisão,
  preview e confirmação. EXACT/GENERATED conforme solicitação atual.
- T21 `propose_action_batch`: ampliar somente o caso explícito
  appointment.cancel → customer.message, reutilizando executor de cancelamento.
  Dependência não resolvida jamais vira duas ações independentes.
- U01/U02/U03 e Registry existentes, sem habilitar Communication antes dos testes.

A R5 descreve política oficial de canal, templates, conexão, janela e limites.
Esses mecanismos não estão implementados no domínio atual; permanecem fora
da elegibilidade real. Não usar consentimento de cuidados como autorização de
mensagem nem chamar o mailer existente para simular envio.

## Preflight local somente leitura

Executado com `mvp_service_runtime`, transações `BEGIN READ ONLY … ROLLBACK`.
Destino confirmado por SQL: `127.0.0.1:55441/everflair_service_mvp`.
Cluster iniciado explicitamente de
`C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data`,
conferido também em postmaster.pid. Consulta SQL a data_directory foi negada
à runtime; nenhum privilégio foi concedido para contornar isso.

- Runtime: rolsuper=false, rolbypassrls=false.
- NotificationOutbox: RLS=true, FORCE RLS=true.
- tenant_isolation: USING e WITH CHECK `salonId = app_current_salon()`.
- ACL atual: SELECT e INSERT em todas as 18 colunas; nenhum UPDATE/DELETE.
- eventId/appointmentId: NOT NULL, FKs presentes.
- Índices existentes, inclusive NotificationOutbox_delivery_key, presentes.
- Nenhum trigger de aplicação na Outbox.
- `.env.local`: SALON_SECRETARY_ALLOW_PAID_CALLS=false.

## Alteração mínima proposta no preflight — posteriormente autorizada/aplicada

Mensagem individual avulsa não tem Appointment/Event legítimos. Criar reservas
ou eventos fictícios, reutilizar um evento alheio ou guardar uma segunda fila
no AuditLog distorceria o domínio. A proposta é adaptar a Outbox existente.

Escopo solicitado exclusivamente para o banco descartável acima:

1. Acrescentar `WHATSAPP` ao enum NotificationChannel; não reaproveitar
   MANUAL_WHATSAPP como envio automático. O único provider implementado será fake,
   restrito a ambiente local/teste, sem rede.
2. Tornar `eventId` e `appointmentId` opcionais, preservando as FKs existentes.
3. Acrescentar CHECK que mantém ambos obrigatórios nos canais legados e permite
   ambos ausentes somente em WHATSAPP. Não permitir par parcialmente preenchido.
4. Conceder somente UPDATE(status, attempts, nextAttemptAt, lastError, updatedAt)
   à runtime em NotificationOutbox, além do SELECT/INSERT já existente. Sem
   UPDATE de conteúdo/destinatário, DELETE ou privilégios em outras tabelas.
5. Não criar nova tabela, função, trigger, policy ou outro índice. Idempotência
   da mensagem avulsa usa ID estável derivado da proposta e PK existente, além
   do lock/recibo do journal; não depende da unicidade com eventId nulo.

SQL apresentado para revisão; aplicado depois da autorização pelo script
`scripts/setup-communication-mvp-access.ts` exclusivamente no descartável:

```sql
ALTER TYPE "NotificationChannel" ADD VALUE 'WHATSAPP';
-- O novo enum precisa estar committed antes da constraint abaixo.
BEGIN;
ALTER TABLE "NotificationOutbox"
  ALTER COLUMN "eventId" DROP NOT NULL,
  ALTER COLUMN "appointmentId" DROP NOT NULL;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_context_check"
  CHECK (("eventId" IS NOT NULL AND "appointmentId" IS NOT NULL)
    OR (channel = 'WHATSAPP' AND "eventId" IS NULL AND "appointmentId" IS NULL));
GRANT UPDATE (status, attempts, "nextAttemptAt", "lastError", "updatedAt")
  ON "NotificationOutbox" TO mvp_service_runtime;
COMMIT;
```

Admin seria usado somente no ajuste autorizado, backup/rollback e fixtures
sintéticas. Testes funcionais exclusivamente runtime. Preservar RLS/FORCE,
policies, plano FREE e fixtures anteriores. Nenhum SQL remoto/produção.

## Desenho proposto após autorização

- Conteúdo EXACT extraído da mensagem original por intervalo verificado;
  comparação exata, sem trim/normalização do conteúdo. Ausência/ambiguidade do
  trecho exige esclarecimento. GENERATED só quando explicitamente solicitado,
  final revisável; hash do preview vinculado à proposta/revisão.
- Dados de contato resolvidos somente pelo backend e revalidados na confirmação.
  Nenhum telefone no contexto de interpretação; candidatos mascarados.
- Conteúdo aprovado fica em payload autorizado da Outbox; drafts/propostas
  seguem armazenamento tenant-scoped existente. Telemetria técnica somente
  refs/hash/tamanhos/erros sanitizados, nunca corpo completo ou telefone.
- Negócio + intenção de mensagem na mesma transação; provider somente após commit.
  Falha posterior grava FAILED/tentativa, preserva cancelamento concluído.
- PENDING representa fila. Fake bem-sucedido registra simulação explicitamente;
  não fabrica SENT/DELIVERED/READ externos. Fake com falha usa FAILED. Recibo de
  enqueue não significa entrega. Nenhum worker automático externo neste Gate.
- Cancelamento exige permissões/regras atuais e motivo; mensagem ao mesmo
  cliente do agendamento. Contradições/dependências não suportadas bloqueadas.
- T11 só lê mensagens autorizadas da capacidade; sem objetos brutos.
- Repetição de confirmação retorna recibo existente sem novo enqueue/dispatch.

## Backup, validação e rollback propostos

Antes do ajuste: exportar schema, ACLs, enum/policies/constraints e linhas da
Outbox local; registrar contagens e hash. Interromper se estado divergir do
preflight. Validar preservação integral de linhas e objetos de segurança.

Rollback de aplicação: desabilitar Communication e provider fake, preservar
histórico. Restaurar ACLs exatas do backup. Reverter NOT NULL somente quando não
restarem mensagens avulsas; nunca apagar mensagens para conseguir rollback.
O valor aditivo WHATSAPP pode permanecer inerte no enum: não reconstruir enum
nem remover dados automaticamente. Rollback estrutural completo exige revisão
do backup e autorização se houver registros novos.

Validação planejada neste preflight: mocks A–T, PostgreSQL runtime com fixtures
positivas A/B, concorrência/idempotência, falha pós-commit, regressões gerais,
lint/TypeScript/build e verificação de schema local. A execução e os resultados
finais estão registrados em `SECRETARIA_GATE_2_7.md`. Nenhum teste pago repetido.
