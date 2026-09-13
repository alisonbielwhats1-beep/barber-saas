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
- `023_receipts_booking` consta aplicada pelo PR #103. As migrations distintas
  `023_mercadopago_billing` e `024_billing_hq` ainda não foram aplicadas.

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
`/workspaces/everflair-billing-staging`, atualizado para `8f068f7`.
Banco sintético `everflair_billing_staging`, host `127.0.0.1`, runtime
`app_runtime`. A demonstração antiga `everflair_demo` foi preservada.
As estruturas Billing/HQ já estavam provisionadas pela preparação anterior;
não foram reaplicadas. A atualização recebimentos do PR #103 foi aplicada
somente nesse banco sintético após backup por cópia completa para
`everflair_billing_backup_20260913` e comparação das tabelas afetadas.
Preflight e verify da atualização passaram. O Codespace pode hibernar;
essa hospedagem não será o webhook de produção.

## Configuração em preparação

O inventário Vercel não encontrou credenciais ou flags Mercado Pago.
Segredos existentes são sensíveis e não exportáveis; não foram copiados.
O reconciliador passa a aceitar `BILLING_CRON_SECRET` próprio, mantendo
`CRON_SECRET` como fallback para instalações anteriores. Quando há chave
própria, a chave dos lembretes não autoriza cobrança. Testes cobrem essa separação.

A aplicação principal Mercado Pago é `5276100300886`, Everflair, na conta
do responsável. O acesso às credenciais de produção solicitou validação pelo
titular no Chrome. Aguardando essa validação; nenhum token de teste será usado
em produção. Endpoint produtivo previsto: `/api/webhooks/mercadopago`.

## Estado desta preparação

CI de `8f068f7`, run `34765355842`, concluiu `check` e `schema-smoke`
com sucesso. A inclusão da chave dedicada passou localmente em lint,
TypeScript sem cache, 955 testes (188 arquivos) e build completo.

Banco e configuração financeira produtivos permanecem sem alteração.
Ainda não houve merge, ativação do cron nem liberação de cobranças reais.
O resultado final de CI, staging, configuração e deploy deve ser registrado
antes de declarar a liberação concluída.
