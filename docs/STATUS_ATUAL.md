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

## Fase 2 em andamento

A Fase 2 começou em 30/07/2026 na branch
`feat/fase-2-agenda-integrity`. O primeiro lote centraliza disponibilidade,
timezone, cancelamento e concorrência da agenda sem migration.

A inspeção somente leitura encontrou dois fatos que precisam ser preservados no
handoff:

- a constraint PostgreSQL `appointment_no_overlap` não existe em Production;
- existem 9 pares de agendamentos ativos sobrepostos.

Nenhum desses dados foi alterado. O código do lote usa advisory lock
transacional para impedir novas corridas, mas a constraint definitiva só pode
ser criada depois da conciliação humana dos conflitos existentes.

Estado detalhado, critérios e próximos lotes:
`docs/fase-2-agenda.md`.

## Prompt curto para o próximo chat

> Abra `C:\Claude Code\salon-saas`, leia integralmente
> `docs/STATUS_ATUAL.md`, `docs/fase-2-agenda.md` e
> `docs/PROXIMAS_FASES.md`. A Fase 1 está em Production e o e-mail continua
> desligado. A Fase 2 está na branch `feat/fase-2-agenda-integrity`; não refaça
> o lote 2A. Production não tem a constraint `appointment_no_overlap` e possui
> 9 pares ativos sobrepostos; não altere esses dados nem crie a constraint sem
> conciliação e autorização. Continue pela validação/PR do lote 2A e depois
> implemente a remarcação atômica 2B. Nunca use `prisma db push`.

## Registro canônico de retomada — 30/07/2026

O lote 2A foi concluído, publicado no GitHub e validado no Preview da Vercel.

- Branch: `feat/fase-2-agenda-integrity`
- PR draft: [#5](https://github.com/alisonbielwhats1-beep/barber-saas/pull/5)
- Commit final: `6b792a1`
- Vercel Preview: [abrir aplicativo](https://salon-saas-git-feat-fase-bb7e3d-alisonbielwhats1-beeps-projects.vercel.app)
- GitHub Actions: aprovado
- Vercel Preview: Ready
- Working tree e branch remota: sincronizados
- Production: não alterada
- Supabase: nenhuma migration, `db push` ou alteração de dados executada

### Escopo entregue no lote 2A

- Front-end de agendamento e “Minhas visitas” alinhado ao timezone do salão.
- Cancelamento no front-end alinhado à política real do salão.
- API pública e agenda administrativa com validação única de disponibilidade.
- Advisory lock PostgreSQL para impedir corrida de reservas.
- Criação de contato e agendamento manual na mesma transação.
- Testes unitários, build, TypeScript e integração PostgreSQL no CI.

### Ponto exato onde parar

Não refazer o lote 2A. O próximo trabalho é o lote **2B — remarcação atômica**:
manter a reserva atual até a nova vaga ser validada e confirmada dentro da mesma
transação; se a nova vaga for tomada, a reserva original deve permanecer.

Antes de criar `appointment_no_overlap` em Production, ainda é obrigatório
classificar os 9 pares de agendamentos ativos sobrepostos encontrados na auditoria.
Não alterar esses dados sem autorização operacional explícita.

### Prompt curto para continuar

> Abra `C:\Claude Code\salon-saas` e leia `docs/STATUS_ATUAL.md`,
> `docs/fase-2-agenda.md` e `docs/PROXIMAS_FASES.md`. Continue da branch
> `feat/fase-2-agenda-integrity`, PR draft #5, commit `6b792a1`. O lote 2A já
> está concluído e validado; não o refaça. Implemente o lote 2B de remarcação
> atômica. Não faça migration, `prisma db push`, alteração no Supabase ou deploy
> de Production sem autorização explícita. Production possui 9 pares ativos
> sobrepostos e não tem a constraint `appointment_no_overlap`.
