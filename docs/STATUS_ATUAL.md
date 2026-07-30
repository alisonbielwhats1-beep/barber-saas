# Handoff do projeto — Fase 1 em Production

Atualizado em 29/07/2026. Este é o ponto canônico de retomada para outro chat
ou computador. Leia também `docs/fase-1-rollout.md` e
`docs/PROXIMAS_FASES.md`.

## Onde o trabalho está

- Repositório: `alisonbielwhats1-beep/barber-saas`
- Checkout usado: `C:\Claude Code\salon-saas`
- Checkout preservado e não alterado: `D:\Projetos\barber-saas`
- Branch local/remota: `master`
- PR da Fase 1: [#3](https://github.com/alisonbielwhats1-beep/barber-saas/pull/3),
  mesclado
- Commit do código em Production: `af6d063`
- Aplicativo oficial:
  [salon-saas-ruby.vercel.app](https://salon-saas-ruby.vercel.app)
- Deployment do código: `dpl_3of24kMW7hMUWXXPTHqSoZv3drVT`, estado `Ready`

## Veredito atual

A base da **Fase 1 está concluída em Production**: código, Redis, storage,
schema e histórico Prisma foram validados. A única exceção deliberada é a
ativação do envio de convites por e-mail.

Enquanto o e-mail estiver pendente:

- `EMAIL_INVITES_ENABLED` permanece ausente/desligada;
- `RESEND_API_KEY` e `EMAIL_FROM` não estão na Vercel;
- criação, reenvio, revogação e aceite de convites falham fechados;
- a rota pública de convite mostra indisponibilidade controlada;
- não anunciar convites por e-mail como recurso disponível.

Isso não bloqueia demonstrações das demais áreas do produto.

## Fase 1 entregue

### Identidade, agendamento e histórico

- A API pública de agendamento não aceita `clientId` do navegador.
- A sessão assinada é a fonte da identidade de cliente autenticado.
- Visitante não reutiliza contato existente por telefone/e-mail e recebe um
  contato isolado dentro da transação do agendamento.
- Histórico, cancelamento e “Minhas visitas” isolam cliente e salão.
- O cron falha fechado e usa `timingSafeEqual` somente após comparar tamanhos.
- Nenhum fluxo de Production usa a senha fixa `trocar-agora`.

### Convites e consistência

- Token aleatório de 256 bits; somente SHA-256 é persistido.
- Expiração de 24 horas, rotação no reenvio e consumo único.
- Locks e `UPDATE` condicionado ao hash vigente protegem contra corrida.
- Conta existente exige a sessão do destinatário.
- Owner/manager de um salão não assume conta global de outro salão.
- Aceite atualiza `User`, `Membership`, `Professional`, serviços e auditoria na
  mesma transação; falha parcial reverte tudo.
- A infraestrutura de entrega por Resend está implementada, mas desligada.

### Rate limiting e upload

- Upstash REST está conectado a Preview e Production pela integração Vercel.
- O limiter usa `EVAL` atômico, timeout e identificadores protegidos por hash.
- Autenticação e escritas sensíveis falham fechadas em Production.
- Em Production, somente `x-vercel-forwarded-for` é usado como IP confiável.
- Upload exige sessão, papel e membership do salão; valida magic bytes e grava
  somente em `<salonId>/<finalidade>/<uuid>.<ext>`.
- O bucket público `salon-assets` existe no Supabase, limitado a 5 MiB e a
  JPEG, PNG, WebP e GIF.

## Banco de Production e migrations

Em 29/07/2026 foi feita uma reconciliação controlada:

1. O banco não tinha `_prisma_migrations`, embora os objetos das duas primeiras
   migrations já existissem.
2. Colunas, `tokenHash VARCHAR(64)`, índices, FKs, RLS e privilégios foram
   comparados com o SQL versionado.
3. `20260728220000_fase_1_security_invites` foi marcada como aplicada somente
   após essa comprovação.
4. `20260729120000_user_invite_created_by_index` também foi marcada como
   aplicada somente após confirmar o índice.
5. `20260729164510_email_professional_invites` foi aplicada por
   `prisma migrate deploy`.
6. `prisma migrate status` confirmou: `Database schema is up to date!`.

Também foram validados:

- `UserInviteEvent`, enums, FKs e índices esperados;
- RLS ativa e ausência de DML para `anon`/`authenticated` nas duas tabelas;
- preservação do único convite legado, agora em
  `FAILED / LEGACY_NOT_SENT`.

Não repetir `migrate resolve`, não usar `prisma db push` e não reaplicar essas
migrations.

### Backup anterior à mudança

Foi criado um snapshot lógico consistente de todas as 20 tabelas públicas
(758 registros), fora do Git:

`C:\Claude Code\backups\salon-saas\phase1-pre-migration-2026-07-30T02-42-16.085Z.json`

SHA-256:
`05B783DDF5F1AB4F32DA35ABE4916C9C855CF49C9A27D2A9748225ED4C191EC2`

O arquivo contém dados pessoais e hashes: não subir, compartilhar ou registrar
seu conteúdo. É um snapshot JSON para recuperação manual e **não substitui**
um backup nativo `pg_dump`/Supabase. Antes de mudanças destrutivas futuras,
criar também um backup nativo ou ponto de restauração do provedor.

### Drift conhecido, fora da Fase 1

`prisma migrate diff` ainda sugere ajustar a precisão de
`Appointment.reminderSentAt` e `Appointment.cancelledAt` para `TIMESTAMP(3)`.
O histórico está em dia, mas esse drift preexistente deve virar uma migration
separada, após validar impacto e backup. Não corrigir com `db push`.

## Evidências finais

- CI e build do código da Fase 1: aprovados.
- Testes unitários: 19 arquivos / 87 testes.
- Integração PostgreSQL 16: concorrência, rollback parcial e isolamento global
  de conta aprovados.
- Vercel Production: `Ready`.
- Variáveis de Production confirmadas sem revelar valores:
  banco, auth, Supabase, cron e `KV_*`; Resend/flag ausentes.
- Smoke tests após a migration:
  - home, login, cadastro e salão público: HTTP 200;
  - “Minhas visitas” sem sessão: redireciona ao login do salão;
  - disponibilidade sem parâmetros: HTTP 400;
  - histórico sem sessão: HTTP 401;
  - cron sem segredo: HTTP 401;
  - convite com flag desligada: contingência controlada.

## Única pendência da Fase 1: ativar e-mail

Executar em uma janela própria:

1. verificar domínio remetente no Resend;
2. definir `RESEND_API_KEY` e `EMAIL_FROM` em Preview;
3. definir `EMAIL_INVITES_ENABLED=true` somente em Preview;
4. testar criar, entregar, reenviar, revogar e aceitar convite;
5. confirmar rotação do token, idempotência, expiração, uso único e auditoria;
6. monitorar logs sem token, hash, cookie, senha ou dado pessoal;
7. só então repetir as três variáveis em Production e executar smoke controlado.

Nenhuma migration adicional é necessária para essa ativação.

## Atenção antes de clientes reais

As credenciais demo públicas são úteis para apresentação, mas não devem dar
acesso a tenants de clientes reais. Antes do primeiro onboarding comercial,
isolar/remover os tenants demo ou rotacionar suas credenciais e validar o
onboarding do cliente em tenant próprio.

## Prompt curto para o próximo chat

> Abra `C:\Claude Code\salon-saas`, confirme `master` limpa e sincronizada e
> leia integralmente `docs/STATUS_ATUAL.md`, `docs/fase-1-rollout.md` e
> `docs/PROXIMAS_FASES.md`. A Fase 1 está em Production, o Supabase está com as
> 3 migrations em dia, Upstash e `salon-assets` estão operacionais. Não refaça
> migrations nem use `prisma db push`. A única pendência da Fase 1 é ativar
> Resend por Preview primeiro; não habilite e-mail sem autorização explícita.
> Para seguir sem e-mail, comece pela Fase 2 descrita em
> `docs/PROXIMAS_FASES.md`.
