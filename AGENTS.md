# Instruções para agentes — Salon SaaS

Este arquivo é a entrada obrigatória para qualquer agente que trabalhe neste
repositório. Antes de alterar código, leia integralmente:

1. `docs/STATUS_ATUAL.md` — fonte canônica do estado implantado;
2. `docs/AMBIENTES.md` — barreiras de desenvolvimento, staging e produção;
3. `docs/DECISOES_PRODUTO.md` — regras já decididas pelo responsável;
4. o documento da fase específica que será alterada.

Se outro documento contradizer `docs/STATUS_ATUAL.md`, prevalece o status mais
recente e a contradição deve ser corrigida no mesmo PR.

## Regras não negociáveis

- Nunca usar Production como ambiente de teste.
- Nunca rodar `prisma db push`, seed, reset ou migration destrutiva em Production.
- Não baixar secrets produtivos para arquivos versionados ou logs.
- Não aplicar SQL manual sem preflight, identificação inequívoca do projeto,
  backup adequado, rollback e autorização explícita.
- Não reaplicar migrations só porque estão em `prisma/sql/manual/`.
- Não desativar RLS, autenticação ou autorização para contornar erro.
- Toda operação tenant-scoped deve usar `withTenant`, `withSalon`, `withUser`,
  `withSalonBySlug` ou `withInviteToken`, conforme o contexto.
- Validar tenant, papel e propriedade no servidor; esconder UI não autoriza.
- Cancelamentos, suspensões e cobranças não devem apagar histórico.
- Não adicionar serviço pago, WhatsApp/SMS automático ou gateway de pagamento
  sem autorização do responsável pelo produto.

## Estado técnico resumido

- Next.js 15.5 App Router, React 18, TypeScript estrito.
- Prisma 5 + PostgreSQL/Supabase; runtime usa pooler e migrations usam conexão
  direta quando autorizadas.
- NextAuth Credentials + sessão JWT.
- Tailwind/Radix, Vitest e CI com PostgreSQL 16 descartável.
- Multi-tenant por `salonId` + `Membership` + RLS/GUCs no PostgreSQL.
- Produção: `https://salon-saas-ruby.vercel.app`, branch `master`.
- Administrador global: `PlatformRole.SUPER_ADMIN`, rota `/plataforma`.
- `PLATFORM_BILLING_ENABLED` permanece `false` até a migration manual `011`
  ser validada fora de Production e aplicada com autorização.

## Banco e migrations

Há dois históricos diferentes e ambos precisam ser considerados:

- `prisma/migrations/`: migrations rastreadas pelo Prisma;
- `prisma/sql/manual/`: mudanças controladas com preflight/rollback, nem todas
  pertencem ao histórico `_prisma_migrations`.

O código atual depende das estruturas das migrations manuais `008`, `009` e
`010`. Não as reaplique. Primeiro confirme o estado com consultas somente
leitura e compare objetos/constraints/policies. A migration `011` está
versionada, mas deliberadamente não foi aplicada em Production.

RLS está ativa no ambiente produtivo para as tabelas cobertas, e a aplicação
usa a role `app_runtime` sem `BYPASSRLS`. Não conectar o runtime como `postgres`.

## Fluxo de trabalho

1. Confirmar `git status -sb`, branch e `origin/master` atualizado.
2. Criar branch `codex/<escopo>`.
3. Medir/auditar o comportamento antes da alteração.
4. Implementar a menor mudança coerente com os padrões existentes.
5. Rodar, no mínimo:

   ```bash
   npm run lint
   npx tsc --noEmit --incremental false
   npm test
   npm run build
   ```

6. Mudança de banco exige também o job `schema-smoke` e testes PostgreSQL.
7. Abrir PR, aguardar CI e Preview, e só promover após aprovação.
8. Após deploy, verificar home, rota alterada e erros de runtime da Vercel.

## Áreas principais

- Painel do estabelecimento: `src/app/(admin)`
- Administração global: `src/app/(platform)/plataforma`
- Cliente/agendamento público: `src/app/book/[salonSlug]`
- APIs: `src/app/api`
- Domínio e segurança: `src/lib`
- Schema: `prisma/schema.prisma`
- RLS: `prisma/sql/rls`
- Migrations manuais: `prisma/sql/manual`
- Testes: `src/lib/__tests__` e `tests`

## Antes de declarar concluído

Informe arquivo alterado, comportamento, comando de teste e resultado. Não
declare migration, deploy ou correção como realizada sem evidência verificável.
