# Salon SaaS

SaaS multi-tenant de gestão e agendamento para barbearias, salões, manicures,
estética, massagem e estabelecimentos mistos.

- Produção: [salon-saas-ruby.vercel.app](https://salon-saas-ruby.vercel.app)
- Repositório: [alisonbielwhats1-beep/barber-saas](https://github.com/alisonbielwhats1-beep/barber-saas)
- Estado canônico: [`docs/STATUS_ATUAL.md`](docs/STATUS_ATUAL.md)
- Nova conversa/conta: [`docs/HANDOFF_NOVA_CONVERSA.md`](docs/HANDOFF_NOVA_CONVERSA.md)
- Regras para agentes: [`AGENTS.md`](AGENTS.md)

## Stack confirmada

- Next.js 15.5, App Router, Server Components e Server Actions;
- React 18 e TypeScript estrito;
- Tailwind CSS + Radix/shadcn-style primitives;
- Prisma 5 + PostgreSQL no Supabase;
- NextAuth Credentials com sessões JWT;
- Supabase Storage, Upstash Redis e Vercel Cron;
- Vitest e GitHub Actions com PostgreSQL 16 descartável.

## Arquitetura

- Cada estabelecimento é um tenant identificado por `salonId`.
- `Membership(userId, salonId, role)` define o vínculo e o papel.
- O isolamento é aplicado no servidor e reforçado por RLS no PostgreSQL.
- Horários são armazenados como instantes UTC (`timestamptz`) e exibidos no
  timezone IANA configurado pelo estabelecimento.
- Agenda crítica usa transações, idempotência, histórico e proteção de
  sobreposição no banco.
- Administração global usa `PlatformRole.SUPER_ADMIN` e não depende do papel
  de dono de um salão.

## Estrutura essencial

```text
src/app/(admin)                         painel do estabelecimento
src/app/(platform)/plataforma           administração global
src/app/book/[salonSlug]                aplicativo público do cliente
src/app/api                             APIs e cron
src/lib                                 domínio, segurança e infraestrutura
prisma/schema.prisma                    modelo atual
prisma/migrations                       histórico Prisma
prisma/sql/manual                       migrations manuais controladas
prisma/sql/rls                          políticas multi-tenant
src/lib/__tests__ e tests               testes unitários e PostgreSQL
docs                                    decisões, rollout e handoff
```

## Desenvolvimento local seguro

Nunca use variáveis ou dados de Production localmente.

```bash
git clone https://github.com/alisonbielwhats1-beep/barber-saas.git
cd barber-saas
npm ci
copy .env.example .env
docker compose -f compose.dev.yml up -d
npm run db:push
npm run dev
```

`db:push` é permitido somente no PostgreSQL local/descartável. Os scripts de
segurança bloqueiam ambiente desconhecido, banco produtivo e seeds sem
confirmação explícita.

## Validação padrão

```bash
npm run lint
npx tsc --noEmit --incremental false
npm test
npm run build
```

O CI também executa integração PostgreSQL, concorrência e smoke de schema.

## Deploy e banco

- Pull requests geram CI e Preview Vercel.
- Production sai apenas da branch `master`.
- Preview sem `APP_ENV=staging` fica bloqueado por segurança.
- Não use `prisma db push` nem `db:seed` contra o Supabase produtivo.
- Não reaplique SQL manual sem ler [`docs/STATUS_ATUAL.md`](docs/STATUS_ATUAL.md).
- A migration `011_platform_billing` está preparada, mas não aplicada; o
  recurso permanece protegido por `PLATFORM_BILLING_ENABLED=false`.

Secrets, senhas e credenciais de demonstração não pertencem ao repositório.
