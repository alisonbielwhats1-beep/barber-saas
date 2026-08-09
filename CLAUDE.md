# Contexto para Claude — Salon SaaS

Leia primeiro e integralmente:

1. `AGENTS.md`;
2. `docs/STATUS_ATUAL.md`;
3. `docs/HANDOFF_NOVA_CONVERSA.md`;
4. `docs/AMBIENTES.md`;
5. `docs/DECISOES_PRODUTO.md`.

Esses arquivos substituem handoffs históricos. Não use credenciais de
Production, não rode `db:push`/seed contra Supabase e não reaplique migrations
manuais sem preflight e confirmação somente leitura.

Stack atual: Next.js 15.5, React 18, TypeScript, Prisma/PostgreSQL Supabase,
NextAuth, Tailwind/Radix, Vitest e Vercel.

Produção: `https://salon-saas-ruby.vercel.app`.

Credenciais, passwords e secrets nunca devem ser documentados ou solicitados
em texto. Use o fluxo de autenticação e os painéis dos provedores.
