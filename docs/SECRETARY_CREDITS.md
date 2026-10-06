# Secretária — crédito pré-pago (pacotes pelo Mercado Pago)

Decisões do dono em 06/10/2026:

- A Secretária é pré-paga e vale para todos os planos.
- O cliente compra **crédito**, não uma quantidade fixa de pedidos. Cada pedido (mensagem enviada à Secretária) desconta o
  próprio custo real vezes 10, e assim a margem de 90% vale em todo pedido. Entram no custo:
  - as chamadas ao DeepSeek;
  - cada gravação transcrita pelo GPT Transcribe, mesmo que não vire mensagem.
- "Cerca de N pedidos" é só uma estimativa pelo custo médio. Não é promessa.
- O cliente vê **só a barra e a porcentagem**: nem valores, nem número de pedidos, nem dias.
- Pacotes (pacote maior rende mais):

  | Pacote | Crédito (unidades de R$ 0,0001) | Estimativa | Margem média antes da taxa |
  |---|---|---|---|
  | R$ 15 | 150.000 | cerca de 185 pedidos | 90% |
  | R$ 25 | 275.000 | cerca de 340 pedidos | 89% |
  | R$ 40 | 485.000 | cerca de 600 pedidos | 88% |
  | R$ 80 | 1.053.000 | cerca de 1.300 pedidos | 87% |

- **Franquia grátis todo mês:** 16.200 unidades, cerca de 20 pedidos, para todo salão.
  - Custa uns R$ 0,16 reais por salão por mês.
  - É usada antes do crédito pago e não acumula: o que sobrar não passa para o mês seguinte.
- A recarga **soma** ao que sobrou e a barra volta a 100%. O crédito não expira.
- Só o dono recarrega. Todos os papéis veem a barra. Aviso abaixo de 20%; sem nada, a Secretária para e a agenda segue normal.

## Regras (validadas em teste)

Fonte: `src/lib/secretary-credits-rules.ts`. Testes em `src/lib/__tests__/secretary-credits-rules.test.ts` e
`src/lib/billing/secretary-credits.test.ts`.

- **Cobrança:** custo em micro-dólares × câmbio fixo (`SALON_SECRETARY_USD_BRL`, padrão 5,60) × 10, em unidades inteiras de
  R$ 0,0001, arredondando para cima.
  - Pedido digitado típico: US$ 0,0007, que vira R$ 0,039.
  - Pedido falado: US$ 0,0022, que vira R$ 0,123.
  - O custo usa o preço mais alto dos fornecedores, então a margem nunca fica abaixo de 90%.
- **Uma cobrança por chamada e por gravação:**
  - cada chamada do modelo é cobrada uma vez, pelo próprio registro (`call:<id>`);
  - cada gravação é cobrada uma vez, pelo registro da sua reserva (`voice:<id>`);
  - mensagem recusada ou com falha não é cobrada; a gravação é.
- **Barra:**
  - Quem já comprou vê o crédito pago: o saldo dividido pelo saldo logo depois da última recarga. A franquia que sobrou entra
    dos dois lados da conta, então gastar a franquia não baixa a barra, e logo depois de uma compra ela marca sempre 100%.
  - Quem nunca comprou vê a franquia do mês.
  - Exemplo do dono: com 20% sobrando, comprar R$ 15 soma os dois e a barra volta a 100%.
- **Pedido já iniciado sempre termina:** o crédito pago pode ficar negativo e a próxima recarga cobre a diferença.
- **Reembolsos e pagamentos problemáticos:**
  - reembolso devolve o crédito na proporção do valor estornado, arredondando para cima (R$ 5 de R$ 15 = 1/3);
  - chargeback devolve tudo;
  - o mesmo pagamento nunca credita duas vezes;
  - um segundo pagamento da mesma compra, ou um pagamento divergente, vai para revisão;
  - aprovação depois de a compra expirar ainda credita;
  - compra não paga expira em 24 h, com 1 h de tolerância.

## Banco

- `029_secretary_credits`: livro só de inclusão e compras com cotação imutável, com RLS e FORCE.
- `030_secretary_credit_units`: renomeia `requests` para `units`, cria `freeUnits` (a parte da franquia em cada uso) e o
  pacote P80. A linha gravada antes da 030 continua como está, agora lida como unidades.
- As duas foram validadas num Postgres 16 descartável: `VERIFY_OK` e todas as recusas de segurança funcionaram.

## Como funciona

- **Compra:** `POST /api/billing/credits`, só o dono e só para quem pode usar a Secretária.
  - Checkout Pro com o item "Everflair — Crédito da Secretária", valor exato, Pix ou cartão em 1x, sem boleto, link de 24 h.
  - Referência `efc:{salão}:{compra}`.
  - A volta do pagamento cai em `/api/billing/return?origem=creditos`.
- **Confirmação:** pelo webhook (tópico `payment`, ramo `efc:`), pela volta do checkout (`GET /api/billing/credits?sync=1`) e
  pela rotina de cobrança (`/api/cron/billing`). Nos três, o pagamento é relido no Mercado Pago e conferido: referência,
  conta, moeda, valor e modo.
- **Secretária:**
  - `budgeted()` exige crédito ou franquia.
  - Ao terminar uma mensagem, `charged()` cobra as chamadas dela.
  - A transcrição cobra a gravação.
  - A tela recebe só `{ percent, status }`.
- **Cortesia:** `POST /api/hq/secretary-credits`, só HQ, com corpo `{ salonId, units, reason, grantKey }`.

**Comportamento da flag.** Com `SALON_SECRETARY_CREDITS_ENABLED` ligada, os tetos de gasto diário e mensal
(`secretary-spend.ts`) valem para todos os salões. Desligada, a flag bloqueia só compras novas e o uso; pagamentos de compras
abertas continuam sendo confirmados. O rollback da 029 e da 030 se recusa a apagar histórico.

## Ordem em Produção

1. 029 aplicada (06/10, `VERIFY_OK`).
2. 030: preflight, aplicar, verify. **Antes do merge**, porque o código novo já lê `units` e `freeUnits`.
3. Cortesia do piloto em crédito, por exemplo 485.000 unidades (um pacote de R$ 40).
4. Merge e deploy. As variáveis `SALON_SECRETARY_CREDITS_ENABLED=true` e `SALON_SECRETARY_MONTHLY_BUDGET_USD=5` já estão
   cadastradas na Vercel.
5. Conferir que o webhook do Mercado Pago recebe o tópico **Pagamentos**.
