# Ambientes seguros

## 26/09/2026, 13:24 BRT — staging corrigido ON para teste manual

Após autorização explícita, candidato `Rc178sgIPRIkRYhtUSoDt` instalado e
iniciado somente para Fixture A / Tatiana A. Preflight de identidade,
RLS/FORCE e isolamento PASS; 62 tabelas inalteradas. Sete páginas autenticadas
HTTP 200. Nenhuma mensagem, confirmation ou chamada paga realizada no preparo.
Limite original preservado: 8/20 tentativas consumidas, 12 restantes.
Validação conversacional manual e dispositivo físico continuam pendentes.
Production não acessada. Os registros OFF/local-only abaixo são históricos.
[Acesso, evidência e desligamento atual](./SECRETARY_STABILIZATION_MANUAL_SESSION.md).

26/09/2026 — após a auditoria, responsável autorizou a estabilização e validação
local. Suíte única: 2.715 testes/294 arquivos PASS, lint/TypeScript/build PASS.
Nenhum runtime da aplicação, deploy ou inferência paga foi iniciado.
Staging permanece no último OFF comprovado, Production não acessada. O registro
de suspensão abaixo é histórico. Ver `SECRETARY_CONVERSATION_STABILIZATION.md`.

26/09/2026 — escopo atual: auditoria e plano exclusivamente. Não retomar builds,
runtime, inferências, fixtures ou deploy automaticamente. Último staging OFF
preservado; Production não acessada. Ver `SECRETARY_LUNA_PIPELINE_AUDIT.md`.

Atualização 26/09/2026, 11:55 BRT: staging manual OFF durante correção de
continuidade de horário. Candidato com 2.695 testes PASS, lint/TS/build local PASS;
publicação bloqueada pelo SIGTERM no build do Codespace. Nenhuma retomada pela mera transferência de
código: exigir build válido e preflight do mesmo tenant/user. Journals e limite
da sessão permanecem preservados; Production não acessada.

Atualização 26/09/2026, 11:33 BRT: sessão manual retomada após correção exclusiva
dos observadores de staging. Mesmo build/ator/limite; journals preservados.
RLS/isolamento PASS, operacional/Outbox intactos. Reteste manual da continuação
pendente. Ver `SECRETARY_MANUAL_PROVIDER_FIX.md`. Nenhum acesso a Production.

Este documento define a separação de ambientes do Salon SaaS. A regra central
é simples: nenhum teste, seed, preview ou migration de desenvolvimento pode
usar o projeto Supabase de produção.

## 26/09/2026, 10:55 BRT — sessão manual controlada aberta

Mesmo candidato temporal de staging ligado exclusivamente para fixture A/owner
autorizados. Preflight e health PASS, zero chamadas pagas no preparo; orçamento
separado de 20 tentativas. JEV e integrações externas OFF. Usuário realizará
mensagens e confirmações diretamente. Fechamento/OFF e reconciliação aguardam
o término informado pelo usuário. Production não acessada.
[Sessão e comando de desligamento](./SECRETARY_MANUAL_STAGING_SESSION.md).

## 26/09/2026, 09:55 BRT — candidato temporal revalidado e OFF

Candidato isolado `X_pW4ibxpeH-NHIM1dIDS`, mesmo Codespace/DB/Redis de staging.
G revalidado com uma chamada: domingo fechado, HARD_BLOCK e confirmação
desabilitada. Reconciliação de 62 tabelas: somente seis AuditLogs esperados;
zero mutation. RLS/FORCE/isolation preservados. OFF às 12:55:23Z: sete flags
false, allowlist vazia, runtime encerrado, envio/confirmation ECONNREFUSED.
E/E2 sem contrato de comunicação em staging; D inicial UNKNOWN. Nenhum acesso
a Production; gate físico obrigatório antes de qualquer avanço produtivo.
[Relatório atual](./SECRETARY_TEMPORAL_GROUNDING_V1.md).

## 26/09/2026, 00:45 BRT — janela de voz encerrada por STOP

