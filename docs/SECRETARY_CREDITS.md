# Secretária — pedidos pré-pagos (pacotes pelo Mercado Pago)

Decisões do dono em 06/10/2026:

- A Secretária é pré-paga e vale para todos os planos.
- O cliente compra **pedidos**: cada mensagem enviada à Secretária, digitada ou falada. Nunca compra dinheiro.
- Pacotes: R$ 15 = 185 pedidos, R$ 25 = 310 pedidos, R$ 40 = 500 pedidos. O preço sai da média de custo por pedido
  (cerca de R$ 0,08, para ficar perto de 90% de margem) e cada pacote arredonda a favor do cliente.
- A recarga **soma** ao que sobrou. Exemplo: com 20% (37 de 185), comprar R$ 15 deixa 222 pedidos, e a barra volta a 100%.
- Os pedidos não expiram.
- Todos os papéis veem o número de pedidos. Só o dono recarrega, em Plano e assinatura.
- Aviso amarelo abaixo de 20%. Em zero, a Secretária para e a agenda segue normal.

## Regras (validadas em teste)

Fonte: `src/lib/secretary-credits-rules.ts`; testes em `src/lib/__tests__/secretary-credits-rules.test.ts` e
`src/lib/billing/secretary-credits.test.ts`.

- **Barra:** o saldo dividido pelo saldo logo depois do último crédito (compra ou cortesia). Arredonda para baixo, mas um
  saldo positivo nunca aparece como 0%.
- **Aviso:** abaixo de 20%, em conta inteira. 37 de 185 = 20% não avisa; 36 de 185 = 19% avisa.
- **Uso:** só a mensagem que terminou consome 1 pedido. Recusa e falha não são cobradas. O débito acontece uma única vez
  por mensagem (chave da mensagem).
- **Mensagem já iniciada sempre termina:** com duas mensagens juntas no último pedido, o saldo pode ficar em −1. A próxima
  compra cobre essa diferença (−1 + 185 = 184).
- **Reembolso:** devolve os pedidos na proporção do valor estornado, arredondando para cima. R$ 5 de R$ 15 devolvem 62 de
  185. O saldo pode ficar negativo, porque os pedidos já usados foram pagos com o dinheiro estornado.
- **Chargeback:** devolve o pacote inteiro.
- **Pagamento repetido:** o mesmo pagamento nunca credita duas vezes, seja no webhook, na volta do checkout ou na rotina
  agendada.
- **Segundo pagamento da mesma compra:** não é creditado e a compra vai para revisão (o estorno é manual).
- **Aprovação depois da compra expirar:** ainda credita. O dinheiro nunca fica sem os pedidos.
- **Compra não paga:** expira 24 h depois, mais 1 h de tolerância.
- **Sem estimativa de dias para o cliente** (dono, 06/10): a tela mostra só a barra, a porcentagem e os pedidos restantes.

## Como funciona

**Banco:** migração `prisma/sql/manual/029_secretary_credits*.sql`, com duas tabelas.
- `SecretaryCreditLedger`: o livro de pedidos.
  - Só aceita inclusão. Uma trigger e a falta de permissão impedem alterar ou apagar.
  - Cada linha guarda o saldo e a base da barra logo depois dela.
  - É escrito sob uma trava por salão (`creditLock`), que também abre a permissão de escrita da RLS (`app.credit_write`).
  - Um índice garante um único crédito por pagamento.
- `SecretaryCreditPurchase`: as compras.
  - A cotação (pacote, valor, pedidos, prazo) não pode mudar.
  - A rotina agendada só enxerga compras aguardando pagamento.

**Compra:** `POST /api/billing/credits`, só o dono, com chave de idempotência. Cria uma preferência de Checkout Pro:
- valor exato em reais, 1 parcela, Pix e cartão (boleto excluído) e validade de 24 h;
- referência `efc:{salão}:{compra}`;
- a resposta do Mercado Pago é conferida campo a campo antes de mostrar o link.

**Confirmação** do pagamento, sempre relendo o pagamento no Mercado Pago e conferindo referência, conta, moeda, valor e
modo live:
1. o webhook (`/api/webhooks/mercadopago`, tópico `payment`, ramo `efc:`);
2. a volta do checkout (`GET /api/billing/credits?sync=1`);
3. a rotina de cobrança (`/api/cron/billing`, até 20 compras por execução).

**Na Secretária:** `budgeted()` exige pelo menos 1 pedido (mensagem e gravação). `charged()` debita depois da resposta.
A barra fica no topo da conversa e o aviso aparece acima da caixa de texto.

**Cortesia:** `POST /api/hq/secretary-credits`, só HQ, com corpo `{ salonId, requests, reason, grantKey }`.

## Para ligar (cada passo de Produção só com o ok do dono)

1. Merge do PR (tudo fica desligado: `SALON_SECRETARY_CREDITS_ENABLED` ausente).
2. Supabase Produção:
   - rodar `029_secretary_credits.preflight.sql` (só leitura);
   - fazer backup;
   - aplicar `029_secretary_credits.sql`;
   - rodar `029_secretary_credits.verify.sql`, que deve devolver `VERIFY_OK`.
   O mesmo SQL já foi aplicado duas vezes num Postgres 16 local descartável: deu `VERIFY_OK` e todas as recusas de
   segurança funcionaram.
3. No painel do Mercado Pago, conferir que o webhook do app recebe o tópico **Pagamentos** (o mesmo das trocas de plano).
4. Testar primeiro em Preview, com `MERCADOPAGO_MODE=test`, credenciais de teste e Pix/cartão de teste:
   comprar, ver o crédito, estornar pelo painel e ver os pedidos voltarem.
5. Dar a cortesia do salão de apresentação pelo HQ.
6. Vercel Produção: `SALON_SECRETARY_CREDITS_ENABLED=true` e um novo deploy.

Para parar de vender sem perder nada, basta `SALON_SECRETARY_CREDITS_ENABLED=false`. A flag desligada bloqueia só compras
novas e o uso de pedidos. Pagamentos de compras já abertas continuam sendo confirmados, porque o dinheiro nunca fica sem os
pedidos. Um pagamento que não confere com a compra (valor, moeda, conta ou modo) não credita nada, e a compra vai para
revisão. Com a flag ligada, os tetos de gasto diário e mensal (`secretary-spend.ts`) passam a valer para todos os salões,
não só para o piloto. Isso limita, por exemplo, gravações que nunca viram mensagem. A volta do checkout de um pacote usa
`/api/billing/return?origem=creditos` e cai no cartão da Secretária. O rollback da 029 se recusa a apagar
tabelas que já têm histórico.
