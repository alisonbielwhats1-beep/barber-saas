# Fase 2 — agenda confiável

Atualizado em 05/08/2026.

## Estado da entrega

O código da Fase 2 está na branch `codex/fase-2-agenda-confiavel` e **não foi
aplicado em Production**. Nenhum banco Supabase remoto foi aberto, nenhuma
migration remota foi executada e nenhum deploy foi promovido.

A promoção continua condicionada a quatro gates:

1. CI completo, inclusive PostgreSQL 16 descartável e teste de concorrência;
2. preflight sem anomalias sobre uma cópia de dados em homologação;
3. smoke das jornadas em Preview com variáveis exclusivas de homologação;
4. validação de um dono/gerente com dados de demonstração.

## Política de tempo

- o estabelecimento possui um timezone IANA, por exemplo
  `America/Sao_Paulo`;
- data e hora escolhidas pelo usuário são enviadas como hora civil, sem o
  navegador inventar um offset;
- o servidor interpreta essa hora no fuso do estabelecimento;
- instantes são persistidos e transportados em UTC (`timestamptz`);
- agenda, dashboard, cliente, histórico e notificações formatam com as mesmas
  funções centrais;
- horários inexistentes ou ambíguos numa mudança de DST falham fechados;
- correções manuais como “subtrair três horas” são proibidas.

O caso de regressão principal está automatizado: 10:00 em
`America/Sao_Paulo` vira o instante 13:00Z e volta a aparecer como 10:00 em
todas as apresentações que usam a política central.

## Núcleo transacional do agendamento

As operações críticas passam por `src/lib/appointment-service.ts`:

- criação;
- remarcação;
- cancelamento;
- transição de status;
- criação originada pela lista de espera.

O servidor recalcula duração e preço a partir dos serviços pertencentes ao
tenant. Cada atendimento preserva snapshots ordenados dos serviços, preços e
durações. A remarcação mantém o mesmo `appointment_id`, incrementa a versão e
grava um evento imutável com os valores anterior e novo.

Cancelamento altera o status, preserva a linha, registra ator/motivo/data,
libera o intervalo e restaura estoque associado no máximo uma vez. O cliente
só pode cancelar ou remarcar o próprio atendimento, em status permitido,
antes do início e dentro da política do estabelecimento.

Se o cancelamento parte do cliente e o intervalo ainda respeita jornada,
folga, fechamento, buffer e conflitos, o primeiro item válido da fila pode ser
confirmado automaticamente. Cancelamento do estabelecimento não realoca a
vaga, pois normalmente indica que o horário não deve ser ocupado.

## Proteção contra conflito e corrida

### Interface

- disponibilidade ocupada não é oferecida;
- botões entram em processamento e não aceitam clique duplicado;
- drag-and-drop é apenas um atalho de desktop;
- touch abre o fluxo explícito de remarcação;
- a posição antiga não é substituída otimisticamente antes da confirmação
  do servidor.

### Servidor

- valida tenant, cliente, profissional, serviços, jornada, folgas, pausas,
  bloqueios, antecedência e buffer;
- usa transação e advisory lock por profissional;
- remarca sob lock do atendimento e do intervalo novo;
- usa chave de idempotência e fingerprint do pedido;
- uma mesma chave com payload diferente é rejeitada;
- falha na remarcação preserva integralmente o horário anterior.

### Banco

A migration usa exclusion constraint GiST por tenant, profissional e
`tstzrange(startAt, endAt, '[)')`. Assim, dois intervalos ativos comuns não
podem se sobrepor, mas um atendimento que termina às 10:00 permite outro que
começa às 10:00.

Overbooking deliberado continua desativado no fluxo público. Dono e gerente
podem criar um encaixe sobreposto somente após conflito real, confirmação e
motivo; o registro recebe `isOverbooked` e trilha de auditoria. Fechamento,
folga e horário fora da jornada não são ignorados por esse mecanismo.

## Histórico e notificações

`AppointmentEvent` registra de forma append-only:

- atendimento e tenant;
- tipo do evento;
- valor anterior e novo;
- tipo/id do ator;
- motivo;
- correlação;
- idempotência e fingerprint;
- data de criação.

`NotificationOutbox` deduplica por evento, destinatário, canal e template.
Novo agendamento, remarcação, cancelamento, status e lembrete produzem
notificação interna conforme o destinatário. A notificação inclui data/hora
no fuso do estabelecimento; remarcação mostra valor anterior e novo.

Falha de entrega não reverte um agendamento confirmado. Nesta fase funciona a
caixa interna automática e permanece o botão manual de WhatsApp. Nenhum canal
pago foi adicionado. O cron existente gera lembretes idempotentes.

## Consistência entre telas

Depois de uma mutação, as rotas invalidam agenda, dashboard, financeiro e
layout do cliente. As telas visíveis usam um fallback de atualização a cada 30
segundos. Essa decisão evita expor credencial privilegiada no navegador e
evita subscriptions duplicadas enquanto o Realtime seguro por tenant ainda
não estiver configurado e medido.

## Mobile e acessibilidade

