# Fase 2 — agenda confiável

Atualizado em 06/08/2026.

## Estado da entrega

O rollout controlado foi iniciado em Production após autorização explícita. A
migration `fase2_appointment_reliability` foi aplicada no projeto Supabase
`barber-saas` e registrada na versão `20260806092927`. O código continua sendo
promovido exclusivamente pelo PR #23 e pela branch protegida pelo CI.

Como os dois projetos do plano Free já pertencem a produtos diferentes, não
existe um Supabase de homologação disponível. Para permitir o teste sem ligar um
Preview ao banco produtivo, foi adotado temporariamente um snapshot interno de
recuperação. Essa exceção não transforma Production em ambiente de teste e não
autoriza seeds, resets ou dados fictícios.

Antes da migration foram comprovados:

1. zero intervalos inválidos, conflitos ativos, timezones inválidos ou vínculos
   cross-tenant;
2. snapshot consistente de nove tabelas no schema privado
   `phase2_recovery_20260806`;
3. 529 registros copiados, com contagens e checksums idênticos às fontes;
4. zero privilégios do snapshot para `PUBLIC`, `anon` ou `authenticated`.

Depois da migration foram comprovados:

1. 252 agendamentos antes e depois;
2. zero divergências nos instantes de Appointment e Payment;
3. 252 snapshots de serviço legados criados;
4. constraints tenant-aware e exclusion constraint `[início, fim)` válidas;
5. RLS habilitada e forçada nas três novas tabelas, sem grants públicos.

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

### Rollout temporário sem segundo projeto Supabase

O snapshot interno é um paliativo deliberado para o plano Free. Ele permite
restaurar os dados afetados por erro lógico da migration, mas não protege contra
perda do projeto Supabase inteiro. Por isso:

1. o schema `phase2_recovery_20260806` não pode ser removido automaticamente;
2. um dump lógico externo continua obrigatório assim que a credencial direta do
   banco estiver disponível;
3. Preview continua bloqueado e nunca recebe credenciais de Production;
4. qualquer nova migration repete preflight, snapshot e autorização;
5. o deploy do código só ocorre com CI e Vercel verdes.

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

## Wave1 operacional candidata — ainda não implantada

Em 13/08/2026, a branch `codex/commercial-maturity-wave1` consolidou uma onda
posterior à Fase 2 já implantada. Não houve migration, alteração de Supabase ou
deploy desta candidata.

### Agenda, fila e estados

- todas as mutações operacionais relevantes compartilham a ordem canônica de
  locks `appointment → professional → product`;
- cancelamento continua não destrutivo, restaura reserva de produto no máximo
  uma vez e, quando feito pela equipe, encerra todas as entradas ativas da fila
  daquele atendimento sem promover outra pessoa;
- `IN_PROGRESS` e `COMPLETED` falham antes do início contratado; a comanda só
  pode receber depois de `startAt`, inclusive para atendimento já concluído;
- UI e servidor usam a mesma regra temporal para oferecer ação e autorizá-la.

### Produto, comanda, estoque e recibo

- criação pública com produtos ganhou uma capability única que cria o
  atendimento e reserva estoque na mesma transação/fingerprint idempotente;
- a reserva valida appointment, produto ativo, tenant, quantidade e estoque sob
  locks canônicos, usando preço do servidor como snapshot;
- fechamento da comanda reconcilia reserva e quantidade desejada, preserva o
  preço das unidades retidas, usa o preço atual nas adicionais e movimenta
  somente o delta de estoque;
- status, linhas finais, estoque, `Payment`, evento e `AuditLog` confirmam ou
  revertem juntos; retry idempotente não gera segundo pagamento ou movimento;
- recepção pode registrar recebimento, mas não aplicar desconto; owner/manager
  continuam responsáveis por desconto;
- recibo interno e impressão usam o `Payment` persistido e os snapshots de
  serviço/preço/quantidade.

### Testes candidatos

- integração PostgreSQL amplia concorrência para create+reserve, checkout,
  cancelamento, ajuste, idempotência, preço e estoque;
- `schema-smoke` chama agenda, comanda e lock público pelo script
  `test:appointment-integration`;
- a execução PostgreSQL e o CI remoto estão pendentes porque esta máquina não
  possui PostgreSQL/Docker; não há staging/browser autenticado disponível.

### Dívidas que permanecem

- `AppointmentProduct` não carrega `salonId`; a validação transacional reduz a
  superfície atual, mas a solução estrutural exige migration tenant-aware com
  preflight, backfill, constraints compostas, RLS e rollback;
- nome do produto e moeda não são snapshots persistidos. O recibo atual é
  interno, não fiscal, e pode refletir nome/moeda configurados depois da venda;
- CI verde, Preview seguro e deploy ainda não foram comprovados.
