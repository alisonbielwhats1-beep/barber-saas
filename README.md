# Salon SaaS

Plataforma multi-tenant para gestão e agendamento de salões de cabeleireiro / barbearias.
Cada salão é um tenant isolado por `salonId` — arquitetura pensada para escalar de 1 até algumas centenas de estabelecimentos numa única base Postgres.

## Stack

- **Next.js 14** (App Router, Server Components, Server Actions)
- **TypeScript** estrito
- **Tailwind CSS** + tokens estilo shadcn/ui (Radix headless)
- **Prisma** + **PostgreSQL** (Neon ou Supabase recomendados para produção)
- **NextAuth** para autenticação (credencial + sessões JWT)
- **Recharts** para os gráficos do dashboard BI
- **date-fns** + `date-fns-tz` para lidar com timezone por salão

## Em produção

- **App:** https://salon-saas-ruby.vercel.app
- **Agendamento do cliente:** `/book/luna-hair` e `/book/north-barber`
- Hospedagem Vercel · banco e storage no Supabase (região São Paulo)

## Rodar em outra máquina

O `.env` **não** vai para o Git (contém senhas). Duas formas de obtê-lo:

```bash
git clone https://github.com/alisonbielwhats1-beep/barber-saas.git
cd barber-saas
npm install

# Opção A — puxar as variáveis já configuradas na Vercel (recomendado)
npx vercel link          # escolhe o projeto salon-saas
npx vercel env pull .env

# Opção B — preencher na mão
cp .env.example .env     # leia os avisos do arquivo, eles evitam 2 armadilhas reais
```

Depois:

```bash
npm run dev              # http://localhost:3001
```

O banco Supabase já está com schema e dados demo — não precisa rodar `db:push`
nem `db:seed` de novo (isso apagaria/duplicaria dados de produção).

Logins seed:
- `dono@lunahair.com` / `demo1234` — dono do salão "Luna Hair"
- `dono@northbarber.com` / `demo1234` — dono do "North Barber"

> Se for apontar para um banco **novo**, aí sim: `npm run db:push` e `npm run db:seed`.
> Alternativa ao `db:push`: colar `schema_supabase.sql` no SQL Editor do Supabase
> (o arquivo é idempotente, pode rodar mais de uma vez sem erro).

## Deploy

```bash
npx vercel --prod
```

Variáveis de ambiente ficam no painel da Vercel (não no `.env` do repo).

### Convites da equipe por e-mail

O envio usa Resend por uma abstração server-side. Configure em todos os
ambientes da Vercel que devem enviar convites:

```env
RESEND_API_KEY=re_...
EMAIL_FROM=SalonSaaS <convites@seudominio.com>
NEXTAUTH_URL=https://seu-dominio-de-producao.com
```

O domínio de `EMAIL_FROM` precisa estar verificado no Resend. Nunca use uma
variável `NEXT_PUBLIC_` para a chave. Em testes, injete um `Mailer` falso; a
suíte automatizada não chama o Resend.

O procedimento de homologação, ordem de deploy e rollback está em
`docs/fase-1-rollout.md`. O bucket público `salon-assets` deve existir antes do
deploy e é exclusivo para imagens públicas de serviços, produtos e portfólio.

O ponto exato de retomada entre chats e computadores está registrado em
`docs/STATUS_ATUAL.md`.

Ao adicionar via CLI, use redirecionamento de arquivo — pipe do PowerShell
pode gravar valor corrompido:

```bash
printf '%s' 'valor' > /tmp/v.txt
npx vercel env add MINHA_VAR production < /tmp/v.txt
```

## Estrutura

```
salon-saas/
├── prisma/
│   ├── schema.prisma          Modelagem completa (User, Salon, Membership, ...)
│   └── seed.ts                Dados demo
├── src/
│   ├── app/
│   │   ├── (auth)/login       Login
│   │   ├── (admin)/           Painel do salão (dashboard, agenda, cadastros)
│   │   ├── book/[salonSlug]/  Fluxo público de agendamento pelo cliente
│   │   ├── api/               Rotas: availability, appointments
│   │   ├── layout.tsx         Root layout + fontes + providers
│   │   ├── page.tsx           Landing pública
│   │   └── globals.css        Tokens de design em CSS variables
│   ├── components/ui/         Primitivos (Button, Card, Input, ...)
│   └── lib/
│       ├── prisma.ts          Singleton do PrismaClient
│       ├── tenant.ts          Helpers de sessão + salonId ativo
│       ├── kpis.ts            Queries de BI (faturamento, ocupação, top serviços)
│       └── utils.ts           cn(), format money, format duração
├── tailwind.config.ts
├── next.config.mjs
└── package.json
```