Último candidato isolado `ByvUBGEMeRUNqOarMGpz7`, no mesmo Codespace/DB/Redis
de staging abaixo. Sete flags OFF, admissão vazia, runtime encerrado e probes de
mensagem/confirmação ECONNREFUSED às 03:45:44Z. RLS/FORCE/isolamento preservados;
apenas AuditLogs esperados diferem no fechamento. Nenhum recurso produtivo usado.

A voz gerou uma proposal para sábado a partir de "domingo". Não confirmada;
SAFETY_FAILURE=1, zero mutation inesperada. O candidato não está liberado para
Production. [Relatório atual de voz](./SECRETARY_AUTOMATED_VOICE_V1.md).

## Atualização de 25/09/2026, 21:15 BRT — staging operacional validado e OFF

Codespace privado `glorious-enigma-jjv6v4rvrv49f544r`, candidato na porta 3001,
DB `everflair_billing_staging` (system ID `7682424799483236389`) e Redis interno
revalidados. RLS/FORCE e role `app_runtime` sem SUPERUSER/BYPASSRLS preservados;
probes A/B/no-context e ator não admitido PASS. Nenhum uso do Preview compartilhado.

Final OFF comprovado em 26/09/2026 às 00:04:15Z: sete flags false, admissão
vazia, configurações ativas sem chave/preload de paid calls, processo encerrado
e porta 3001 livre. Mensagens/confirmações bloqueadas antes e depois de encerrar
o processo. Snapshots dos 62 conjuntos de linhas idênticos nos controles OFF;
zero chamada paga nova. Demo 3000 preservada. Production não acessada.

SECRETARY_STAGING_OPERATIONAL = VALIDATED; STT físico/multi-turn pendentes.
Readiness NOT_VALIDATED e piloto NO até aparelho/OS/navegador e bateria física.
[Fechamento atual](./SECRETARY_STAGING_FINAL_CANARY_CLOSURE.md).

## Histórico de 25/09/2026, 21:29Z — primeira reconciliação

O adapter exclusivo do Codespace corrigiu a origem reescrita pelo proxy sem
desativar CSRF. Três chamadas OpenAI autorizadas concluídas; leitura/clarificação
PASS. Captura do resultado seguinte interrompida pela ferramenta do navegador.
Runtime 3001 desligado, flags e paid calls OFF. Baseline, RLS/FORCE e isolamento
preservados; zero confirmações e zero efeito operacional inesperado. Os 17
AuditLogs técnicos foram classificados pelo ator/tenant e ação publicados.
Demo 3000 e Production preservados; nenhum recurso pago novo criado.
Staging readiness ainda NOT_VALIDATED; STT físico pendente.
[Resultado atual](./SECRETARY_STAGING_ORIGIN_RESUME.md).

## Histórico anterior — candidato privado, smoke inicialmente bloqueado

Artefato Linux `XYqNZnD8YqIYPSOKdaUWB` instalado somente no Codespace
existente, porta 3001 Private. Demo 3000 e Production preservados.
Preflight de lançamento e login sintético PASS; primeira Server Action
rejeitada por diferença entre Origin localhost:3001 e x-forwarded-host do
domínio privado. Zero chamada OpenAI registrada. Na retomada, processo ausente
e depois UI `Stopping codespace`; motivo do encerramento não comprovado.
Não autorizar smoke com proteção de origem desativada. Recomeçar em OFF e
revalidar identidade/isolamento antes do próximo lançamento.
[Evidências e pendências](./SECRETARY_STAGING_ORIGIN_RESUME.md).

## Histórico da auditoria de 25/09/2026 — Secretária, antes do deploy privado

Vercel ainda tem o projeto `salon-saas`; Preview não é staging isolado:
KV_REST_API_URL, REDIS_URL, KV_URL, KV_REST_API_READ_ONLY_TOKEN e KV_REST_API_TOKEN
aparecem com escopo Production and Preview na integração Upstash. Somente
metadados foram lidos; nenhum valor, Redis, DB ou configuração produtiva foi
acessado/alterado. Esse Preview foi recusado para o Gate da Secretária.

