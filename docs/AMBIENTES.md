# Ambientes seguros

Este documento define a separação de ambientes do Salon SaaS. A regra central
é simples: nenhum teste, seed, preview ou migration de desenvolvimento pode
usar o projeto Supabase de produção.

## Arquitetura adotada

| Ambiente | Aplicação | Banco | Fonte de dados | Custo adicional esperado |
|---|---|---|---|---|
| Desenvolvimento local | Next.js local | PostgreSQL 16 local | Sintéticos | Nenhum |
| Teste automatizado | GitHub Actions | PostgreSQL 16 efêmero por job | Sintéticos | Nenhum no limite do GitHub Free |
| Homologação | Vercel Preview da branch `staging` | Segundo projeto Supabase Free | Sintéticos | Nenhum enquanto permanecer nos limites gratuitos |
| Produção | Vercel Production da branch `master` | Projeto Supabase atual | Reais | Plano atual |

O GitHub executa os testes, mas não substitui uma aplicação e um banco de
homologação persistentes. A Vercel cria previews por branch/PR e o segundo
projeto Supabase fornece o banco isolado. Na data desta decisão, o plano Free
do Supabase permite dois projetos ativos e o Vercel Hobby oferece Preview
Deployments; os limites devem ser conferidos novamente antes da ativação.

Referências oficiais:

- <https://supabase.com/pricing>
- <https://supabase.com/docs/guides/platform/billing-faq>
- <https://vercel.com/docs/git>
- <https://vercel.com/docs/environment-variables>
- <https://docs.github.com/actions/tutorials/use-containerized-services/create-postgresql-service-containers>

## Regras invariáveis

1. Produção nunca é copiada para desenvolvimento, teste ou homologação.
2. Somente dados fictícios podem ser usados fora de produção.
3. Secrets nunca entram no Git, em logs ou em artefatos do CI.
4. Pull requests usam apenas o PostgreSQL efêmero do próprio job.
5. Preview da Vercel nunca recebe variáveis de produção.
6. Preview sem `APP_ENV=staging` permite somente a landing `/` e seus assets
   estáticos versionados em `/images/` para revisão visual; autenticação,
   agendamento, APIs e painéis permanecem bloqueados com HTTP 503.
7. Nenhuma migration produtiva é executada automaticamente nesta fase.
8. O projeto Supabase de produção e o de homologação precisam ter project refs
   diferentes, verificados automaticamente antes de qualquer escrita.
9. `db:seed` é destrutivo e só funciona em banco descartável com confirmação
   explícita.

## Variáveis por ambiente

### Desenvolvimento local

Use um `.env` criado localmente a partir de `.env.example`; nunca use um arquivo
obtido do ambiente produtivo da Vercel:

```env
APP_ENV=development
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/salon_dev
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:5432/salon_dev
NEXTAUTH_URL=http://localhost:3001
```

`APP_ENV=development` aceita somente `localhost`, `127.0.0.1`, `::1` ou o
hostname interno `postgres`.

O arquivo `compose.dev.yml` oferece PostgreSQL local opcional:

```bash
docker compose -f compose.dev.yml up -d
```

Para encerrar sem apagar o volume:

```bash
docker compose -f compose.dev.yml stop
```

### Teste automatizado

O workflow fornece estas variáveis sem secrets externos:

```env
APP_ENV=test
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/salon_ci
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/salon_ci
```

Cada job recebe um banco novo. Ao terminar o job, o container é descartado.

### Homologação

Identificar um projeto Supabase não produtivo, por exemplo
`barber-saas-staging`. Na Vercel, cadastrar as variáveis somente no ambiente
Preview e, quando possível, restringi-las à branch `staging`:

```env
APP_ENV=staging
SUPABASE_PROJECT_REF=<project-ref-homologacao>
PRODUCTION_SUPABASE_PROJECT_REF=<project-ref-producao>
SUPABASE_URL=https://<project-ref-homologacao>.supabase.co
DATABASE_URL=<pooler-homologacao-porta-6543-com-pgbouncer>
DIRECT_URL=<pooler-homologacao-porta-5432>
```

As chaves anon e service role também devem pertencer exclusivamente ao projeto
de homologação. `PRODUCTION_SUPABASE_PROJECT_REF` não é segredo; serve como
lista de bloqueio adicional.

### Produção

