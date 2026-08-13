# Hardening operacional de tenant e estoque

Esta onda não aplica migration nem altera Production.

Estado em 13/08/2026: implementação local na branch
`codex/commercial-maturity-wave1`, aprovada em crítica independente de código e
testes locais, mas ainda pendente de CI remoto, Preview seguro e deploy.

`AppointmentProduct` ainda não carrega `salonId`. A RLS existente herda o
tenant pelo `Appointment`, porém a chave estrangeira atual não consegue provar
que o `Product` pertence ao mesmo estabelecimento. A correção definitiva no
banco exige migration aditiva, preflight em banco descartável/homologação,
rollback e autorização explícita.

Até essa etapa, toda criação de reserva de produtos passa por
`reserveAppointmentProducts`, que verifica na mesma transação:

1. o agendamento pertence ao `salonId` ativo;
2. cada produto pertence ao mesmo `salonId` e está ativo;
3. o estoque é suficiente sob lock canônico;
4. o vínculo e o movimento negativo são gravados atomicamente.

O arquivo
`prisma/sql/preflight/appointment_product_tenant_integrity.sql` é somente
leitura e deve retornar zero vínculos cross-tenant e zero órfãos antes de uma
futura migration. Ele não deve ser executado em Production como teste.

## Dívida explícita do recibo

O recibo usa o `Payment` persistido e os snapshots de preço/quantidade de
`AppointmentService` e `AppointmentProduct`. O schema atual, porém, não
preserva o nome do produto nem a moeda no instante do pagamento: o nome ainda
vem do catálogo atual e a moeda vem da configuração atual do estabelecimento.
Persistir `productName` e `currency` como snapshots financeiros exige mudança
aditiva de schema e backfill definido. Isso fica deliberadamente pendente até
haver staging, preflight, rollback e autorização de migration.

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
- cancelamento pela equipe encerra a fila ativa daquele atendimento sem
  realocação automática.

Os testes PostgreSQL de concorrência estão ligados ao `schema-smoke`, junto do
teste de lock `APPROVED` versus suspensão. Como a máquina local não possui
PostgreSQL/Docker, a evidência de execução dessas integrações permanece
obrigatoriamente pendente no CI.