## Isolamento multi-tenant

- Cada tabela tenant-scoped tem `salonId: String` + índice.
- `Membership(userId, salonId, role)` liga usuário a salão. Um dono pode ter vários salões, um profissional atua num salão.
- **Todo acesso a dados via `getTenantContext()`** (ver `src/lib/tenant.ts`) — ele resolve o `salonId` ativo a partir da sessão e todo `where` inclui esse filtro. Isso previne vazamento cross-tenant.
- Quando você escalar >200 salões e a mesa `Appointment` ficar quente, prox passos são: (1) particionamento por `salonId` no Postgres, (2) réplicas de leitura, e só então (3) schema-per-tenant.

### RLS (defense-in-depth) — preparado, **não ativado**

Se uma Server Action esquecer o filtro `salonId`, o código não protege — mas o banco poderia. Os arquivos em `prisma/sql/rls/` implementam isso, e **nenhum deles foi aplicado**.

| Arquivo | O que faz | Seguro rodar hoje? |
|---|---|---|
| `00_diagnose_rls.sql` | Só leitura. Mostra dono das tabelas, RLS ativo e policies existentes | ✅ sim |
| `01_enable_rls.sql` | Liga o RLS e cria as policies | ❌ não — ver pré-requisitos |
| `02_rollback_rls.sql` | Desfaz o `01`. Não altera dado | ✅ (só faz sentido após o 01) |
| `03_create_app_role.sql` | Cria a role de banco dedicada da aplicação | ✅ — não muda nada em produção sozinho |

**Já rodamos o `00` em produção.** Duas descobertas:

- A role `postgres` (a que `DATABASE_URL` usa hoje) tem **`rolbypassrls = true`**. Essa role ignora RLS sempre, com ou sem `FORCE ROW LEVEL SECURITY` — não existe policy que a alcance. Enquanto a aplicação conectar como `postgres`, ativar RLS não protegeria nada. `03_create_app_role.sql` resolve isso: cria uma role sem esse atributo, com só o DML que a aplicação precisa.
- RLS já está **ligado** nas 20 tabelas (provavelmente um default do Supabase ao criar tabela pelo painel), mas **sem nenhuma policy**. Consequência: qualquer role que não seja `postgres` já recebe zero linhas hoje. É esperado — só volta a funcionar depois do `01`.

Ativar exige antes um trabalho de aplicação que ainda não foi feito, porque três caminhos consultam o banco sem contexto de salão e parariam de funcionar:

1. **Resolução do tenant** — `getTenantContext()` lê `Membership` justamente para descobrir o salão. Precisa da GUC `app.current_user_id` (ver `withUser`).
2. **Rotas públicas** — `/book/*`, `/api/availability` e `/api/appointments` derivam o salão do slug, não da sessão. Precisam de `withSalon`.
3. **Cadastro** — cria Salon + Membership + Service numa transação sem salão ativo; precisa setar a GUC logo após criar o salão.

Os utilitários estão em `src/lib/prisma-tenant.ts` (`withTenant`, `withSalon`, `withUser`). Falta migrar as ~241 chamadas a `prisma.*` espalhadas por 39 arquivos, e só então trocar `DATABASE_URL`/`DIRECT_URL` para a role nova — os passos em ordem estão no cabeçalho de `03_create_app_role.sql`.

## BI / Dashboard

`src/lib/kpis.ts` traz as queries prontas:

- `getRevenueByDay(salonId, from, to)` — faturamento diário
- `getOccupancyRate(salonId, from, to)` — % de horas ocupadas vs. horas disponíveis
- `getTopServices(salonId, from, to)` — serviços por receita e por volume
- `getProfessionalPerformance(salonId, from, to)` — comissão e faturamento por profissional

Todas retornam agregados prontos para os `<BarChart>` e `<LineChart>` do Recharts.
