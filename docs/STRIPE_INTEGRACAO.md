# Stripe ao lado do Mercado Pago

Decisão do responsável em 09/10/2026 (`DECISOES_PRODUTO.md`): a Stripe entra
como mais uma forma de pagar (cartão, Apple Pay, Google Pay) na assinatura e nos
pacotes da Secretária. O Mercado Pago continua para Pix, boleto e cartão, e quem
já assina fica nele. O tipo e o documento da conta Stripe ficam registrados fora
do repositório (Brain), por ser público.

Avaliação e planejamento completos (09/10/2026):
- relatório: https://claude.ai/artifact/7p93Ynhk6Z9XSCn91Cw4rf
- plano em fases: https://claude.ai/artifact/G3gXacrfGpVBah51pYqXgM

## Desenho

Quem decide o acesso é o contrato salvo no banco (`BillingSubscription`,
`BillingCharge`, `BillingEvent`, fila), não o gateway. A Stripe é um segundo
adaptador que grava nas mesmas tabelas; o código do Mercado Pago não é
reescrito. Cada contrato e cada compra guardam o gateway que os criou (`provider`,
imutável). As regras atuais valem nos dois caminhos: webhook nunca libera acesso
sozinho (o worker relê a API do gateway), só pagamento aprovado libera período,
cancelar não apaga histórico e suspensão administrativa sempre prevalece.

`MERCADOPAGO_BILLING_ENABLED` continua ligando e desligando a cobrança do app
inteira (acesso, portal, conciliação). `STRIPE_BILLING_ENABLED` só acrescenta a
Stripe como forma de pagamento e não tem efeito com a cobrança desligada.

## Fases

| Fase | Conteúdo | Situação |
| --- | --- | --- |
| 0 | Conta Stripe em modo de teste, marca no Checkout, chave restrita, verificação enviada | área restrita pronta (09/10); verificação para produção pendente |
| 1 | SDK, configuração, migration 032, trava por gateway, `safeCheckout` | PR #168 (rascunho) |
| 2 | Contratar pela Stripe: Checkout em modo assinatura, webhook `/api/webhooks/stripe`, conciliação, falha/carência, cancelamento, escolha do meio de pagamento | branch `claude/stripe-fase2-assinatura` |
| 3 | Troca de plano e reativação da renovação na Stripe: prévia proporcional, upgrade pago na hora, redução e ciclo na renovação | pendente |
| 4 | Pacotes da Secretária pela Stripe (pagamento único) | pendente |
| 5 | Escolha da forma de pagamento nas telas, portal só para trocar cartão, HQ, Termos/Privacidade | pendente |
| 6 | Production: conta verificada, chaves reais, migration, piloto na conta de apresentação, cobrança real de ponta a ponta | pendente |
| 7 | Medir por 60–90 dias e decidir | pendente |

## Fase 1 — o que entrou

- `stripe@22.6.2` (versão exata), API `2026-08-26.dahlia` fixada em
  `src/lib/billing/stripe/client.ts`; no máximo duas tentativas de 6 s (o
  Mercado Pago faz uma), a segunda com a mesma chave de idempotência, e
  telemetria desligada. `stripeRequest` converte as falhas da Stripe em
  `BillingError` sem a mensagem do provedor: chave recusada vira
  `STRIPE_KEY_REJECTED`; queda, erro interno ou limite viram
  `STRIPE_UNAVAILABLE`; o resto vira `STRIPE_REJECTED` (códigos próprios, para
  a tela nunca falar em Mercado Pago num pagamento da Stripe).
- `src/lib/billing/stripe/config.ts`: exige chave secreta ou restrita
  (`sk_`/`rk_`) do mesmo modo de `STRIPE_MODE`, segredo `whsec_`, conta `acct_`;
  live só com `APP_ENV=production`, test nunca no deploy de produção, retorno só
  em HTTPS (regra compartilhada com o Mercado Pago em `billingOrigin`).
- `verifyStripeAccount()`: antes da primeira cobrança, a chave precisa
  pertencer à conta configurada, brasileira e com liquidação em reais.
