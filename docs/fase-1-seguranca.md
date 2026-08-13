# Fase 1 — segurança imediata

## Estado

A Fase 1 está publicada e o schema correspondente está aplicado em Production.
O envio de convites por e-mail permanece desligado até a configuração e a
homologação do Resend.

## Identidade pública

- Agendamento público ignora qualquer `clientId` enviado pelo navegador.
- Cliente autenticado é identificado exclusivamente por sessão assinada e pelo
  salão presente nessa sessão.
- Visitante cria um contato isolado; telefone/e-mail não permitem assumir um
  `ClientProfile` existente.
- Histórico e cancelamento exigem sessão e cruzam `clientId` com `salonId`.
- A UI de “Minhas visitas” usa a mesma identidade da API.

## Convites da equipe

- token aleatório de 256 bits;
- somente SHA-256 persistido;
- validade de 24 horas;
- rotação no reenvio;
- consumo único e atômico no PostgreSQL;
- auditoria em `UserInviteEvent`;
- conta existente exige sessão do destinatário;
- conta nova só é ativada após o fluxo de convite válido;
- `User`, `Membership`, `Professional` e serviços são atualizados na mesma
  transação.

Conhecer e-mail, ID ou link não autoriza assumir uma conta global. Um owner ou
manager de outro salão não pode redefinir senha nem anexar uma conta alheia.

O código de entrega por Resend existe, mas a flag e as credenciais estão
ausentes. Nesse estado, não há link manual de contingência: todas as operações
de convite falham fechadas.

## Migrations

As migrations da Fase 1 estão aplicadas e registradas:

- `20260728220000_fase_1_security_invites`;
- `20260729120000_user_invite_created_by_index`;
- `20260729164510_email_professional_invites`.

O índice parcial vigente é por salão e e-mail normalizado, apenas para convites
não consumidos e não revogados:

```sql
CREATE UNIQUE INDEX "UserInvite_salonId_normalizedEmail_pending_key"
  ON "UserInvite"("salonId", lower(btrim("email")))
  WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;
```

`UserInvite` e `UserInviteEvent` têm RLS habilitada e não concedem DML a
`anon`/`authenticated`. O backend continua acessando as tabelas pela conexão
de servidor autorizada.

Não usar `prisma db push`, não reaplicar as migrations e não executar
`migrate resolve` novamente.

## Senhas e sessões

- Nenhum fluxo de Production usa `trocar-agora`.
- `passwordSetAt` é explícito; não há backfill baseado apenas na existência do
  usuário.
- Convite nunca altera senha de conta existente.
- Não registrar senha, hash, token, cookie ou segredo.
- Rotação de `NEXTAUTH_SECRET` exige janela planejada porque encerra sessões.

Credenciais demo conhecidas devem permanecer restritas a tenants de
apresentação. Antes de clientes reais, isolar/remover tenants demo ou rotacionar
suas credenciais.

## Rate limiting

- Upstash Redis REST está configurado em Preview e Production.
- O contador usa `EVAL` atômico.
- Chaves usam hashes para evitar PII e ambiguidade.
- Login administrativo/cliente e convite têm buckets separados.
- Em Production, o IP confiável vem somente de
  `x-vercel-forwarded-for`.
- Autenticação e escritas sensíveis falham fechadas se Redis estiver ausente ou
  indisponível.

## Upload

- exige sessão, papel permitido e membership no salão ativo;
- não aceita path do usuário;
- grava em `<salonId>/<finalidade>/<uuid>.<ext>`;
- confere MIME e magic bytes;
- rejeita SVG;
- o bucket público contém somente imagens públicas de catálogo/portfólio.

## Cron

`CRON_SECRET` é obrigatório. Ausência, valor vazio ou incorreto retorna 401.
Antes de `timingSafeEqual`, os buffers têm o tamanho comparado para evitar
exceção e diferença de comportamento.

## Hardening candidato posterior — pendente de CI e deploy

A branch local `codex/commercial-maturity-wave1` acrescenta, sem migration:

- `withApprovedSalon` e `withSalonBySlug` validam `APPROVED` sob `FOR SHARE` e
  mantêm a linha bloqueada durante o callback; suspensão concorrente aguarda;
- login do cliente valida tipos, slug, e-mail, retorno e senha de no máximo 72
  bytes antes de headers, rate limiting, lookup ou bcrypt;
- um bucket global por IP impede contornar o limite alternando slugs, sem
  remover os buckets por salão e conta;
- telefone BR é validado centralmente e nunca truncado: cadastro, agendamento
  visitante e fila aceitam nacional/`55`/`+55`, celular e fixo válidos, e
  rejeitam DDI, DDD, prefixo ou excesso antes de persistir;
- cron lista somente estabelecimentos aprovados e revalida cada tenant sob o
  mesmo lock antes de criar lembretes idempotentes.

O teste PostgreSQL da suspensão usa `application_name`, `pg_stat_activity` e
`pg_blocking_pids` para provar espera real de lock em ambos os helpers. Ele está
incluído no `schema-smoke`, mas esta máquina não possui PostgreSQL/Docker; o CI
remoto ainda é gate obrigatório. Nada desta seção deve ser descrito como
implantado até CI, Preview e deploy terem evidência.
