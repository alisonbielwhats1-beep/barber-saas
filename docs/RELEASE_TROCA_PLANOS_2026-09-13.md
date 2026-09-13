# Liberação de trocas de plano e cancelamento — 13/09/2026

O responsável autorizou expressamente a publicação em produção após a
homologação do PR #105. Nenhuma compra de teste foi feita em Production.

## Versão e destino

- PR: https://github.com/alisonbielwhats1-beep/barber-saas/pull/105.
- Head validado: `e62acb56311e2b2ed10c93f5b0a37991870382c7`.
- Merge em master: `ae4f1ff0022f8b506133e72d221cfaec1276873d`, às `21:00:26Z`.
- Vercel Production: `dpl_A1twXWZs5PbumZGnRB5KzsTHBven`, READY,
  associado a https://everflair.com.br e https://salon-saas-ruby.vercel.app.
- Configuração conferida: `MERCADOPAGO_PLAN_CHANGES_ENABLED=true`,
  `MERCADOPAGO_PLAN_CHANGES_PAUSED=false`, definidas antes do deploy.
  Credenciais e configurações existentes de billing foram preservadas.

## Banco e recuperação

Projeto Supabase `barber-saas`, ref `vshnatkzxdekkvqttvbv`, main PRODUCTION.
Preflight READ ONLY às `20:56:41Z`: zero assinaturas/cobranças, tabela e função
025 ausentes, predecessores presentes com FORCE RLS, app_runtime sem superuser
ou BYPASSRLS. Backup delimitado anterior revalidado por decifragem em memória:
63 colunas, 13 constraints, 18 índices, 14 policies e 84 grants; não é dump
completo nem cópia de dados do HQ. Arquivo criptografado fora do Git em
`.codex/backups/everflair/production-2026-09-13-pr105/schema-metadata.pgp`, SHA256
`fc1ec769c1ce02749c729b3a5ed96c7fbc39c0d7076b6a90ffb39b486dfe6261`.

Aplicado exatamente `prisma/sql/manual/025_billing_plan_changes.sql`, SHA256
`64775c4577fbb22701a6aa7b32249aa7ee4980821efccc2c3fd1d28dbff97248`.
Aplicação manual transacional pelo SQL Editor; sem registro separado de versão
no histórico Prisma/Supabase. Não foram reaplicadas 011, 023 ou 024.
Verificação READ ONLY às `20:59:39Z`: tabela com FORCE RLS, três FKs compostas,
três policies, trigger imutável habilitado, índice único de pendência correto;
runtime com SELECT/INSERT/UPDATE, anon/authenticated sem acesso. Contagens
BillingSubscription/BillingCharge/BillingPlanChange continuam zero.

Em recuperação, usar `MERCADOPAGO_PLAN_CHANGES_PAUSED=true` para impedir novos
pedidos e publicar essa configuração, mantendo leitura, webhook, cancelamento
e reconciliador. Preservar tabela, termos e histórico; não desligar ENABLED
após a primeira troca. O rollback SQL é inventário somente leitura.

## Verificações

Antes da promoção: lint, TypeScript, 1.055 testes unitários/componentes,
80 integrações PostgreSQL e seis testes do provider, build e CI `34779262829`
passaram. Schema-smoke validou aplicação/reaplicação, isolamento, backup e
restauração em PostgreSQL sintético. Preview READY e capturas de cotação,
cancelamento e OWNER suspenso revisadas em larguras de 320/390/1280 px.

Financeiro externo com contas fictícias: Individual mensal aprovado, upgrade
para Equipe 5 pago e aplicado sem mudar vencimento, autorização anual futura
sem cobrança antecipada, ambas as recorrências canceladas com GET confirmatório.
Histórico e paidThrough preservados. Matriz completa de regras e fronteiras de
datas validada com relógio controlado no banco sintético. Não foi aguardada uma
renovação externa futura, nem realizada compra real de todas as combinações.

Depois da promoção, às `21:06Z`: home 200 com Everflair IA “Em breve”;
`/assinatura` redireciona 307 ao login preservando callback; subscriptions GET,
changes POST e cancel POST sem sessão retornam 401. GET changes retorna 405,
pois a rota aceita somente POST. Worker sem autenticação retorna 401; execução
autenticada 200 com zero processados e zero falhas. Consulta dos logs do novo
deployment não retornou erros. Nenhuma conta, contrato ou cobrança produtiva
foi criada para verificação.