Permanece na Vercel e no Supabase atuais. `APP_ENV=production` deve existir no
runtime, porém todos os scripts locais de schema e seed recusam esse valor.
Migrations produtivas ganharão um workflow separado, manual, protegido e com
plano de rollback em uma fase posterior — somente após validação em homologação
e nova autorização.

## Ordem segura para ativar homologação

1. Identificar inequivocamente produção e homologação entre os projetos
   Supabase existentes; criar outro somente se houver vaga no plano e aprovação.
2. Anotar os dois project refs e confirmar visualmente qual é produção.
3. Configurar as variáveis de Preview da Vercel com o segundo projeto.
4. Fazer uma verificação de conexão somente leitura.
5. Aplicar o schema no projeto de homologação com `APP_ENV=staging`.
6. Inserir apenas dados fictícios.
7. Criar/publicar a branch `staging`.
8. Confirmar no Preview o hostname e o project ref esperados antes de testar.

Não publicar a branch `staging` antes do passo 3: um Preview com variáveis
herdadas incorretamente poderia apontar para produção.

## Barreiras automáticas

`src/lib/database-safety.ts` bloqueia:

- ambiente ausente, desconhecido ou produtivo;
- execução com `VERCEL_ENV=production`;
- banco remoto em desenvolvimento/teste;
- URL que não seja PostgreSQL;
- homologação sem os dois project refs;
- project ref de homologação igual ao produtivo;
- URL, `SUPABASE_URL` e project ref divergentes;
- seed destrutivo sem a confirmação
  `YES_I_AM_USING_A_DISPOSABLE_DATABASE`.

Os scripts `db:push`, `db:migrate`, `db:migrate:deploy` e `db:seed` executam a
barreira antes do Prisma. O seed também valida por conta própria para impedir
atalhos como `npx tsx prisma/seed.ts`.

## Migrations e rollback

Cada mudança futura de banco deve conter:

- migration forward versionada;
- inventário das tabelas/índices afetados;
- consulta de preflight somente leitura;
- preservação e backfill dos dados existentes;
- teste em banco efêmero e depois em homologação;
- rollback compatível ou, quando rollback de schema puder perder dados, plano
  de roll-forward documentado;
- verificação pós-migration;
- janela e responsável pela execução produtiva.

Rollback nunca deve apagar dados recém-criados sem exportação e autorização.

## Situação desta fase

- CI com banco efêmero: configurado no repositório.
- Barreiras locais: configuradas no repositório.
- Preview sem `APP_ENV=staging`: somente a landing `/` e seus assets estáticos
  versionados em `/images/` são liberados para revisão visual. O probe exato
  `GET /api/auth/session` recebe `{}` diretamente do guard, sem tocar em
  NextAuth ou banco; outros métodos e todas as demais rotas com dados,
  autenticação ou operação continuam bloqueados no middleware.
- Ambientes GitHub `test`, `staging` e `production`: gerenciados separadamente
  nas configurações do repositório.
- A conta já possui dois projetos Supabase ativos; a classificação segura entre
  produção e homologação e o ajuste das variáveis Vercel Preview estão
  pendentes. Nenhum terceiro projeto foi criado.
- A wave1 implantada pelos PRs #50/#51 adiciona testes PostgreSQL de
  concorrência de agenda, comanda/estoque e lock de aprovação versus suspensão
  ao `schema-smoke`; a execução no CI remoto foi comprovada em PostgreSQL 16,
  inclusive com role runtime `NOBYPASSRLS` e FORCE RLS.
- A candidata `codex/commercial-readiness-audit` acrescenta Playwright ao
  `schema-smoke`: páginas públicas rodam em Chromium, Firefox e WebKit; login,
  isolamento visual de tenant e agendamento completo rodam em Chromium contra
  o mesmo PostgreSQL 16 descartável, antes dos rollbacks de schema.
- O teste de lock público identifica o backend concorrente por
  `application_name` e exige evidência positiva em `pg_stat_activity` e
  `pg_blocking_pids`, evitando aprovação por mero atraso do pool.
- A máquina usada na wave não possui PostgreSQL/Docker e não dispõe de staging
  autenticável. Testes de banco continuam exclusivos do PostgreSQL efêmero do
  CI; jornadas autenticadas exigem staging inequivocamente seguro.
- Production final: commit `6465123`, deploy
  `dpl_65KHBGkS2SGbd6HdMGTCKopLqV6B`, estado `READY`. O rollback do primeiro
  deploy da wave foi executado e validado antes do hotfix #51.
