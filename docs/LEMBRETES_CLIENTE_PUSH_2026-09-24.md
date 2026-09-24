# Lembretes no celular e valor final por serviço — candidata local

Branch `codex/service-reminder-push`, baseada em `origin/master` `27255eb`.
Uma leitura remota confirmou que esse também era o HEAD de `master` em
24/09/2026. Nenhuma migration, flag ou chave foi
aplicada em Production nesta tarefa.

## Pedido e comportamento

- A modalidade **A partir de** já está implantada: dono/gerente escolhe cada
  serviço, valor inicial e justificativa. O cliente vê o valor inicial e que o
  preço final pode subir e será combinado antes do atendimento. Os termos da
  reserva ficam congelados mesmo se o catálogo mudar. Migration 021 já consta
  como aplicada e não deve ser reaplicada. Nesta candidata, a comanda recebe
  o valor final de cada serviço variável e o motivo quando houver aumento.
  O pagamento e a receita de serviços usam a diferença; o preço inicial da
  reserva permanece no snapshot. Recibo e histórico do cliente mostram ambos.
- O cron atual cria apenas aviso interno de véspera. A candidata mantém essa
  chave histórica e acrescenta um aviso interno no dia do agendamento. O
  salão define o fuso IANA; cancelamento/remarcação bloqueia entrega externa
  de um aviso antigo. Lembrete manual pelo WhatsApp não suprime os automáticos.
- Push no celular exige consentimento explícito. O cliente abre a tela de
  notificações, ativa o aparelho e pode desativá-lo no mesmo lugar. iPhone
  precisa de app adicionado à Tela de Início. O service worker exibe o aviso
  com ícone EverFlair e abre `Minhas visitas` ao toque.
- A página confere se o aparelho está vinculado ao perfil logado naquele salão.
  O navegador compartilha a assinatura entre salões no mesmo domínio; por isso,
  desativar um salão revoga apenas seu vínculo no banco e preserva os demais.
- A caixa interna continua fonte do histórico. Push usa uma linha de outbox
  por dispositivo; sem dispositivo ativo, um cliente com conta e e-mail pode
  receber e-mail via Resend existente se a flag estiver habilitada. Falha
  permanente de push também enfileira e-mail quando nenhum outro envio push
  daquele evento ainda está pendente ou enviado.
- O texto é discreto: nome do salão e horário, sem nome do cliente ou
  procedimento na tela bloqueada. O TTL do push termina no horário reservado.
  Não há WhatsApp/SMS automático ou serviço
  pago novo.

## Agendamento e limites

Véspera usa o cron existente às 11:00 UTC. O novo cron do dia roda às 10:00
UTC; em São Paulo, costuma ser 07:00, e em Manaus, 06:00. Reservas que já
começaram são ignoradas. Como cada cron roda uma vez por dia, reservas feitas
depois da rodada de véspera não recebem aviso retroativo, e agendamentos que
começam antes da rodada do dia não recebem o segundo aviso. O atraso do
agendador da Vercel pode deslocar a execução dentro da hora no plano Hobby.
Monitorar volume e atraso antes de prometer hora exata de chegada.

## Banco e segurança

`026_client_push_reminders` é aditiva: acrescenta `PUSH` ao enum de canais e
`ClientPushSubscription` com FK composta de cliente+salão, unique por
salão+endpoint, RLS ENABLE/FORCE, policy por `app_current_salon()` e grants
somente para `app_runtime`. A API verifica sessão assinada, salão, perfil,
mesma origem, limite de requisições e host do endpoint. Um dispositivo é
reatribuído ao cliente logado no mesmo salão. O corpo push não contém dados
pessoais além do salão e horário.

Preflight, forward, verify e rollback não destrutivo estão em
`prisma/sql/manual/026_client_push_reminders.*.sql`. Não usar `db push` nem
aplicar SQL em Production para testar. Rollback funcional desliga as flags e
reverte o código, preservando assinaturas e outbox.

`027_variable_service_final_prices` acrescenta duas colunas opcionais ao
snapshot `AppointmentService` e uma constraint: só serviços `FROM` aceitam
valor final, nunca abaixo do inicial, com motivo quando houver aumento. O
fechamento valida posição do item, papel e preço no servidor sob o lock da
reserva; atualiza snapshot, total do agendamento, pagamento e auditoria na
mesma transação. A migration 027 também tem preflight/verify/rollback de
inventário. Não foi aplicada em Production.

## Ativação revisável

1. Abrir PR e aguardar CI completo, incluindo `schema-smoke`, PostgreSQL 16
   descartável com as migrations 026/027 e Preview. Confirmar novamente
   `origin/master` antes da integração.
2. Após autorização para staging, identificar o projeto separado, fazer
   backup/restore de dados sintéticos, executar preflight, aplicar 026/027 uma vez
   e verificar RLS/grants/contagens.
3. Gerar chaves VAPID fora do Git e configurar somente no ambiente seguro:
   `CLIENT_PUSH_ENABLED`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT`. Configurar `CLIENT_REMINDER_EMAIL_ENABLED` só depois de
   testar o remetente Resend existente. Não imprimir a chave privada em logs.
4. Testar instalação, consentimento, recebimento e toque em Android e iPhone
   reais; conferir véspera/dia, remarcação, cancelamento, deduplicação,
   expiração do endpoint e fallback de e-mail.
5. Solicitar aprovação para integrar e publicar. Aplicação em Production requer
   preflight, identificação inequívoca, backup, rollback e autorização
   explícita. Só então ativar as flags e conferir cron, home, tela do cliente
   e erros de runtime.

## Verificações locais

- `npm run lint`: aprovado.
- `npx tsc --noEmit --incremental false`: aprovado.
- `npm test`: 218 arquivos e 1.185 testes aprovados após repetir sem build
  concorrente. A primeira execução simultânea ao build atingiu o timeout de
  cinco segundos em um teste de varredura de arquivos; a repetição passou.
- `npx vitest run src/lib/__tests__/cron-security.test.ts src/lib/__tests__/client-reminders.test.ts`:
  aprovado, incluindo a rota do dia. Uma segunda execução dirigida com
  `pwa-manifest.test.ts` totalizou 17 testes aprovados.
- `npx prisma validate`: aprovado com URLs sintéticas locais; não conectou ao banco.
- `npm run build`: aprovado após fornecer variáveis sintéticas locais e permitir
  o download da fonte Inter. Gerou 62 páginas estáticas e as duas rotas de cron.
- A integração PostgreSQL/migration 026 está configurada no `schema-smoke` do
  CI. A migration 027 e o teste do valor final da comanda também estão no
  `schema-smoke`. Não foram executados localmente: o Docker CLI está instalado,
  mas o daemon não está disponível. Nenhum ambiente remoto foi usado para
  testes locais.
