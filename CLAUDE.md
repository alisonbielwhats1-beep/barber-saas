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

## Escopo e contas

- Este repositório é SOMENTE o EverFlair (Salon SaaS). Código, branches e sessões do GestAcad e do Commerce Platform ficam nos repositórios deles.
- Se o pedido for sobre outro produto, pare e avise o Alison para abrir a sessão no repositório certo.
- GitHub: conta `alisonbielwhats1-beep`. Para `gh`: `GH_TOKEN=$(gh auth token --user alisonbielwhats1-beep) gh ...`
- Em produção, mexer só no que não afeta clientes. O resto vira relatório.
- Estado do produto, clientes e backlog ficam no Brain (`brain/projects/everflair/`), não no código.

## Regras sem teste (Docs Checker com Jev)

- Pedidos como "verifique a parte de convites, papéis, login, tenant ou upload" ou "quais regras não têm teste?" são da skill `jev-rule-check` (skill de usuário, vale em todo projeto). Use-a ANTES de ler o código à mão. O catálogo de regras fica em `.claude/jev-docs-checker.json`.
- Ela só relata e depois você confere à mão. Escrever testes só quando o Alison pedir.