- `assertProvider` em `catalog.ts`: o worker despacha pelo gateway antes de
  qualquer passo do Mercado Pago; a cotação/confirmação de troca de plano e a
  reativação recusam contrato da Stripe com erro próprio; criação, conciliação,
  troca de plano e
  pacotes do Mercado Pago recusam registros da Stripe (`PROVIDER_MISMATCH`)
  antes de qualquer chamada externa. A conciliação agendada de pacotes só busca
  compras do Mercado Pago. Contratos da Stripe ficam na fila com espera
  crescente até a fase 2.
- `safeCheckout` aceita `https://checkout.stripe.com` e
  `https://billing.stripe.com`, além do checkout do Mercado Pago.
- `STRIPE_SECRET_KEY` faz parte das credenciais proibidas no alvo de staging da
  Secretária.

### Variáveis

| Variável | Uso |
| --- | --- |
| `STRIPE_BILLING_ENABLED` | oferece a Stripe a **novas** contratações (`true` só depois da 032 e da homologação; exige `MERCADOPAGO_BILLING_ENABLED=true`). Com `false`, contratos que já existem continuam conciliados — renovação, atraso e cancelamento pedido pelo dono — enquanto as credenciais existirem |
| `STRIPE_MODE` | `test` fora de produção; `live` somente com `APP_ENV=production` |
| `STRIPE_SECRET_KEY` | chave **restrita** do mesmo modo (`rk_test_`/`rk_live_`) |
| `STRIPE_WEBHOOK_SECRET` | segredo do endpoint de webhook daquele ambiente (`whsec_`) |
| `STRIPE_ACCOUNT_ID` | `acct_…` da conta, conferido por `verifyStripeAccount` |
| `STRIPE_CHECKOUT_PAUSED` | `true` impede novas contratações; renovação, webhook e cancelamento continuam |

Valores nunca vão para o repositório, chat ou logs. Permissões mínimas da chave
restrita (a confirmar na fase 2): leitura de conta; escrita em Customers,
Checkout Sessions, Subscriptions, Subscription Schedules, Invoices e Billing
Portal; leitura de Charges, PaymentIntents, Disputes e Events.

### Migration 032 (`prisma/sql/manual/032_stripe_billing*.sql`)

Aditiva: `provider TEXT NOT NULL DEFAULT 'mercadopago'` com CHECK e trigger de
imutabilidade em `BillingSubscription` e `SecretaryCreditPurchase` (sem
reescrever as tabelas), e `BillingCustomer` (um cliente por salão, gateway,
modo e conta) com FORCE RLS, leitura do próprio salão ou HQ, inserção só com
`app.billing_write`, sem UPDATE/DELETE para `app_runtime` e trigger que recusa
alteração. A chave estrangeira usa as mesmas ações da relação do Prisma
(`ON DELETE RESTRICT ON UPDATE CASCADE`), então `prisma migrate diff` não acusa
divergência. O rollback recusa quando já existe qualquer registro da Stripe e,
de propósito, **mantém** as colunas `provider` (versões a partir da 032 as leem;
as anteriores as ignoram): remove só a tabela `BillingCustomer`, depois de
reverter a aplicação.

**Ordem obrigatória:** aplicar a 032 em Production **antes** do merge desta
branch. O Prisma Client novo seleciona a coluna `provider`; sem ela, consultas
de assinatura e de pacotes falham. O código atual de Production funciona com a
032 aplicada (as colunas novas têm padrão e são ignoradas por ele). A aplicação
segue o `AGENTS.md`: projeto identificado, preflight, backup, autorização
explícita, aplicação única e verify.

Evidência local (09/10/2026, PostgreSQL 16 descartável na porta 55470): sobre
020/023/024/025/029/030, preflight, aplicação duas vezes, verify, rollback e
reaplicação passaram; as impressões digitais de assinaturas e compras ficaram
iguais antes e depois (sem a coluna nova). Como `app_runtime` sem BYPASSRLS:
inserção sem `app.billing_write` e para outro salão recusadas; leitura só do
próprio salão; UPDATE sem permissão; trigger recusou alteração de cliente e de
gateway; CHECK recusou gateway desconhecido; índice único recusou segundo
cliente igual; rollback recusou com histórico da Stripe. Depois da revisão, num
banco novo: verify conferindo a chave estrangeira, rollback mantendo as colunas
`provider`, reaplicação e `prisma migrate diff` sem divergência nos objetos da
032. Os 78 testes de integração do Mercado Pago (`billing-postgres`) passaram
com a 032 aplicada. O CI (`schema-smoke`) repete 029, 030 e 032 com impressão
digital, rollback e reaplicação.

