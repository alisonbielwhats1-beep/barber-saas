# Mercado Pago — backend de assinaturas recorrentes

Implementação autorizada em 12/09/2026, branch `codex/mercadopago-subscriptions`.
Base `5cca634` (PR #99). Migration 023 aditiva, **não aplicada em Production**.
A interface de escolha/checkout ainda precisa ser conectada às APIs desta entrega.

## Cinco fases e comportamento entregue

1. Catálogo versionado e contrato imutável: valor em centavos, BRL, capacidade,
   periodicidade, vendedor, ambiente e referência própria persistidos no servidor.
2. Contratação pelo OWNER: estabelecimento aprovado, capacidade compatível,
   chave de idempotência UUID; clique repetido reutiliza a intenção. Uma assinatura
   vigente por estabelecimento. POST remoto incerto é recuperado por referência,
   nunca repetido automaticamente. Zero ou múltiplos resultados exigem revisão.
3. Confirmação: HMAC do webhook, consulta autenticada ao provedor, validação de
   vendedor/pagador/vínculo/valor/moeda/ambiente. Autorização e URL de retorno não
   liberam plano. Somente pagamento aprovado com data e fatura vinculada concede
   período. Eventos repetidos/concorrentes não acrescentam meses indevidamente.
4. Renovação/falhas: Mercado Pago agenda a cobrança recorrente. A aplicação
   reconcilia faturas e concede seu período de calendário. Falha financeira
   confirmada inicia carência de cinco dias após o vencimento; depois impede
   novas reservas e expansão de agendas. Atendimento já marcado, leitura,
   cancelamento e regularização permanecem. Lista de espera não contorna a trava.
   Ausência de confirmação técnica fica em VERIFYING e não vira inadimplência.
5. Cancelamento/histórico/operação: intenção durável e repetição do PUT até GET
   confirmar o cancelamento. Acesso até o fim pago. Estorno/chargeback sinalizam
   revisão manual e preservam histórico. HQ consulta o mesmo contrato, sem criar
   um segundo livro financeiro. Suspensão administrativa nunca é revertida por
   pagamento. Fila com lease, tentativas e reconciliação cobre webhooks perdidos.

## Regras comerciais aprovadas

| Plano | Agendas | Mensal | Anual total, recorrência a cada 12 meses |
| --- | ---: | ---: | ---: |
| Individual | 1 | R$ 59,90 | R$ 598,80 |
| Equipe | 3 | R$ 79,90 | R$ 778,80 |
| Equipe Plus | 5 | R$ 99,90 | R$ 958,80 |
| Equipe Max | 10 | R$ 149,90 | R$ 1.438,80 |

Adicional acima de dez agendas, somente Equipe Max: R$ 15,00/mês ou
R$ 144,00/ano por agenda. Até cem adicionais por contrato. Todos os planos
pagos habilitam os mesmos recursos. Catálogo `2026-09-12` em
`src/lib/billing/catalog.ts`. O total anual é cobrado de uma vez por ano.
Não há migração automática de contas antigas, alteração de plano no meio do
ciclo, prorrata, reembolso automático, SMS ou WhatsApp nesta entrega.

Fluxo previsto: escolher plano → autenticar/cadastrar conta → criar estabelecimento
→ aprovação administrativa existente → contratar/pagar → confirmar pagamento e
liberar capacidade. O backend já existente continua permitindo seu acesso legado
antes do primeiro pagamento; nenhuma assinatura paga é liberada antecipadamente.
Contas sem contrato mantêm regras antigas. O campo legado Salon.plan passa a PRO
somente após aprovação financeira, para compatibilidade dos recursos existentes;
a capacidade efetiva vem do contrato, não desse enum legado.

## APIs

- `POST /api/billing/subscriptions?salonId=...`: sessão OWNER, Origin igual ao
  NEXTAUTH_URL, header `Idempotency-Key` UUID, JSON `{plan,cycle,extraAgendas?}`.
  Valor, e-mail do pagador e vendedor não são aceitos do cliente. Retorna 202,
  identificador, estado e URL oficial de checkout, quando disponível.
- `GET /api/billing/subscriptions?salonId=...`: OWNER, contrato atual e últimas
  24 faturas, sem credenciais. Não retorna checkout após pedido de cancelamento.
- `POST /api/billing/cancel?salonId=...`: OWNER/Origin, JSON `{subscriptionId}`;
  202 enquanto depende de confirmação remota. Não elimina registros.
- `GET /api/billing/return`: mensagem informativa, sem mutação/liberação.
- `POST /api/webhooks/mercadopago`: tópicos `subscription_preapproval`,
  `subscription_authorized_payment`, `payment`; assinatura obrigatória.
  Responde sucesso somente após persistir a notificação relevante.
- `GET /api/cron/billing`: Bearer CRON_SECRET; processa uma unidade limitada
  por chamada, com lease de cinco minutos e timeout remoto de seis segundos.
- `GET /api/hq/billing?cursor=UUID`: withHq, paginação de cinquenta contratos;
  status, fila, tentativas e revisão financeira, sem endpoints de edição no HQ.

Bodies limitados a 4 KiB. APIs privadas não usam cache. Escritas/leitura de
proprietários usam limitador existente (15/120 por minuto, falha fechada).
Dados de cartões permanecem no checkout Mercado Pago. Tokens não vão ao browser.

## Ambientes e ativação controlada

`MERCADOPAGO_BILLING_ENABLED` ausente/false: APIs desabilitadas e limites legados
não consultam tabelas novas. `PLATFORM_BILLING_ENABLED` continua false; 023 não
aplica nem depende da migration manual 011 de faturamento manual.

Configuração no ambiente de destino, sem versionar valores:

| Variável | Uso |
| --- | --- |
| MERCADOPAGO_BILLING_ENABLED | true somente após validar schema/integração |
| MERCADOPAGO_MODE | test fora de produção; live somente APP_ENV=production |
| MERCADOPAGO_ACCESS_TOKEN | token do vendedor correspondente ao ambiente |
| MERCADOPAGO_COLLECTOR_ID | identificador numérico conferido em /users/me |
| MERCADOPAGO_WEBHOOK_SECRET | segredo da aplicação que assina notificações |
| NEXTAUTH_URL | origem canônica HTTPS, localhost permitido em teste |
| CRON_SECRET | proteção do reconciliador |
| MERCADOPAGO_CHECKOUT_PAUSED | true impede novas contratações; mantém processamento |

Antes do primeiro POST, /users/me deve confirmar país MLB, vendedor esperado e
tag test_user coerente com o ambiente. Prefixo do token sozinho não prova isso.
Não usar e-mail da conta principal como comprador fictício. O comprador existente
foi confirmado no perfil, e os testes abaixo usaram somente contas/cartão fictícios.
Nenhuma cobrança real foi realizada. Pagamentos de test_user com suas credenciais
APP_USR podem retornar live_mode=true: nesse caso a API /users/me deve confirmar
novamente o vendedor fictício. Em modo live, pagamento live_mode=false é rejeitado.

O workflow `billing-reconcile.yml` usa o GitHub Actions existente, desligado por
padrão. Configurar, após homologação/autorização, variável de repositório
`BILLING_RECONCILIATION_ENABLED=true`, secrets `BILLING_RECONCILIATION_URL`
(HTTPS terminando em /api/cron/billing) e `BILLING_CRON_SECRET` igual ao CRON_SECRET
do destino. A cada cinco minutos drena até cinquenta unidades em janela de 200s;
uma chamada ainda pode durar 55s. Sem sobreposição. Agendamento do GitHub pode
atrasar; webhooks também disparam processamento. Antes de ampliar volume, medir
idade da fila pelo HQ e dimensionar a execução; não há SLA de cinco minutos.
Não cadastrar cobrança cron alternativa nem ativar o workflow em outro ambiente
usando o mesmo segredo/URL por engano.

## Migration, recuperação e liberação

1. Identificar projeto/host/database/role e comparar predecessores 020 e schema.
   Fazer backup adequado e comprovar restauração fora de Production. Obter
   autorização explícita para aplicação produtiva, como exige AGENTS.md.
2. Rodar 023.preflight, revisar SQL, aplicar 023 uma vez e rodar 023.verify.
   Não reaplicar migrations 008–022. O CI testa idempotência somente em banco
   descartável, compara tabelas antigas por fingerprint e restaura backup.
3. Conferir runtime app_runtime sem BYPASSRLS, ENABLE/FORCE RLS das cinco tabelas,
   FKs compostas, unicidade de contrato atual/pagamento e histórico append-only.
4. Homologar com vendedor/comprador fictícios: contratação mensal/anual,
   pagamento aprovado/rejeitado, webhook autêntico, recuperação e cancelamento.
   Os testes com provedor simulado não substituem essa homologação.
5. Conferir PR, CI/schema-smoke/Preview, configuração e plano operacional. Só
   promover após aprovação. Depois verificar home, APIs e runtime sem dados
   sensíveis em logs. Conectar frontend em entrega própria antes de oferecer
   contratação aos clientes.

Rollback operacional: pausar checkout; manter webhook/reconciliador e canais de
cancelamento enquanto existirem assinaturas no provedor. Desabilitar a flag ou
reverter o código NÃO cancela cobranças remotas. 023.rollback é inventário somente
leitura. Não excluir tabelas/histórico nem restaurar backup antigo sobre cobranças
novas. Rever/cancelar assinaturas no provedor de forma controlada antes de uma
desativação total. Contratos com criação incerta ou alteração externa de termos
exigem conciliação individual; jamais refazer POST sem confirmar inexistência.

## Evidências e fontes

Suíte dedicada local: 30 testes passaram, incluindo catorze integrações PostgreSQL
com role sem BYPASSRLS. Cobertura: duplicidade, isolamento, autorização, erros do
provedor, assinatura HMAC, limites HTTP, carência/regularização, recorrência mensal
e anual, capacidade, cancelamento, suspensão e preservação de eventos.
Checks locais completos: `npm run lint`, `npx tsc --noEmit --incremental false`,
`npm test` (923 testes em 183 arquivos) e `npm run build` passaram. Backup do
PostgreSQL descartável restaurado em segundo banco; fingerprints de todas as
tabelas conferidos. Preflight, reaplicação idempotente da 023, verify RLS e
inventário de rollback passaram sem alterar dados. CI/Preview ficam no PR.

Homologação parcial com a API e checkout do Mercado Pago (12/09, horário de
Brasília): contrato mensal Equipe Plus R$ 99,90 criado pelo serviço real usando
o PostgreSQL local com role sem BYPASSRLS. Checkout confirmou transação fictícia
`178756343420`; a API confirmou vendedor `3683184919`, comprador `3683184927`,
BRL/99,90 e aprovação. Reconciliação persistiu uma única fatura e paidThrough
`2026-10-13T00:51:57.000Z`. Cancelamento confirmado no provedor às
`2026-09-13T00:54:41.965Z`, preservando o período e o histórico.
Assinatura anual Equipe Plus criada com R$ 958,80/frequência 12 meses e cancelada
ainda pendente, sem cobrança. Ambas encerradas no provedor após os testes.

O teste real encontrou e corrigiu: parâmetros limit=20/50 rejeitados na busca
de faturas (agora usa paginação padrão com offset) e live_mode=true em pagamentos
entre test_users (agora exige comprovação adicional do vendedor). Regressões
cobertas por testes. Falha no GET de verificação do vendedor não reserva um POST
que nunca aconteceu; falha depois do POST permanece sujeita à reconciliação.

Limite da evidência: o pagamento mensal foi recuperado pela reconciliação; ainda
falta entrega externa de webhook com assinatura autêntica em staging configurado.
Renovação futura, recusa financeira, anual pago e chargeback foram exercitados
com provedor simulado e banco real. O Preview compila com cobrança desligada e
permanece sob as barreiras de ambiente existentes; não substitui esse staging.

Referências oficiais consultadas em 12/09/2026:

- [Criação de assinatura](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post)
- [Atualização de assinatura](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/update-preapproval/put)
- [Consulta de fatura](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-authorized-payment/get)
- [Busca de faturas](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/authorized-payment-search/get)
- [Webhooks](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks)
- [Usuários de teste](https://www.mercadopago.com.br/developers/pt/reference/test_user/_users_test/post)
