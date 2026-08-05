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

**7 fases do roadmap premium concluídas:**

- Fase 1 — Dashboard reconstruído, design system semântico, filtro de período
- Fase 2 — Agenda pro: cores por status, drag-to-move, visões Dia/Semana/Mês/Lista, ações rápidas
- Fase 3 — Financeiro: modelo `Expense`, DRE, fluxo de caixa, contas a pagar/receber
- Fase 4 — Catálogo: custo/margem/popularidade em serviços e produtos, alertas de estoque
- Fase 5 — Pacotes & Planos: `Package`/`PackagePurchase`/`MembershipPlan`/`ClientSubscription`, MRR
- Fase 6 — CRM (`src/lib/crm.ts`): LTV, segmentação VIP/sumido/aniversariante, Marketing com WhatsApp
- Fase 7 — Relatórios (CSV/PDF), command palette ⌘K, toasts, skeletons, `/configuracoes`

**Módulos no admin (sidebar agrupada):**
Principal: Dashboard, Agenda
Catálogo: Serviços, Produtos, Pacotes, Portfolio
Pessoas: Clientes (CRM), Profissionais
Financeiro: Financeiro, Relatórios (Pagamentos: `soon: true`)
Crescimento: Marketing
+ Configurações

**Salões de demo no banco:**
- `dono@lunahair.com` / `demo1234` — Luna Hair Studio
- `dono@northbarber.com` / `demo1234` — North Barber
- Studio Martinelli (seed separado em `scripts/seed-martinelli.ts`)

**Importante:** o booking do cliente (`/book/*`) usa tema verde neon via
`[data-theme="salon-dark"]` no `globals.css`. O âmbar `#F59E0B` é só do admin.
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

7. **As env vars da Vercel são "Sensitive"** — `vercel env pull` grava o
   placeholder `[SENSITIVE]` no lugar do valor. Não dá pra recuperar
   credenciais pela CLI; a `DATABASE_URL` precisa ser montada com a
   connection string do painel do Supabase (Connect → Transaction pooler).

8. **Resetar a senha do banco no Supabase derruba a produção**: a
   `DATABASE_URL`/`DIRECT_URL` guardadas na Vercel ficam com a senha antiga
   e todo request dá `Authentication failed`. Após reset, atualizar as duas
   vars na Vercel (via arquivo, ver armadilha 4) e rodar `vercel redeploy`.

9. **Toda tabela nova criada no Supabase nasce com RLS ativo e zero policy.**
   RLS ativo + zero policy = bloqueia geral (fail-closed) pra qualquer role
   sem `BYPASSRLS` — foi isso que derrubou login em produção por alguns
   minutos na ativação do RLS (04/08/2026): `User` tinha RLS ligado pelo
   padrão do Supabase mas ninguém tinha desativado explicitamente, e o
   diagnóstico original contou "20 tabelas" sem incluir `User`, escondendo o
   problema. Ao criar tabela nova: ou ela entra em `01_enable_rls.sql` com uma
   policy, ou leva um `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` explícito
   — nunca deixe implícito que uma tabela "está de fora" do RLS.

## Isolamento multi-tenant

Toda tabela tenant-scoped tem `salonId` + índice; `Membership(userId, salonId,
role)` liga usuário a salão. Todo acesso a dados tenant-scoped passa pelos
helpers de `src/lib/prisma-tenant.ts` (`withTenant`/`withSalon`/`withUser`/
`withSalonBySlug`/`withInviteToken`), que abrem uma transação e setam as GUCs
(`app.current_salon`, `app.current_user_id`, `app.invite_token_hash`) antes de
qualquer query. `getTenantContext()` (`src/lib/tenant.ts`) resolve o `salonId`
ativo da sessão por cima disso.

**RLS está ATIVO em produção desde 04/08/2026.** `DATABASE_URL`/`DIRECT_URL`
conectam como a role `app_runtime` (sem `BYPASSRLS`, criada por
`03_create_app_role.sql`), e as policies de `prisma/sql/rls/01_enable_rls.sql`
estão aplicadas nas 21 tabelas. O filtro `salonId` nas queries continua
existindo como defesa em profundidade, mas o isolamento real agora é reforçado
pelo próprio banco: uma query sem a GUC certa volta vazia em vez de vazar dado
de outro salão. Rollback disponível em `02_rollback_rls.sql` se algo quebrar
(não apaga dado, só remove policies e a exigência de contexto).

Duas rotas fogem do padrão `withTenant`/`withSalon`, documentadas nos próprios
arquivos: `api/cron/reminders` (varre todos os salões, um `withSalon` por
salão — não há conexão com `BYPASSRLS`) e `src/lib/invitations.ts` (leitura de
convite por token usa `withInviteToken`, que seta uma GUC própria só de
leitura — ver seção 6 de `01_enable_rls.sql`).

## Roadmap

Plano de evolução (abas do dono e do cliente, financeiro, multi-salão) em
`ROADMAP.md` — ordem de execução sugerida no fim do arquivo.

## Pendências conhecidas

- O login pelo formulário foi validado via API do NextAuth, não digitando nos
  campos (a automação de browser não mantinha texto em input controlado do
  React). Vale um teste manual.
- `/pagamentos` está no menu com `soon: true` (renderiza desabilitado) — não tem página ainda.
- Billing do próprio SaaS (Stripe por `Plan` FREE/STARTER/PRO) não implementado.
- Envio real de WhatsApp/SMS (Marketing dispara link de wa.me, não Evolution API/Twilio).
- **Convites por e-mail não ativados.** `src/lib/mailer.ts`/`email-invites-feature.ts`
  já suportam Resend, mas em produção faltam `RESEND_API_KEY`, `EMAIL_FROM` e o
  flag `EMAIL_INVITES_ENABLED` — hoje convidar alguém cai em contingência
  controlada (falha fechada), não em e-mail de verdade. Roteiro de ativação:
  verificar domínio no Resend → configurar as 3 vars primeiro em Preview →
  testar criar/entregar/reenviar/revogar/aceitar → só então repetir em
  Production.
