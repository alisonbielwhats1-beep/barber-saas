# Recebimentos e experiência de agendamento — 13/09/2026

Base: origin/master `5cca634`. Branch: `codex/booking-receipts-experience`.
Solicitação autoriza implementar e validar; publicação e SQL produtivo permanecem etapas separadas.

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
- PostgreSQL 16 isolado em loopback: 5 testes novos de reservas/recebimentos/ofertas,
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
