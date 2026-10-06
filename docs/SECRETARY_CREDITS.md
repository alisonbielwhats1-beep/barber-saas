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
  | R$ 15 | 150.000 | cerca de 80 pedidos | 90% |
  | R$ 25 | 275.000 | cerca de 145 pedidos | 89% |
  | R$ 40 | 485.000 | cerca de 260 pedidos | 88% |
  | R$ 80 | 1.053.000 | cerca de 565 pedidos | 87% |

  As estimativas usam o custo medido no piloto em 06/10: 37 mensagens e 35 chamadas ao DeepSeek, cada uma com ~11.400 tokens
  de entrada, dos quais 58% vieram do cache. Isso dá US$ 0,0033 por pedido, ou R$ 0,187 com o ×10. A primeira estimativa
  (R$ 0,08) estava cerca de 4 vezes abaixo. É preciso medir de novo no relatório do HQ depois de qualquer mudança no prompt.

- **Franquia grátis todo mês:** 37.400 unidades, cerca de 20 pedidos, para todo salão.
  - Custa uns R$ 0,37 reais por salão por mês.
  - É usada antes do crédito pago e não acumula: o que sobrar não passa para o mês seguinte.
- A recarga **soma** ao que sobrou e a barra volta a 100%. O crédito não expira.
- Só o dono recarrega. Todos os papéis veem a barra. Aviso abaixo de 20%; sem nada, a Secretária para e a agenda segue normal.

## Regras (validadas em teste)

Fonte: `src/lib/secretary-credits-rules.ts`. Testes em `src/lib/__tests__/secretary-credits-rules.test.ts` e
`src/lib/billing/secretary-credits.test.ts`.

- **Cobrança:** custo em micro-dólares × câmbio fixo (`SALON_SECRETARY_USD_BRL`, padrão 5,60) × 10, em unidades inteiras de
  R$ 0,0001, arredondando para cima.
  - Média medida no piloto: US$ 0,0033 por pedido, que vira R$ 0,187. Desse custo, o modelo é US$ 0,0029 e a voz US$ 0,0005.
  - O custo usa o preço mais alto dos fornecedores, então a margem nunca fica abaixo de 90%.
- **Uma cobrança por chamada e por gravação** (correção da validação de 06/10):
  - Antes de cada pedido e logo depois dele, todas as chamadas do modelo do salão que ainda não foram cobradas são cobradas,
    cada uma uma vez só, pelo próprio registro (`call:<id>`).
  - Isso inclui a resposta a uma ação pendente (conversa "filha"), a correção automática e a mensagem que falhou depois da
    chamada: a chamada custou, então é cobrada. O que escapar por uma queda é cobrado no pedido seguinte.
  - Chamada sem tokens informados é cobrada como uma chamada média (US$ 0,003).
  - Chamadas de antes do lançamento (a noite de testes do piloto) e com mais de 48 h não são cobradas.
  - Cada gravação é cobrada uma vez (`voice:<id>`), mesmo que não seja enviada, antes do registro de auditoria. Sem custo
    informado, cobra pela duração, a US$ 0,006 por minuto.
  - Câmbio fora de 1 a 20 bloqueia todo pedido em vez de cobrar zero.
- **Barra:**
  - Quem já comprou vê o crédito pago: o saldo dividido pelo saldo logo depois da última recarga. A franquia que sobrou entra
    dos dois lados da conta, então gastar a franquia não baixa a barra, e logo depois de uma compra ela marca sempre 100%.
  - Quem nunca comprou vê a franquia do mês.
  - Exemplo do dono: com 20% sobrando, comprar R$ 15 soma os dois e a barra volta a 100%.
- **Pedido já iniciado sempre termina:** o crédito pago pode ficar negativo e a próxima recarga cobre a diferença.
- **Reembolsos e pagamentos problemáticos:**
  - reembolso devolve o crédito na proporção do valor estornado, arredondando para cima (R$ 5 de R$ 15 = 1/3);
  - chargeback devolve tudo; status "refunded" sem valor informado também devolve tudo;
  - uma compra em revisão continua em revisão até alguém resolver à mão;
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
  - Antes e depois de cada mensagem, `chargePendingCalls()` cobra as chamadas pendentes do salão.
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

## Baratear o custo (pronto, desligado)

O pedido ao modelo leva ~11.400 tokens, mas só 58% vinham do cache, porque os dados que mudam a cada mensagem ficavam antes
das definições das ferramentas. A chave `SALON_SECRETARY_CACHE_LAYOUT=dynamic-last` move esses dados para o começo da mensagem
do usuário, com o mesmo texto na mesma ordem, e deixa instruções e ferramentas, que não mudam, no início. A estimativa do
subagente é de 85% a 88% do texto vindo do cache, cerca de 45% mais barato por chamada.

Com a chave desligada, o contrato certificado não muda: o teste de certificação passa. Ligada, o contrato muda, e por isso ela
só vai para Produção depois de uma nova certificação (Golden k=3 com a chave ligada, que é uma bateria paga) e de remedir o
custo médio por pedido.

