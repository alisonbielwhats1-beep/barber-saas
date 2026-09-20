# Recebimentos e experiência de agendamento — 13/09/2026

## Complemento de 20/09/2026 — seleção de vários dias

O responsável esclareceu que “quatro serviços, realizar três” significa quatro
atendimentos separados. A interface agora reúne até 31 dias selecionados em uma
conferência, reutilizando `getReceiptDay` com concorrência limitada a quatro
consultas. Se qualquer dia falhar, não mostra um lote incompleto e oferece retry.
As datas de atendimento aparecem em cada linha; a data de recebimento comum
permanece explícita, inicialmente ontem, conforme a decisão vigente.

Forma individual aparece em cada atendimento; aplicar a mesma forma ao lote é
opcional e afeta somente os selecionados. Desmarcar preserva a pendência. Baixas
continuam limitadas a 100 linhas, com confirmação de realização quando necessária,
versionamento, chave por linha, retry e prevenção de envio duplicado existentes.
Não introduz pagamento parcial dentro de uma comanda nem alteração de backend.

Testes cobrem três de quatro, formas distintas, seleção entre dias, aplicação
em lote sem afetar desmarcados, falha de carregamento/retry e envio idempotente.
Validação local: lint, TypeScript, 1.132 testes e build; navegador sintético com
dois dias, três baixas simuladas e quarto pendente, sem overflow em 320 px ou
erros de console. Não é homologação com banco nem publicação em produção.

Base: origin/master `5cca634`. Branch: `codex/booking-receipts-experience`.
Solicitação inicial autorizou implementar e validar. Após revisão e CI completos,
o responsável autorizou a publicação em produção, incluindo a migration 023 necessária.

## Escopo e critérios de aceite

- Baixa em lote em Hoje e Financeiro; histórico diário somente no Financeiro.
- Data de recebimento editável, sempre inicialmente ontem no fuso do salão.
- Seleção individual/todos, forma por linha/em lote, extras e acréscimos antes de receber.
- Cada pagamento é transacional e idempotente; falha individual mantém os demais e permite retry.
- Concluídos sem pagamento permanecem pendentes; finalizar e receber exige declaração explícita.
- Preço reservado e catálogo preservados; extras/ajustes ficam no pagamento e recibo.
- Mesmo serviço pode aparecer várias vezes em reserva, criação, disponibilidade, proposta e remarcação.
- Encaixe do dono/gerente continua explícito, auditado e sem apagar reservas vizinhas.
- Cores por profissional, serviço, categoria ou status, com preferência local por salão/usuário.
- Último atendimento concluído reutilizável pelo cliente, sempre revendo preço e disponibilidade atuais.
- Complementos configuráveis ligados a serviços; retorno previsto e preferência de sugestões de horário.
- Oferta da fila com prazo/aceite, ordem compatível e liberação segura.

## Diagnóstico inicial

`AppointmentService` tem unicidade por serviço e reserva; domínio e disponibilidade deduplicam IDs.
Comanda fecha individualmente, usa data atual e suporta produtos/desconto, sem extras de serviço.
Fila flexível promove manualmente. Sugestões usam bordas dos menores grupos de horários.

## Validação e release

Registrar nesta entrega resultados reais de lint, TypeScript, Vitest, build, PostgreSQL,
schema-smoke e jornadas. Nunca executar teste em Production. Migration 023 requer preflight,
backup/restauração, preservação, RLS e recuperação antes de aplicação autorizada.

## Implementação e decisões de experiência

Financeiro tem a lista dos últimos 31 dias, paginação para períodos anteriores,
indicadores completo/parcial/pendente/sem movimento, baixa e recibos no mesmo
contexto. As rotas /pagamentos e /fechamento redirecionam para /financeiro.
Sinais automáticos de 30% e a abertura/fechamento de caixa foram removidos da UI:
eram anotações manuais, sem solicitação de cobrança nem abatimento financeiro.
A auditoria anterior continua armazenada. Não há gateway ou mensagem automática.

A baixa aceita até 100 atendimentos por lote, com transação e chave por linha.
Erros mantêm as linhas falhas; tentativas simultâneas não duplicam receita.
A data escolhida é representada ao meio-dia local (ou agora quando hoje ainda
não chegou ao meio-dia); `recordedAt` registra o instante real da operação.
Pagamentos legados recebem `recordedAt=paidAt`. Produtos/descontos continuam
na comanda individual; o lote preserva os produtos reservados.

Serviços repetidos mantêm ordem e snapshots na criação, remarcação, propostas,
disponibilidade e filas. A unicidade por posição permanece; só a unicidade por
serviço/reserva é removida. Cores de reservas compostas usam o primeiro serviço.
As preferências de complementos, retorno e sugestões ficam na auditoria por tenant.

Ofertas usam uma tabela com RLS forçada e FKs compostas. Guardas transacionais
serializam reserva/oferta/recurso, incluindo intervalo do profissional. Reservas
aceitas geram eventos existentes da agenda; a oferta aparece na home e em Minhas
reservas do titular. Prazo de 5–60 minutos; retirada pela gestão e recusa liberam
o horário. Após expiração, não há cron nem envio automático: o prazo é conferido
nas consultas e na confirmação; a gestão inicia a próxima oferta compatível.
Não oferecer a mesma vaga novamente ao pedido que recusou/expirou.

