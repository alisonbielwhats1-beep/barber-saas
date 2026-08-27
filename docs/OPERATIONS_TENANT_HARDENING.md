# Hardening operacional de tenant e estoque

O hardening tenant-aware foi aplicado no Supabase Production em 22/08/2026,
após preflight somente leitura e autorização explícita.

Estado em 22/08/2026: a migration manual `012` foi aplicada com backfill,
constraints compostas, snapshots de nome/moeda e RLS tenant-aware. A fase `013`
também foi aplicada com os cinco índices operacionais.

O preflight produtivo retornou zero vínculos cross-tenant, zero órfãos e zero
pagamentos sem salão. A verificação posterior confirmou as colunas como `NOT
NULL`, RLS habilitada e forçada, policy baseada em `app_current_salon()` e
nenhuma linha sem snapshot.

Mesmo com a defesa estrutural aplicada, toda criação de reserva de produtos passa por
`reserveAppointmentProducts`, que verifica na mesma transação:

1. o agendamento pertence ao `salonId` ativo;
2. cada produto pertence ao mesmo `salonId` e está ativo;
3. o estoque é suficiente sob lock canônico;
4. o vínculo e o movimento negativo são gravados atomicamente.

Os arquivos `prisma/sql/manual/012_appointment_product_tenant_snapshots.*` e
`prisma/sql/manual/013_operational_query_indexes.*` permanecem versionados como
registro, preflight e rollback não destrutivo. Não reaplicar migrations
manuais já confirmadas em Production.

## Snapshot do recibo

O recibo usa o `Payment` persistido e os snapshots de preço/quantidade de
`AppointmentService` e `AppointmentProduct`. A migration 012 também preserva
`productName` e `currency` no momento da reserva/recebimento, sem transformar o
recibo interno em documento fiscal.

## Fronteiras operacionais desta candidata

- locks seguem a ordem canônica `appointment → professional → product`;
- criação pública e reserva de produtos compartilham transação e fingerprint;
- comanda reconcilia reserva e quantidade final, movimentando apenas o delta;
- cancelamento devolve reserva no máximo uma vez;
- ajuste manual, reserva, venda e devolução registram saldo anterior/novo em
  `AuditLog`;
- fechamento idempotente confirma status, estoque, pagamento e auditoria de
  forma atômica;
- `IN_PROGRESS`, `COMPLETED` e recebimento antes de `startAt` falham fechados;
- cancelamento pela equipe preserva a fila ativa daquele atendimento sem
  realocação automática; dono/gerente podem promover explicitamente a primeira
  posição após nova checagem de disponibilidade.

Os testes PostgreSQL de concorrência estão ligados ao `schema-smoke`, junto do
teste de lock `APPROVED` versus suspensão. Como a máquina local não possui
PostgreSQL/Docker, a evidência de execução dessas integrações permanece
obrigatoriamente pendente no CI.