- o cliente possui botões explícitos de remarcar e cancelar;
- a remarcação funciona sem drag-and-drop;
- a barra de ação da reserva é fixa, respeita `safe-area-inset-bottom` e tem
  espaço equivalente no conteúdo rolável;
- os alvos principais têm ao menos 44 px;
- os cards da agenda são acionáveis por teclado e expõem rótulos semânticos;
- conflitos retornam mensagem clara sem apagar visualmente a reserva original.

## Permissões aplicadas

- dono/gerente: agenda completa e módulos de gestão/financeiros previstos;
- recepção: operação da agenda, clientes e marketing, sem relatórios ou
  custos globais;
- profissional: própria agenda, clientes ligados aos próprios atendimentos,
  catálogo sem custo/margem e próprio portfólio;
- profissional não abre dashboard global, financeiro, relatórios, produtos,
  pacotes, marketing ou configurações por URL direta;
- menus desktop, mobile e busca rápida consomem a mesma matriz central;
- notificações filtram tenant, destinatário e canal interno.

O consumo de pacote foi removido do papel profissional enquanto não estiver
ligado atomicamente a um atendimento próprio. Isso evita que um id conhecido
permita consumir saldo de qualquer cliente.

## Migration e preflight

Arquivos:

- `prisma/sql/manual/008_fase2_appointment_reliability.preflight.sql` — somente
  leitura;
- `prisma/sql/manual/008_fase2_appointment_reliability.sql` — mudança aditiva;
- `prisma/sql/manual/008_fase2_appointment_reliability.rollback.sql` — rollback
  não destrutivo.

O preflight inventaria volume, intervalos inválidos, conflitos legados,
timezones IANA e tipos das colunas. Qualquer linha nas consultas de anomalia
interrompe o rollout; não se corrige dado automaticamente.

A migration:

- preserva os instantes legados tratando `timestamp without time zone` como
  UTC, conforme o comportamento histórico do Prisma neste projeto;
- converte apenas colunas que ainda não são `timestamptz`, evitando dupla
  conversão;
- adiciona campos, snapshots, eventos, outbox, índices e constraints;
- adiciona chaves estrangeiras compostas com `salonId` no Appointment e nas
  estruturas de histórico, bloqueando associações cross-tenant no banco;
- habilita e força RLS nas novas tabelas;
- revoga acesso de `anon` e `authenticated`;
- mantém DML do runtime apenas quando o papel `app_runtime` existir.

### Ordem segura de rollout

1. confirmar ambiente de homologação e URL de banco exclusiva;
2. criar backup nativo verificável da homologação;
3. executar o preflight somente leitura e arquivar as contagens;
4. aplicar a migration na homologação;
5. executar schema smoke, testes PostgreSQL e jornadas de demonstração;
6. comparar agenda, dashboard, cliente, notificação e histórico;
7. somente depois abrir uma janela separada para decidir rollout de Production.

Esta branch não autoriza o passo 7.

### Rollback

Em falha funcional, reverter primeiro o código para a versão anterior. O SQL
de rollback restaura a forma compatível da constraint e **preserva** colunas,
snapshots, eventos e notificações. Remover essas estruturas destruiria
histórico e não faz parte do rollback.

## Estratégia de testes

### Unitários

- timezone, round-trip e DST;
- duração, preço, início/fim e intervalo `[início, fim)`;
- política do cliente e transições de status;
- idempotência, cancelamento, notificação e escopo profissional;
- segurança estática da migration e matriz de papéis.

### Integração PostgreSQL descartável

- duas requisições simultâneas no mesmo profissional/intervalo;
- exatamente uma confirmação e um conflito;
- idempotência de criação e conclusão;
- remarcação, mismatch de payload, isolamento cross-tenant, cancelamento,
  liberação do horário, histórico e outbox única;
- aplicação e rollback não destrutivo da migration.

### E2E/aceite em Preview

- cliente agenda 10:00 e todas as cinco superfícies mostram 10:00;
- dono remarca e cliente recebe exatamente uma atualização;
- cliente cancela e o horário volta a ficar disponível;
- profissional não acessa financeiro nem dados de outro profissional;
- um segundo tenant não acessa o agendamento;
- fluxo mobile com muitos serviços, safe area, zoom e texto ampliado.

O repositório ainda não possui Playwright. Não foi adicionada uma dependência
sem um banco de Preview seguro disponível; esses cenários permanecem como gate
obrigatório da homologação e devem virar automação E2E na etapa seguinte.

## Limites deliberados

- não há pagamento online, taxa automática, estorno ou regra nova de comissão;
- pacote, assinatura, cupom e ledger financeiro permanecem para a Fase 4;
- a lista de espera atual é vinculada a um atendimento/horário; oferta por
  faixa, prioridade e expiração ainda não foi generalizada;
- polling de 30 s é fallback seguro, não substitui Realtime filtrado por tenant;
- múltiplas unidades ainda não fazem parte do schema atual;
- processamento assíncrono com retry/dead-letter da outbox fica para a Fase 4;
- aplicação em homologação e Production exige autorização separada.