## Evidências locais já obtidas

- `npm run lint`, `npx tsc --noEmit --incremental false` e `npm run build`: aprovados.
- `npm test`: 914 testes em 182 arquivos aprovados, incluindo data padrão, extras,
  seleção, erro parcial e bloqueio de double submit na baixa.
- PostgreSQL 16 isolado em loopback: 6 testes novos de reservas/recebimentos/ofertas,
  16 de comanda e 11 de recursos/preços existentes passaram em execuções focadas.
- Migration 023: preflight, aplicação, reaplicação e verify passaram localmente;
  backup do predecessor restaurado em banco separado. Nenhuma conexão produtiva.
- Playwright Chromium: baixa com extra/acréscimo, data de ontem, pendência
  desmarcada e recibo no mesmo Financeiro passaram; Axe sem violações no diálogo
  em 320, 390 e 1440 pixels, sem erros de página.
- Screenshot local e verificação com agent-browser confirmaram login e Financeiro.
- O schema-smoke inclui preservação do predecessor, reaplicação, testes novos,
  restauração/fingerprint completo e evidências Playwright. Resultado remoto no PR.

## Recuperação e promoção

O schema novo deve preceder o código, após aprovação específica para o ambiente.
O preflight enumera banco/usuário/endereço/porta e preservação. Manter o backup
fora do Git e comprovar restauração. Não reaplicar outras migrations por rotina.
Após gravação de serviços repetidos, rollback para código que deduplica serviços
é incompatível: manter schema/dados e promover correção compatível. O arquivo
023.rollback.sql é um inventário de recuperação, não um apagamento de histórico.
Preview da Vercel continua limitado à landing pelo guard; jornadas autenticadas
são verificadas apenas no PostgreSQL local/CI sintético.

PR de revisão: https://github.com/alisonbielwhats1-beep/barber-saas/pull/103.
O aceite confere também os snapshots realmente gravados, revertendo a transação
se o catálogo mudar durante a confirmação.

Verificação adicional local: configurações de sugestões/complementos persistiram;
cores persistiram após reload e entre Agenda/Hoje; sessão sintética de cliente
restaurou três serviços pelo atendimento de sempre. A jornada Playwright cobre
a persistência das cores; seletor permanece desabilitado até a hidratação.

Revisão com a base `d970b11` (PR #102): 924 testes em 183 arquivos passaram.
As cinco jornadas locais de navegação, listas mobile, operação diária e recebimentos
passaram após manter retornos abaixo da lista de clientes e mover cores para os
filtros no celular. O teste de paleta agora escolhe o modo profissional e aguarda
a transição visual. O CI executa as jornadas autenticadas em duas partes, cada
qual com um novo servidor dev, evitando reinício por memória no meio da operação.

## Liberação autorizada em 13/09/2026

O pedido "faça o deploy em produção" autoriza a liberação do PR #103.
CI 34745748168 aprovado: 924 testes unitários, upgrade/reaplicação/preservação,
concorrência/RLS, restauração e 102 testes de navegador. Preview READY, protegido
pelo SSO da Vercel. A revisão visual local adicional teve 37 testes aprovados.

Migration `receipts_booking_023`, versão `20260913142553`, aplicada uma única vez
em `barber-saas` / `vshnatkzxdekkvqttvbv`, PostgreSQL 17.6, sa-east-1.
Preflight confirmou predecessor e runtime NOSUPERUSER/NOBYPASSRLS. Apenas a 023
foi aplicada, com lock_timeout de 5 segundos e statement_timeout de 60 segundos.
Verify confirmou RLS ENABLE/FORCE, política tenant, três guardas, remoção da
unicidade por serviço/reserva, ausência de grants públicos e backfill sem divergências.

Preservação antes/depois: 1.191 pagamentos, 14.589.500 centavos recebidos, 2.276
itens de serviço e nenhuma entrada da fila flexível. Checksums das colunas legadas:
Payment `e6c27701a7628a9b4712dac0d37368a3`;
AppointmentService `d9577088fffa5c19360ab3d6a0fb5055`;
FlexibleWaitlist `d41d8cd98f00b204e9800998ecf8427e`.
Advisors não apontaram novos achados; permanecem avisos preexistentes de search_path
nas funções de contexto e de btree_gist em public.

Backup delimitado de Payment, AppointmentService, FlexibleWaitlist e metadados
das estruturas afetadas, criptografado ainda no servidor, mantido fora do Git em
`.codex/backups/everflair/production-2026-09-13-pr103/affected-tables.pgp`.
Não é dump completo do projeto. A decifragem integral em memória confirmou 1.143.721
bytes e SHA256 `feef8f12885b2642e96e0f1fae1b30f51cade724d7dfa5248738ffd49747215e`.
Chaves de recuperação preservadas em `production-2026-09-07/keys`, no mesmo diretório
de backups. Nenhum dado produtivo foi restaurado em desenvolvimento ou teste.
A recuperação mantém schema/dados e usa código compatível após gravação de repetições.

O merge/deploy e a verificação somente leitura da home, Financeiro, Hoje, Booksite
e logs de runtime serão registrados no PR #103. Não executar baixas ou reservas de
teste em Production.
