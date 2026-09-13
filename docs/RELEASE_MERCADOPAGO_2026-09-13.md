# Liberação Mercado Pago — 13/09/2026

O responsável autorizou concluir as etapas e disponibilizar em produção.
A autorização não dispensa preflight, recuperação, CI e conferência do destino.

## Destinos e preflight

- Aplicação produtiva: projeto Vercel `prj_qBERQKNhW0BjEsMaJHuft66TMYiy`,
  domínio `https://everflair.com.br`, branch `master`.
- Banco produtivo: `barber-saas` / `vshnatkzxdekkvqttvbv`, região `sa-east-1`,
  PostgreSQL 17.6, database `postgres`, porta 5432. Supabase reportou ACTIVE_HEALTHY.
- Consulta administrativa somente leitura: predecessores Salon/HQ presentes,
  ENABLE/FORCE RLS nas tabelas existentes, runtime `app_runtime` sem superusuário
  nem BYPASSRLS. Nenhuma das cinco tabelas Billing existia no preflight.
- `023_receipts_booking` consta aplicada pelo PR #103 e não foi reaplicada.
  As migrations distintas `023_mercadopago_billing` e `024_billing_hq` foram
  aplicadas nesta liberação, conforme registro abaixo.

## Recuperação preparada

Backup delimitado do HQ criptografado no servidor antes do transporte, fora do
Git, em `.codex/backups/everflair/production-2026-09-13-pr101/affected-tables.pgp`.
Inclui dados e metadados de colunas, constraints, índices, policies e grants.
Decifragem integral em memória confirmou 104.730 bytes e SHA256
`bfca29125337171100b8ea1a38ea9e3e0cce3dd96c8f80957161673379e9d9aa`.
Contagens: 1 conta, 1 cliente, 1 atividade, 0 assinaturas e 0 pagamentos do HQ.
Não é dump completo nem restauração de dados produtivos em teste.

O rollback mantém estruturas e histórico. Após existir contrato remoto, pausar
novas contratações e manter webhook, reconciliação e cancelamento ativos;
desligar o código não cancela recorrências no provedor.

## Homologação persistente

Codespace `glorious-enigma-jjv6v4rvrv49f544r`, checkout independente
`/workspaces/everflair-billing-staging`, atualizado para `6122e6e`.
Banco sintético `everflair_billing_staging`, host `127.0.0.1`, runtime
`app_runtime`. A demonstração antiga `everflair_demo` foi preservada.
As estruturas Billing/HQ já estavam provisionadas pela preparação anterior;
não foram reaplicadas. A atualização recebimentos do PR #103 foi aplicada
somente nesse banco sintético após backup por cópia completa para
`everflair_billing_backup_20260913` e comparação das tabelas afetadas.
Preflight e verify da atualização passaram. O Codespace pode hibernar;
essa hospedagem não será o webhook de produção.

Build completo e verificações de schema passaram. As 27 integrações Billing/HQ
passaram em `everflair_billing_validation_20260913`, cópia somente do banco
sintético, preservando o runtime do staging. Evidência remota em
`.demo/verification-final.json` e `.demo/integration-final.log`.

## Aplicação produtiva das migrations

- `mercadopago_billing_023`, versão Supabase `20260913155322`.
- `billing_hq_024`, versão Supabase `20260913155342`.

Cada aplicação incluiu preflight/verify dentro da transação, lock timeout de
5s, statement timeout de 60s e guarda contra reaplicação. A primeira submissão
da 023 foi rejeitada por erro de delimitação SQL antes de criar tabelas;
consulta confirmou zero tabelas Billing antes da submissão corrigida.

Verificação posterior: 13 estabelecimentos, zero contratos/cobranças novas,
cinco FKs de tenant, dez tabelas com ENABLE/FORCE RLS, histórico append-only e
runtime sem superusuário/BYPASSRLS. Fingerprints dos campos preexistentes de
contas, clientes e atividades do HQ coincidem com os anteriores. Assinaturas
e pagamentos do HQ permanecem vazios. Não houve seed nem reprocessamento.