## Fase 2 — o que entrou

- **Contratar:** `POST /api/billing/subscriptions` aceita `provider: "stripe"`
  (sem o campo, continua Mercado Pago, com a mesma impressão digital de antes).
  O contrato guarda `provider`, `mode` e a conta Stripe em `collectorId`. Depois
  de gravado, `ensureStripeCheckout` cria o cliente Stripe do salão
  (`BillingCustomer`, uma vez) e um Checkout em modo assinatura, com chave de
  idempotência por contrato: cartão em reais (Apple Pay vem pelo cartão), uma
  linha com o total do contrato, mensal ou anual, `pt-BR`. O link só é gravado
  depois de conferir modo, cliente, referência, moeda e valor.
- **Conciliar:** a fila despacha contratos da Stripe para
  `syncStripeSubscription`, que relê a assinatura e as faturas na Stripe. Só
  fatura paga, do valor do contrato, libera período (`BillingCharge` aprovada,
  `paidThrough`, `Salon.plan = PRO`). Renovação recusada inicia a carência de
  5 dias; pagamento posterior regulariza. Termos diferentes do contrato,
  assinatura duplicada ou renovação religada fora do app colocam o contrato em
  revisão.
- **Avisos:** `POST /api/webhooks/stripe` confere a assinatura sobre os bytes
  exatos, ignora o outro modo e objetos que não são do EverFlair, e só põe o
  contrato na fila. Reembolso e contestação são relidos da Stripe (cobrança →
  pagamento da fatura → contrato daquela fatura, não o contrato atual do salão)
  e marcam a cobrança como `refunded`/`charged_back` e o contrato em revisão,
  sem tirar o acesso pago.
- **Cancelar:** com período pago em curso, o pedido do dono vira
  `cancel_at_period_end` (acesso até o fim do período pago). Sem período pago —
  primeiro pagamento pendente ou renovação em atraso (`past_due`/`unpaid`) — a
  assinatura é cancelada na hora, o que faz a Stripe parar de cobrar as faturas
  em aberto (nenhuma nova tentativa cobra quem cancelou). Sem assinatura, a
  tentativa é encerrada e o link expira; um Checkout que expirou sozinho, ou uma
  tentativa cujo link nunca foi gravado, também é encontrado e encerrado (ou,
  se foi pago, ativado).
- **Telas:** com a Stripe ligada, a confirmação do plano oferece "Pagar com
  cartão" (Stripe) e "Pagar pelo Mercado Pago". Os textos de um contrato da
  Stripe falam "na Stripe". Troca de plano e reativação ficam ocultas para
  contratos da Stripe até a fase 3 (o servidor também recusa).
- **HQ:** contratos e cobranças aparecem como Stripe ou Mercado Pago.
- **Testes:** `billing-stripe-postgres.integration.test.ts` (PostgreSQL com
  FORCE RLS e papel sem BYPASSRLS, Stripe simulada em memória e assinatura de
  webhook real do SDK) e testes da tela de escolha. O CI roda o teste depois de
  aplicar a 032 e prova que o rollback recusa quando há histórico da Stripe.

Fora da fase 2: troca de plano/reativação (fase 3), pacotes da Secretária
(fase 4), portal para trocar o cartão e textos finais (fase 5).

## Riscos acompanhados

- Documento da conta: o documento e o nome não mudam após a verificação; trocar
  de documento exige outra conta Stripe e migração das assinaturas.
- Pix pela Stripe depende de convite e não funciona em assinatura; fica com o
  Mercado Pago.
- Taxa da Stripe no cartão: 3,99% + R$ 0,39 (+0,7% do Billing em recorrência).
  No pacote de R$ 15 a margem cai cerca de 2,5 pontos.