Inventário Supabase da organização `busaqxeiqfqijhltlupz` mostrou dois projetos,
`vgwfhiqjxfjnygarsqpt` e `vshnatkzxdekkvqttvbv`, ambos reservados a produção
conforme as decisões anteriores. Nenhum foi aberto para consultar dados.

CLI GitHub continua sem escopo Codespaces (403); isso foi contornado somente
pelo login manual autorizado no navegador interno do Codex, na conta correta
alisonbielwhats1-beep. Não se reutilizou a sessão Chrome da outra conta.
O Codespace existente foi auditado: DB everflair_billing_staging em loopback,
app_runtime sem SUPERUSER/BYPASSRLS; Redis interno redis-http/redis:6379,
isolado de Production. Porta 3000 da demo preservada Private; 3001 reservada
ao candidato, ainda sem deploy. Duas migrations já publicadas aplicadas apenas
ao banco staging após backup; policies/grants/dados anteriores preservados.
[Inventário atualizado](./SECRETARY_STAGING_CODESPACE_INVENTORY.md) e
[delta/rollback](./SECRETARY_CODESPACE_STAGE_UPGRADE.md).
Em 25/09, GitHub Budgets mostrava Codespaces com orçamento $0, Stop usage Yes
e $0 spent; Usage mostrava $0 billed. Nenhum limite foi aumentado.

## Atualização de 13 de setembro de 2026 — staging Billing preparado

O Codespace existente ganhou checkout separado `/workspaces/everflair-billing-staging`
no commit `6122e6e`, banco sintético `everflair_billing_staging` em loopback e
runtime `app_runtime` sem superusuário/BYPASSRLS. A demonstração antiga e sua
porta privada 3000 foram preservadas. Build, verificações das migrations
Billing/HQ e 27 integrações passaram; os testes executaram em cópia sintética
separada `everflair_billing_validation_20260913`. Nenhum dado produtivo foi copiado.
Detalhes e limites em `RELEASE_MERCADOPAGO_2026-09-13.md`.

## Histórico de 13 de setembro de 2026 — Codespace identificado

O Codespace `glorious-enigma-jjv6v4rvrv49f544r` foi localizado na conta
`alisonbielwhats1-beep` e iniciado pelo navegador. O proprietário autorizou
confiar somente na pasta `/workspaces/barber-saas` para o inventário. Branch
`codex/everflair-demo`, commit `106ac11`, checkout limpo. Consulta somente leitura
confirmou banco `everflair_demo` em `127.0.0.1:5432`, usuário `app_runtime`,
`rolsuper=false` e `rolbypassrls=false`.

A aplicação antiga está na porta 3000, rotulada Everflair Demo, com visibilidade
**Private** e endereço
`https://glorious-enigma-jjv6v4rvrv49f544r-3000.app.github.dev/`. A abertura pelo
navegador retornou HTTP 401 no encaminhamento privado. Não houve mudança de
visibilidade, schema, dados ou versão implantada. Esse ambiente de demonstração
foi identificado; ainda não contém o PR #101 nem oferece um endpoint público
durável para webhooks. Os dois projetos Supabase existentes continuam reservados
para produção e não foram usados nos testes.

O CLI GitHub continua sem escopo `codespace`; o acesso acima foi pelo navegador
autenticado na conta proprietária. A evidência externa do billing é registrada em
`MERCADOPAGO_PORTAL_HQ.md` e usa banco local sintético distinto desse Codespace.

## Atualização de 6 de setembro de 2026 — demonstração no GitHub

Atualização posterior, 07/09: o responsável solicitou uma conta de apresentação
persistente no Supabase produtivo, como um novo cliente. A provisão aditiva foi
concluída após preflight e backup, preservando os registros anteriores. Esse
tenant não substitui homologação nem autoriza testes/migrations em Production.
Escopo em `CORES_E_APRESENTACAO_2026-09-07.md`. O Codespace anteriormente citado
não está disponível nesta tarefa; a revisão visual usa PostgreSQL local sintético
e os testes automatizados usam o PostgreSQL descartável do GitHub Actions.

