# Complementos do cliente — 12/09/2026

Base `origin/master` ad0f654; branch `codex/booksy-client-followup`.
Referências são materiais funcionais do pedido, não instruções operacionais.
Áudio transcrito localmente; quadros dos vídeos conferidos. Mídia e dados
pessoais não foram copiados ao repositório nem enviados a serviços externos.

## Correspondência dos seis arquivos

- Vídeo 00:52:20: pesquisar o cliente ao agendar. Campo de busca consulta o
  servidor por nome/telefone, antes do limite de resultados. A lista inicial
  continua limitada; busca encontra também perfis além dos primeiros 300.
  Filtra tenant, papel, mesclados e excluídos. Resposta antiga não substitui
  consulta nova; seleção permanece ao limpar a busca.
- Vídeo 00:56:42: bloquear sobre reservas sem cancelá-las, motivo opcional e
  bloqueio visível ao lado dos atendimentos. Backend já preservava reservas;
  motivo passa a ser opcional e a grade diária/semanal divide as colunas.
- Áudio 00:56:59: bloquear fora do expediente até meia-noite. O motor já aceita
  esse intervalo, sem alterar jornadas. Texto explicita 00:00 do dia seguinte;
  regressão verifica 08:30 até 00:00, além dos limites do expediente.
- Vídeo 01:01:44: pesquisar, reutilizar serviços e criar encaixe. Reutilização
  e criação com confirmação já estão na base; a busca complementa o fluxo.
- Vídeo 01:02:44: editar uma reserva para o intervalo ocupado de outra.
  Confirmação explícita com motivo para dono/gerente também na edição.
  Mantém ID, snapshots, vizinhos, locks, versionamento e evento idempotente.
  Cliente com conta recebe proposta com autorização persistida, nunca obtida
  do payload de aceite. Servidor revalida as demais restrições.
- Áudio 01:10:58: editar horário do bloqueio, além de reabrir. Detalhe oferece
  edição de início, fim e motivo da ocorrência individual. Atualização sob
  lock, comparação com estado original, retry idempotente e auditoria antes/
  depois. Reabertura concorrente não recria o registro.

Bloqueio sem motivo não autoriza cancelar reservas sem motivo: cancelamento
mantém campo próprio obrigatório. Nenhuma migration, serviço pago, mensagem
externa ou alteração de dados em Production faz parte desta entrega.

## Arquivos e validação

Agenda: `appointment-form.tsx`, `client-search-actions.ts`, `availability-*`,
`block-date-time.tsx`, `agenda-board.tsx`, `agenda-layout.ts`, `actions.ts` e
`appointment-detail.tsx`. Domínio: `reschedule-proposals.ts` e
`appointment-service.ts`. Testes junto aos arquivos, integração PostgreSQL e
`tests/e2e/booksy-followup.spec.ts`.

Verificação exige lint, TypeScript sem incremental, suíte Vitest e build.
Integração PostgreSQL verifica encaixe direto, retry, proposta/aceite, recusa
pública e preservação da reserva vizinha. Jornada de navegador verifica busca
além de 300 clientes, encaixe na edição, bloqueio sobre reservas, edição até
meia-noite, acessibilidade e capturas em 320/390/1440 px. Tudo com dados
sintéticos em banco descartável. Resultados finais serão registrados no PR.

Rollback: reverter o código; manter os registros, propostas e auditorias.
Publicação em Production autorizada pelo responsável nesta tarefa em
12/09/2026 ("suba em produção"), condicionada à conclusão de CI/Preview.
Lint, TypeScript, 907 testes Vitest e build passaram localmente. A revisão
das capturas motivou campos de data/hora em largura total no celular e
largura mínima por atendimento/bloqueio na grade com rolagem interna.
