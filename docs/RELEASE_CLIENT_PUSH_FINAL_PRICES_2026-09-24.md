# Release de lembretes push e valor final de serviços — PR #121

Autorização do responsável nesta tarefa: **“Faça o deploy em produção.”**
Escopo autorizado: código do PR #121, migrations manuais 026/027 necessárias e
configuração VAPID/flag no projeto Production. Nenhum envio de teste nem criação
de dados sintéticos foi feito em Production.

## Identidade, CI e Preview

- Repositório: `alisonbielwhats1-beep/barber-saas`; base Production `master`.
- Supabase Production: projeto `barber-saas`, ref `vshnatkzxdekkvqttvbv`,
  sa-east-1, PostgreSQL 17.6, database `postgres`.
- Vercel Production: projeto `salon-saas`, id
  `prj_qBERQKNhW0BjEsMaJHuft66TMYiy`, domínio `everflair.com.br`.
- PR #121: <https://github.com/alisonbielwhats1-beep/barber-saas/pull/121>.
  Head homologado `cbc5d71118cd7dcdcc7b80fce1c4ea12032a77e3`; `master`
  permaneceu em `27255ebbd53f8cf59051a87f810d1d9ba055b1be` até o merge.
- CI `check`, `local-provider`, `schema-smoke` PostgreSQL 16 descartável e
  Vercel Preview passaram no head homologado. Localmente passaram lint,
  TypeScript, 1.188 testes e build. O `schema-smoke` exercitou 026/027,
  preservação, RLS, grants e rollback com dados sintéticos.

## Preflight e backup

- Projeto identificado pelo ID em todas as chamadas. Os scripts versionados
  `026_client_push_reminders.preflight.sql` e
  `027_variable_service_final_prices.preflight.sql` foram executados em
  transações somente leitura. A tabela de assinaturas, o valor `PUSH` do enum,
  as colunas de preço final e a nova constraint estavam ausentes.
- `NotificationOutbox` tinha 1.393 linhas; `AppointmentService`, 2.380.
  `ClientProfile_id_salonId_key` existia como índice unique, permitindo a FK
  composta. RLS ENABLE/FORCE estava ativa nas tabelas predecessor; `app_runtime`
  não tinha `BYPASSRLS` nem superuser.
- Backup lógico delimitado de todos os 2.380 snapshots de
  `AppointmentService`, colunas, constraints, índices, enum e metadados de
  dependência. Criptografado com OpenPGP RSA/AES-256 dentro do PostgreSQL,
  antes de sair pelo conector. Arquivo fora do Git:
  `%USERPROFILE%/.codex/backups/everflair/production-2026-09-24-pr121/appointment-service-and-schema.pgp`.
  Chave privada permanece no keyring restrito
  `production-2026-09-07/keys` (fingerprint
  `404C2B2B70D98CEB6E19FBEBF66E3CE36D4CF016`).
- O arquivo foi decifrado **em memória**, JSON/contagem validados e MD5 do
  conteúdo original confirmado:
  `4f82324e1751d4c54cb04462f2e1ea45`. Nenhum plaintext ou segredo foi
  gravado no repositório ou impresso no log.

## Execução no banco e Vercel

- `026_client_push_reminders.sql` aplicado uma vez pelo Supabase
  `apply_migration`: versão `20260925000904`, nome
  `client_push_reminders_026`. `PUSH` presente no enum; nova tabela vazia,
  duas FKs, RLS ENABLE/FORCE, policy `client_push_tenant`; somente
  `app_runtime` com SELECT/INSERT/UPDATE/DELETE, sem leitura para `anon` ou
  `authenticated`.
- `027_variable_service_final_prices.sql` aplicado uma vez pelo Supabase
  `apply_migration`: versão `20260925000926`, nome
  `variable_service_final_prices_027`. Duas colunas opcionais e a constraint
  de valor final presentes, RLS mantida, nenhum serviço finalizado pela
  migração. Os 2.380 registros anteriores preservaram fingerprint
  `a020f1dd6e8db95de85532d3bbaf7eea` antes e depois, excluindo apenas as
  duas colunas novas do segundo cálculo.
- Chaves VAPID geradas sem imprimir o segredo e guardadas em
  `%USERPROFILE%/.codex/backups/everflair/production-2026-09-24-pr121/vapid-keys.pgp`,
  criptografadas com o mesmo keyring e ACL restrita.
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` e
  `CLIENT_PUSH_ENABLED=true` foram criadas apenas para Vercel Production;
  `VAPID_PRIVATE_KEY` usa tipo `encrypted`. `CRON_SECRET` já existia em
  Production. `CLIENT_REMINDER_EMAIL_ENABLED` permanece ausente/desligada.

## Publicação e verificação

- PR integrado por squash em `master`
  `a663bdbd3a40d9d5e39ab8de0c3a801125755c49` às 00:10 UTC de
  25/09/2026. A integração Git gerou o deployment Production
  `dpl_6c2h9EvsTUgrSUzf4b1pxkjY5X3d`, estado READY e alias
  `everflair.com.br`.
- GET `https://everflair.com.br/`, `/book/studio-martinelli` e `/api/health`
  retornaram 200; health mostrou versão `a663bdbd3a40` e banco `ok`.
  `/api/client/push?salon=studio-martinelli` retornou 401 sem sessão e
  `/api/cron/reminders/today` retornou 401 sem `CRON_SECRET`.
- Vercel não agrupou erros de runtime na janela de 15 minutos consultada
  após o deploy. Não houve teste de escrita nem disparo manual de cron em
  Production.

## Uso e limitações

O cliente com conta existente, inclusive PWA já instalado, verá o convite de
ativação ao abrir a home quando o aparelho não estiver vinculado. A permissão
do sistema só é solicitada após o toque. Até que o cliente a conceda, aquele
aparelho não receberá push. Reservas futuras já existentes entram nas próximas
rodadas de véspera e do dia. O fallback por e-mail está desligado.

O código, schema, configuração, rotas e autenticação foram verificados;
**a entrega e abertura em Android/iPhone reais ainda não foram observadas**.
Não afirmar que um aparelho específico já recebeu lembrete. Não havia staging
persistente separado; a homologação de banco ocorreu no PostgreSQL descartável
do CI. O cron da Vercel pode iniciar em qualquer ponto da hora no plano Hobby,
e reservas criadas após uma rodada não recebem aviso retroativo.

Rollback funcional: definir `CLIENT_PUSH_ENABLED=false` em Vercel Production e
fazer novo deployment; se necessário, reverter o código por PR e conferir o
agendamento de cron. Manter tabela, enum, colunas, assinaturas e histórico:
removê-los pode destruir preço final e entregas registradas. A recuperação de
dados a partir do backup requer plano específico que preserve gravações feitas
após o release. Um rollback instantâneo da Vercel não atualiza automaticamente
os cron jobs; conferir a configuração deles após qualquer reversão.
