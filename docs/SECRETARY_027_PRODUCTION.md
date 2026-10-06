# 027 (estado da conversa da Secretária) em Produção

Preparado em 05/10/2026 para o piloto no salão de apresentação. **Nada aplicado.** Cada passo que escreve no banco só com
o ok do dono, na hora.

## O que a 027 cria

Três tabelas novas, só por SQL (sem mudar o `schema.prisma`), todas com RLS forçado:

- `SecretaryConversation`: a conversa em andamento (até 2 h), por salão **e** usuário. Guarda o texto do dono e nomes de
  clientes, por isso precisa da limpeza agendada.
- `SecretaryConversationEvent`: eventos só com códigos, nunca nomes; não aceita alteração.
- `SecretaryNameAlias`: nomes que o dono ensinou ("Walter" → Valter). Só é usada com `SALON_SECRETARY_NAME_ALIASES`, que
  fica desligada no piloto.

É aditiva: não altera nem lê dado existente além das chaves estrangeiras para `Salon` e `User`.

## Conferido em Produção, só leitura (05/10)

`027_secretary_state.production.preflight.sql` → `PREFLIGHT_OK`:

- projeto Supabase de Produção (banco `postgres`, papel de manutenção `postgres` com BYPASSRLS, salão
  `everflair-apresentacao` com o id `541fc7a6-…`);
- papel do app `app_runtime` sem superusuário e sem BYPASSRLS;
- todos os pré-requisitos da versão original (funções de isolamento, RLS de `Membership`, papel `MANAGER`);
- as três tabelas ainda não existem; `pg_cron` disponível e **não instalado**;
- linha de base: **64 tabelas** e **123 políticas** no schema `public`.

O mesmo arquivo recusa o banco local (`everflair_service_mvp`) com `027 production: run on database postgres…`.

## Ordem (cada passo com o ok do dono)

1. **Merge do PR** com o código (a leitura dessas tabelas fica atrás de `SALON_SECRETARY_PERSISTED_STATE`, desligada).
2. **Backup**: o dono confere no painel do Supabase (Database → Backups) que existe o backup diário de hoje. A 027 só
   cria objetos novos; o desfazer real é o `rollback` abaixo.
3. **Verificação prévia**, só leitura: `027_secretary_state.production.preflight.sql` → `PREFLIGHT_OK` e as três
   tabelas `null`.
4. **Aplicar** `027_secretary_state.sql` (o mesmo arquivo validado no banco local e no CI; uma transação, idempotente).
5. **Conferir** `027_secretary_state.verify.sql` (RLS forçado, 4 + 2 + 4 políticas, eventos sem alteração, grants do
   `app_runtime` exatos, nada para `anon`/`PUBLIC`).
6. **Limpeza agendada**: `027_secretary_state.production.enable-cron.sql` (instala o `pg_cron`) e depois
   `027_secretary_state.schedule.sql` (conversas vencidas a cada 30 min; apelidos sem uso há um ano, todo dia).
   Conferir `SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'secretary-%'` → 2 linhas.
7. **Depois**: 67 tabelas e 133 políticas (`public`).
8. Só então `SALON_SECRETARY_PERSISTED_STATE=true` na Vercel (passo 4 do `SECRETARY_PRODUCTION_PILOT.md`) e novo deploy.

Executado pelo coordenador como `postgres` (o papel de manutenção), pelo conector do Supabase; nunca com o papel do app.

## Desfazer

1. `SALON_SECRETARY_PERSISTED_STATE=false` (e `SALON_SECRETARY_NAME_ALIASES`) na Vercel e novo deploy. As conversas
   abertas se perdem com segurança (`SESSION_NOT_FOUND`, nada é executado).
2. `SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'secretary-%';`
3. `027_secretary_state.rollback.sql` (mostra as contagens e remove as três tabelas e a função).
4. Opcional, se nenhum outro job usar: `DROP EXTENSION pg_cron;`

## Fora do piloto

- `026_secretary_feedback` (opiniões 👍/👎): não é necessária, porque `SALON_SECRETARY_FEEDBACK` fica desligada no
  piloto. Quando for ligar, ela precisa da mesma versão de produção do preflight.