Advisor não reportou RLS ausente. Reportou quatro avisos sobre objetos anteriores:
três funções `app_current_*` com
[search_path mutável](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
e a extensão `btree_gist`
[no schema public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).
Esses objetos não foram alterados por 023/024.

## Configuração produtiva concluída

O inventário inicial Vercel não encontrou credenciais ou flags Mercado Pago.
Segredos existentes são sensíveis e não exportáveis; não foram copiados.
O reconciliador passa a aceitar `BILLING_CRON_SECRET` próprio, mantendo
`CRON_SECRET` como fallback para instalações anteriores. Quando há chave
própria, a chave dos lembretes não autoriza cobrança. Testes cobrem essa separação.

`BILLING_CRON_SECRET` foi salvo como Secret somente em Vercel Production e no
GitHub, com cópia criptografada de recuperação no diretório do backup.
`BILLING_RECONCILIATION_URL` aponta para `https://everflair.com.br/api/cron/billing`.
A variável GitHub `BILLING_RECONCILIATION_ENABLED` ficou inicialmente `false`
e foi ativada após a conferência do primeiro deploy. Execução
`34768836941` passou com zero unidades processadas e zero falhas.

A aplicação principal Mercado Pago é `5276100300886`, Everflair, na conta
do responsável. O titular concluiu a validação, o aceite dos termos e a
ativação inicial. `/users/me` confirmou `478386806`, site MLB e ausência de
`test_user` às 16:06:52 UTC. Token e assinatura secreta foram salvos como
Secret exclusivamente em Vercel Production, com cópias criptografadas cuja
decifragem foi conferida em memória. Arquivos intermediários em texto claro
foram removidos. Nenhum token de teste foi configurado em produção.

Webhook salvo no modo de produção:
`https://everflair.com.br/api/webhooks/mercadopago`, eventos Planos e
assinaturas e Pagamentos (legacy). Modo de teste sem endpoint. A configuração
usa `MERCADOPAGO_MODE=live`, billing/HQ enabled e `NEXTAUTH_URL=https://everflair.com.br`.
O faturamento manual 011 continua desativado.

## Publicação e verificação final

CI de `8f068f7`, run `34765355842`, concluiu `check` e `schema-smoke`
com sucesso. A inclusão da chave dedicada passou localmente em lint,
TypeScript sem cache, 955 testes (188 arquivos) e build completo.

CI final `34767093377`, head `4603377`: check e schema-smoke SUCCESS,
incluindo upgrade/restauração, jornadas autenticadas, acessibilidade,
responsividade e rollback. PR #101 saiu de draft e foi integrado por squash
em `f89652b278ba5a5c46d5c7ae8e295bc1c2c45476`, às 16:21:58 UTC.
Árvore do merge idêntica ao head aprovado.

Primeiro deploy `dpl_2cXMFUYT3rxDG2LxNigopkyNM67T` READY com checkout pausado.
Home 200, cron sem chave 401 e autorizado 200, zero falhas. Em seguida,
`MERCADOPAGO_CHECKOUT_PAUSED=false` foi salvo e a mesma versão recompilada.
Deploy final `dpl_361VijpX2UCrkfaP63FYsNEMgzny` READY, associado ao domínio
oficial e aliases antigos. CLI confirmou a configuração live e origem canônica.

Verificação do deploy final em 16:34:13 UTC: home 200, IA em breve,
cron sem chave 401, cron autorizado 200, processed=0 e failed=0. A consulta
de logs de erro do deployment não retornou entradas. Nova execução GitHub
`34768983145`, já após o deploy final, também passou. Navegador confirmou
anuais R$ 599/779/959/1.439, IA bloqueada e Individual anual preservado no
cadastro. Nenhum cadastro de teste, compra real ou cobrança fictícia foi
criado em produção. A jornada financeira foi homologada fora de produção;
esta conferência final não equivale a uma compra real ou push no iPhone.

O checkout e o reconciliador estão disponíveis. Para rollback financeiro,
pausar novas contratações e preservar worker/webhook/cancelamento enquanto
existirem contratos remotos; nunca apagar histórico ou simplesmente
reverter a aplicação sobre recorrências ativas.
