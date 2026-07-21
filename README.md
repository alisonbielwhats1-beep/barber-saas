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

### RLS (defense-in-depth)

Se um dia uma Server Action esquecer o filtro `salonId`, o filtro no código não protege — mas o banco pode. Está tudo pronto pra ativar Row-Level Security:

```bash
# 1. Aplica policies no banco (idempotente)
psql "$DATABASE_URL" -f prisma/migrations/rls/enable_rls.sql

# 2. Nas páginas/actions, troca `import { prisma } from "@/lib/prisma"`
#    por    `import { getTenantPrisma } from "@/lib/prisma-tenant"`
#    e usa  `const db = await getTenantPrisma();`
```

Cada query passa a rodar dentro de uma transação que seta `app.current_salon` via `set_config`; as policies em `prisma/migrations/rls/enable_rls.sql` comparam com esse GUC. Login/signup/booking público continuam usando o `prisma` cru (não têm tenant na sessão ainda).

## BI / Dashboard

`src/lib/kpis.ts` traz as queries prontas:

- `getRevenueByDay(salonId, from, to)` — faturamento diário
- `getOccupancyRate(salonId, from, to)` — % de horas ocupadas vs. horas disponíveis
- `getTopServices(salonId, from, to)` — serviços por receita e por volume
- `getProfessionalPerformance(salonId, from, to)` — comissão e faturamento por profissional

Todas retornam agregados prontos para os `<BarChart>` e `<LineChart>` do Recharts.
