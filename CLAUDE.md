# Contexto do projeto — Salon SaaS

SaaS multi-tenant de gestão e agendamento para salões/barbearias.
Este arquivo é lido automaticamente pelo Claude Code — serve de handoff entre
máquinas, já que o histórico de conversa do Claude Code **não** sincroniza.

## Onde está tudo

| O quê | Onde |
|---|---|
| Repositório | https://github.com/alisonbielwhats1-beep/barber-saas |
| App em produção | https://salon-saas-ruby.vercel.app |
| Booking do cliente | `/book/luna-hair` · `/book/north-barber` |
| Banco + Storage | Supabase, projeto `barber-saas`, região São Paulo (sa-east-1) |
| Hospedagem | Vercel, projeto `salon-saas` |

## Credenciais

Nunca no repositório. Para obter numa máquina nova:

```bash
npx vercel link && npx vercel env pull .env
```

Logins de demonstração (banco já populado):
`dono@lunahair.com` / `demo1234` — `dono@northbarber.com` / `demo1234`

## Stack

Next.js 14 (App Router, Server Components/Actions) · TypeScript · Tailwind +
primitivos shadcn/Radix · Prisma + PostgreSQL · NextAuth (credentials + JWT) ·
Recharts · date-fns.

## Estado atual

Aplicação completa e funcionando em produção. O banco Supabase já tem schema
aplicado **e dados demo** — não rode `db:push`/`db:seed` contra ele.

Redesign do admin concluído: tema dark (`#0B0B0B`) com âmbar `#F59E0B`,
sidebar estilo Linear, em todas as telas (dashboard, agenda, serviços,
produtos, profissionais, clientes, portfolio, login, signup).

**Importante:** o booking do cliente (`/book/*`) usa outro tema — verde neon,
via `[data-theme="salon-dark"]` no `globals.css`. O laranja é **só do admin**.
Não unifique os dois sem pedir.

## Armadilhas já resolvidas (não repetir)

1. **Host do pooler Supabase é `aws-1-sa-east-1`, não `aws-0`.** Cada projeto
   vive num pooler específico. Com o host errado o Postgres responde
   `FATAL: Tenant or user not found` mesmo com senha correta. Custou horas.

2. **`DATABASE_URL` precisa de `?pgbouncer=true`** (porta 6543, transaction
   mode). Sem isso o Prisma falha intermitente com
   `prepared statement "s0" already exists` (42P05). A `DIRECT_URL`
   (porta 5432, session mode) não leva o parâmetro.

3. **Não passe função de Server para Client Component.** Passar ícone lucide
   como prop do `layout.tsx` para um client component quebrou o `/dashboard`
   com `Functions cannot be passed directly to Client Components`. Por isso a
   navegação vive em `src/app/(admin)/sidebar-nav.tsx` ("use client"), que é
   dono da lista e dos ícones.

4. **Ao gravar env var na Vercel, use redirecionamento de arquivo.** Pipe do
   PowerShell grava valor corrompido silenciosamente — foi o que fez o
   `DATABASE_URL` chegar inválido em produção e derrubar o app:
   ```bash
   printf '%s' 'valor' > /tmp/v.txt
   npx vercel env add MINHA_VAR production < /tmp/v.txt
   ```

5. **Trocar `NEXTAUTH_SECRET` invalida sessões existentes.** Cookies antigos
   passam a dar `JWT_SESSION_ERROR: decryption operation failed` até o usuário
   deslogar e logar de novo. Não é bug de código.

6. **`useSearchParams` exige `<Suspense>`** para o build de produção passar
   (aconteceu no `/login`).

## Isolamento multi-tenant

Toda tabela tenant-scoped tem `salonId` + índice; `Membership(userId, salonId,
role)` liga usuário a salão. **Todo acesso a dados passa por
`getTenantContext()`** (`src/lib/tenant.ts`), que resolve o `salonId` ativo da
sessão — é o que impede vazamento entre salões. Há RLS pronto para ativar em
`prisma/migrations/rls/enable_rls.sql` (ver README).

## Pendências conhecidas

- O login pelo formulário foi validado via API do NextAuth, não digitando nos
  campos (a automação de browser não mantinha texto em input controlado do
  React). Vale um teste manual.
- `/configuracoes` está no menu lateral mas a página ainda não existe.
