# Handoff do projeto — 29/07/2026

Este arquivo é o ponto de retomada para outro chat ou computador. Leia também
`docs/fase-1-rollout.md` antes de qualquer homologação, migration ou deploy.

## Onde o trabalho está

- Repositório: `alisonbielwhats1-beep/barber-saas`
- Checkout local usado: `C:\Claude Code\salon-saas`
- Checkout original preservado: `D:\Projetos\barber-saas`
- Branch local e remota: `feat/email-professional-invites`
- Pull request: [PR #3 — convites de profissionais por e-mail](https://github.com/alisonbielwhats1-beep/barber-saas/pull/3)
- Estado do PR: aberto, `draft`, mergeável e ainda não mesclado
- Commit de fechamento técnico da Fase 1B: `a1d35d0`
- GitHub Actions: [aprovado](https://github.com/alisonbielwhats1-beep/barber-saas/actions/runs/30505468872)
- Preview da Vercel: [aprovado](https://vercel.com/alisonbielwhats1-beeps-projects/salon-saas/ARpKUpfpfES71Muow4aE1ye1TdBE)

Nenhum merge, deploy manual, `prisma db push` ou migration em produção foi
executado.

## Escopo concluído na Fase 1

### Identidade pública

- A API pública de agendamento não aceita `clientId` do navegador.
- A sessão assinada é a única fonte de identidade de cliente autenticado.
- Um visitante nunca reutiliza contato existente por telefone ou e-mail.
- O contato isolado do visitante é criado na mesma transação do agendamento.
- Histórico, cancelamento e “Minhas visitas” cruzam cliente e salão da sessão.
- O cron falha fechado e compara o segredo com `timingSafeEqual`, verificando o
  tamanho antes da comparação.
- O fluxo fixo `trocar-agora` não existe em produção.

### Convites

- Token aleatório de 256 bits, com somente SHA-256 persistido.
- Validade de 24 horas, rotação no reenvio e consumo único.
- Resend usa chave de idempotência por tentativa e timeout.
- Resultado atrasado do provedor não sobrescreve uma tentativa mais nova.
- Criação, reenvio e cancelamento usam advisory locks compatíveis.
- O aceite exige o hash vigente no `UPDATE`; token rotacionado não pode ser
  consumido numa corrida.
- Conta existente exige sessão do usuário destinatário.
- Owner ou manager não consegue assumir conta global de outro salão.
- `User`, `Membership`, `Professional`, serviços e evento de aceite são
  consistentes na mesma transação.
- Falha parcial reverte consumo do convite e todas as ativações.

### Migration

- O nome histórico foi restaurado para
  `20260729120000_user_invite_created_by_index`.
- A nova migration é
  `20260729164510_email_professional_invites`.
- O SQL preserva dados legados, cria estados/eventos, FKs, índices e o índice
  parcial correto, habilita RLS e revoga `anon`/`authenticated`.
- Os arquivos SQL reais foram aplicados em ordem num PostgreSQL 16 efêmero.
- O CI usa uma fixture pré-Fase-1 porque o repositório não contém uma migration
  baseline completa. A fixture não é migration de produção.
- Rollout, rollback honesto e recuperação estão em
  `docs/fase-1-rollout.md`.

### Rate limiting

- Upstash REST usa `EVAL` atômico, timeout e chaves com identificador em hash.
- Login administrativo e de cliente têm buckets separados por IP e conta.
- Aceite de convite tem buckets por IP e token.
- Autenticação e escritas sensíveis falham fechadas em produção se o Redis
  estiver ausente ou indisponível.
- Em produção, somente `x-vercel-forwarded-for` é aceito como IP confiável.
- Leituras públicas não críticas podem usar fallback local.

### Upload e dependências

- Upload exige sessão, membership no salão ativo, role e finalidade permitida.
- O caminho é `<salonId>/<finalidade>/<uuid>.<ext>`.
- O MIME declarado é conferido com magic bytes; SVG e paths arbitrários são
  rejeitados.
- O bucket público `salon-assets` é somente para imagens públicas de serviços,
  produtos e portfólio e deve ser criado antes do deploy.
- `next-auth` está em `4.24.15`; `postcss` e `sharp` têm versões corretivas.
- `npm audit --omit=dev` retorna zero vulnerabilidades.
- Restam 13 alertas somente em tooling de desenvolvimento.
- Node.js mínimo: `20.9.0`.

## Evidências

- TypeScript: aprovado.
- Prisma Generate e Validate: aprovados.
- Unitários: 19 arquivos, 87 testes aprovados.
- PostgreSQL 16: 3 testes de integração aprovados:
  - duas aceitações concorrentes consomem somente uma vez;
  - falha parcial reverte usuário, membership e profissional;
  - owner não assume conta global pertencente a outro salão.
- Build de produção com Next.js `15.5.22`: aprovado localmente e no CI.
- `git diff --check`: aprovado.

O teste PostgreSQL encontrou e permitiu corrigir um erro que os mocks
escondiam: `pg_advisory_xact_lock` retorna `void`, que o Prisma não
desserializa. O SQL agora adquire o mesmo lock projetando somente um inteiro
compatível.

## Estado operacional da Fase 1B

O deployment `dpl_8prwDgsiHeqejArctZYJg9us6Ytk` falhou durante a coleta de
dados porque `NEXTAUTH_SECRET` não estava disponível na branch atual. As cinco
variáveis de Preview necessárias ao build estavam restritas à branch antiga
`fix/fase-1-seguranca`.

O escopo de `NEXTAUTH_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY` foi movido para
`feat/email-professional-invites`, sem visualizar ou alterar valores e sem
modificar o ambiente Production. O redeploy
`dpl_AUus5URSAryco5Nrn4yHheizi74P` terminou em `Ready`, e a página inicial do
Preview abriu corretamente.

Em 29/07/2026, a homologação operacional avançou sem publicar código em
Production:

- foi criado o Redis gratuito `salon-saas-preview-vercel` em São Paulo
  (`gru1`) pela integração oficial Upstash/Vercel;
- `KV_REST_API_URL` e `KV_REST_API_TOKEN` foram injetados como sensíveis
  somente em Preview. O runtime também mantém compatibilidade com
  `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`;
- o banco manual inicial `salon-saas-preview` (US East) ficou desconectado e
  não é usado pelo aplicativo; não foi apagado automaticamente;
- `NEXTAUTH_URL` foi confirmado em Production e configurado no Preview com o
  alias estável da branch;
- o bucket `salon-assets` foi criado no Supabase de produção como público, com
  limite de 5 MiB e MIME restrito a JPEG, PNG, WebP e GIF;
- a conta Resend está acessível, mas `RESEND_API_KEY` e `EMAIL_FROM` não foram
  criados nem conectados à Vercel. O envio de convites por e-mail permanece
  deliberadamente em contingência e não deve ser usado até sua ativação;
- `EMAIL_INVITES_ENABLED` é uma flag server-side desativada por padrão. O
  recurso só é habilitado quando seu valor é exatamente `true` e as duas
  configurações do Resend estão presentes;
- com a flag desligada, as páginas administrativas não consultam
  `UserInvite`, as Server Actions recusam criação/reenvio/cancelamento/aceite e
  a rota pública de convite mostra uma indisponibilidade controlada antes de
  ler sessão ou token;
- os scripts SQL manuais e de RLS foram movidos de `prisma/migrations` para
  `prisma/sql`, para que não sejam interpretados como migrations pelo Prisma.
- TypeScript, Prisma Validate, 19 arquivos/87 testes unitários e o build
  Next.js passaram localmente sem conexão com o banco real.

O commit `a1d35d0` passou no GitHub Actions e no Vercel Preview. Os smoke tests
confirmaram home, login, cadastro, os dois salões de demonstração, redirecionamento
de “Minhas visitas” sem sessão, rate limiting distribuído no login, histórico
sem autenticação, cron sem segredo e disponibilidade sem parâmetros. A rota
`/convite/token-invalido-phase1b`, que antes retornava erro 500 pela ausência
das tabelas, agora exibe a contingência sem consultar o banco de convites.

A inspeção somente leitura do banco de produção mostrou que ele não possui
histórico Prisma reconhecido e que as três migrations versionadas locais
aparecem como pendentes. Nenhuma migration foi aplicada ou marcada como
resolvida. Antes de qualquer `migrate deploy`, é obrigatório criar backup e
reconciliar cada objeto existente com o SQL local; não usar `migrate resolve`
sem essa evidência.

Ainda falta para promover a Fase 1 a Production:

1. planejar e autorizar explicitamente o baseline/migrations do banco real;
2. configurar Redis de Production antes de publicar o código;
3. configurar Resend e habilitar `EMAIL_INVITES_ENABLED=true` somente depois
   de validar a migration e quando o envio de convites for liberado;
4. manter o PR em draft e não mesclar nem publicar em Production antes dessas
   etapas.

## Prompt curto para o próximo chat

> Abra `C:\Claude Code\salon-saas`, confirme a branch
> `feat/email-professional-invites` e leia `docs/STATUS_ATUAL.md` e
> `docs/fase-1-rollout.md`. Inspecione o PR #3. A Fase 1B terminou no Preview:
> GitHub Actions, Vercel e smoke tests passaram no commit `a1d35d0`; não refaça
> o trabalho. Upstash está configurado somente no Preview, o bucket existe e
> convites por e-mail estão bloqueados por padrão porque Resend e a migration
> de Production ainda não foram liberados. Planeje o baseline do banco. Não
> faça merge, deploy, migration de produção ou `prisma db push` sem autorização
> explícita.
