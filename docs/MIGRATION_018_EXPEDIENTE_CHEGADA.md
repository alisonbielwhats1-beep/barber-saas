# Migration 018 — expediente extra e chegada

Escopo autorizado: validação no GitHub com dados fictícios. Não autoriza execução produtiva.

## Comportamento

- `ProfessionalOpening`: expediente adicional de um profissional em uma data local.
  Une intervalos adjacentes/sobrepostos à jornada semanal; fechamentos e ausências
  continuam prevalecendo. A agenda, a consulta pública, a criação/remarcação e o
  denominador de ocupação usam a mesma disponibilidade.
- OWNER/MANAGER podem adicionar ou remover, com motivo, lock por profissional,
  validação de tenant e auditoria. Remover preserva as reservas e exige revisão.
- `Appointment.checkedInAt/checkedInById`: chegada registrada por OWNER/MANAGER/
  RECEPTIONIST, no dia local da reserva, antes do atendimento. Confirmação da
  reserva permanece independente. Grava o horário do servidor, atualiza versão
  e registra auditoria; repetição simultânea preserva a primeira chegada.
- Remarcação limpa a chegada da ocorrência anterior; a auditoria permanece.
  Cancelamentos preservam o registro. A tela Hoje mostra chegada e minutos
  aguardando somente enquanto o atendimento não começou.

## Inventário e execução

Tabela nova `ProfessionalOpening`, índice tenant/profissional/data, FK composta
profissional/tenant, checks de data/minutos/motivo, RLS ENABLE/FORCE e policy de
tenant. Duas colunas nullable em Appointment; nenhum backfill infere chegada.

1. Identificar banco e ambiente; executar barreira `npm run db:safety-check`.
2. Backup e restauração de conferência em banco isolado.
3. Executar `018_openings_checkin.preflight.sql` somente leitura.
4. Aplicar `018_openings_checkin.sql`.
5. Executar `018_openings_checkin.verify.sql`, comparar dados anteriores e testar
   as jornadas com dados fictícios.

O schema-smoke parte do schema do commit d665f44, faz seed sintético com o cliente
Prisma anterior, backup/restore, aplica duas vezes e compara os registros completos
de Salon, User, Professional, ClientProfile, Appointment, WorkingHours, TimeOff e
AuditLog. Testa RLS com role NOSUPERUSER NOBYPASSRLS, ausência de tenant,
escrita cruzada e vínculo de profissional de outro estabelecimento.

## Rollback

Promover o código anterior e manter tabela/colunas inertes. O código antigo não
consulta a tabela separada, portanto não confunde as aberturas com jornada semanal.
O SQL de rollback não remove dados. Exclusão de schema exigiria exportação e nova
autorização. Reservas feitas em expediente extra continuam visíveis na agenda.

## Limites

Evidência de banco: run GitHub Actions `34059744513`, commit `10055ef`.
Backup/restauração, preflight, duas aplicações, preservação, constraints, RLS e
testes PostgreSQL aprovados. A ambiguidade no seletor detectada no navegador
foi corrigida. Run `34060782156` (`b78aa88`) passou integralmente, incluindo as
três jornadas autenticadas e todos os rollbacks. Capturas em `browser-evidence`
com dados fictícios. O ajuste posterior de captura espera o fim da transição
de tema; conferir os checks do PR #79 para resultados de cada versão.

Sem promoção produtiva. Codespace `glorious-enigma-jjv6v4rvrv49f544r` documentado
como demonstração, mas a credencial gh desta sessão não tem escopo codespace.
GitHub Actions é descartável por job e não atualiza automaticamente a demonstração.
Recorrência, edição de séries, recursos físicos e demais frentes continuam no
documento de evolução. O formulário desta etapa usa intervalos dentro do mesmo dia.