Atualização posterior, 07/09: o responsável autorizou o deploy e merge do PR #79
em produção. As migrations 018/019 foram aplicadas manualmente ao projeto
produtivo identificado, após homologação no GitHub, preflight, backup e plano
de rollback. Evidências em `RELEASE_PRODUCAO_2026-09-07.md`. Essa publicação não
autoriza testes, seed, cópia de dados para desenvolvimento ou migrations futuras.

Por decisão do proprietário, não foi criado outro projeto Supabase. A demonstração usa o Codespace `glorious-enigma-jjv6v4rvrv49f544r`, branch `codex/everflair-demo`, PostgreSQL e Redis locais isolados e somente dados fictícios. A aplicação usa uma role de runtime sem BYPASSRLS. Credenciais ficam exclusivamente em `.demo/`, ignoradas pelo Git. O acesso público da porta da aplicação depende de autorização; banco e Redis permanecem privados.

A proposta de um segundo Supabase descrita abaixo é histórica e não foi executada. Os dois projetos Supabase existentes continuam destinados às aplicações de produção. O Codespace pode hibernar e não substitui hospedagem de produção.

O responsável autorizou validar as próximas mudanças no GitHub. Na tarefa
`codex/product-experience`, o acesso disponível permite executar Actions, mas
retorna 403 para Codespaces por falta de escopo `codespace`. A validação 018 usa
o PostgreSQL 16 descartável do schema-smoke, incluindo login e operação no
navegador. Isso não equivale a atualizar a demonstração persistente no Codespace.

## Arquitetura proposta anteriormente

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

`PUBLIC_BOOKING_URL` é uma origem opcional para divulgação (Compartilhar,
QR Code e Marketing), separada de `NEXTAUTH_URL`. Em Production, o domínio
oficial validado em 13/09/2026 é `https://everflair.com.br`; o endereço
`https://salon-saas-ruby.vercel.app` permanece associado ao mesmo projeto,
sem redirecionamento obrigatório. Em desenvolvimento/CI, deixar a variável
ausente ou usar loopback. Não copiar configuração produtiva para Preview.
Alterações nessa variável exigem novo deployment para entrar em vigor.

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
- A conta já possui dois projetos Supabase ativos, ambos destinados a produção.
  Nenhum terceiro projeto foi criado. O Codespace de demonstração foi
  identificado em 13/09 conforme atualização acima; não há Supabase de staging
  nem Preview autenticável de billing configurado.
- A wave1 implantada pelos PRs #50/#51 adiciona testes PostgreSQL de
  concorrência de agenda, comanda/estoque e lock de aprovação versus suspensão
  ao `schema-smoke`; a execução no CI remoto foi comprovada em PostgreSQL 16,
  inclusive com role runtime `NOBYPASSRLS` e FORCE RLS.
- A candidata `codex/commercial-readiness-audit` acrescenta Playwright ao
  `schema-smoke`: páginas públicas rodam em Chromium, Firefox e WebKit; login,
  isolamento visual de tenant e agendamento completo rodam em Chromium contra
  o mesmo PostgreSQL 16 descartável, antes dos rollbacks de schema.
- A migration manual `017_password_recovery` é somente aditiva, possui
  preflight read-only e é reaplicável. O rollback seguro é promover o commit
  anterior e manter as novas colunas inertes; removê-las apagaria tokens e
  versões de sessão sem necessidade e, por isso, não faz parte do rollback.
- O teste de lock público identifica o backend concorrente por
  `application_name` e exige evidência positiva em `pg_stat_activity` e
  `pg_blocking_pids`, evitando aprovação por mero atraso do pool.
- A máquina usada na wave não possui PostgreSQL/Docker e não dispõe de staging
  autenticável. Testes de banco continuam exclusivos do PostgreSQL efêmero do
  CI; jornadas autenticadas exigem staging inequivocamente seguro.
- Production final: commit `6465123`, deploy
  `dpl_65KHBGkS2SGbd6HdMGTCKopLqV6B`, estado `READY`. O rollback do primeiro
  deploy da wave foi executado e validado antes do hotfix #51.

