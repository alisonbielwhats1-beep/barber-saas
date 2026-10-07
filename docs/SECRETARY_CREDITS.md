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
  | R$ 15 | 150.000 | cerca de 120 pedidos | 90% |
  | R$ 25 | 275.000 | cerca de 220 pedidos | 89% |
  | R$ 40 | 485.000 | cerca de 390 pedidos | 88% |
  | R$ 80 | 1.053.000 | cerca de 840 pedidos | 87% |

  As estimativas usam o **custo real** (decisão do dono em 06/10: ×10 sobre o custo real). São os tokens do piloto às
  tarifas reais do provedor, ajustadas em 868 chamadas informadas pelo OpenRouter (US$ 0,30 / 0,006 / 1,20 por milhão para
  entrada nova, entrada do cache e saída), mais 5,5% de taxa do OpenRouter, mais a voz. Isso dá US$ 0,0022 por pedido, ou
  R$ 0,125 com o ×10. É preciso medir de novo no relatório do HQ.

- **Franquia grátis todo mês:** 25.000 unidades, cerca de 20 pedidos, para todo salão.
  - Custa uns R$ 0,25 reais por salão por mês.
  - É usada antes do crédito pago e não acumula: o que sobrar não passa para o mês seguinte.
- A recarga **soma** ao que sobrou e a barra volta a 100%. O crédito não expira.
- Só o dono recarrega. Todos os papéis veem a barra. Aviso abaixo de 20%; sem nada, a Secretária para e a agenda segue normal.

## Regras (validadas em teste)

Fonte: `src/lib/secretary-credits-rules.ts`. Testes em `src/lib/__tests__/secretary-credits-rules.test.ts` e
`src/lib/billing/secretary-credits.test.ts`.

- **Cobrança (×10 sobre o custo real):** custo em micro-dólares × câmbio fixo (`SALON_SECRETARY_USD_BRL`, padrão 5,60) × 10,
  em unidades inteiras de R$ 0,0001, arredondando para cima.
  - **Custo real de cada chamada:** o valor que o OpenRouter informa em `usage.cost`, gravado em cada uso como
    `cost_micro_usd`, mais 5,5% de taxa da plataforma.
  - **Sem custo informado** (por exemplo, a reserva da OpenAI): usa os tokens pela tabela do provedor.
  - **Qualquer custo informado é o custo real** (decisão do dono em 07/10): não há mais piso de 20% da tabela, que cobrava até
    cerca de 5,6× o real em chamadas quase todas em cache. Custo zero ou ausente usa a tabela, para nunca cobrar uma chamada
    como grátis.
  - **Voz:** é o custo que a OpenAI informa, que já é o real.
  - Média real medida no piloto: US$ 0,0022 por pedido, que vira R$ 0,125. Desse custo, o modelo é US$ 0,0017 (já com a taxa) e a voz US$ 0,0005.
- **Uma cobrança por chamada e por gravação** (correção da validação de 06/10):
  - Antes de cada pedido e logo depois dele, todas as chamadas do modelo do salão que ainda não foram cobradas são cobradas,
    cada uma uma vez só, pelo próprio registro (`call:<id>`).
  - Isso inclui a resposta a uma ação pendente (conversa "filha"), a correção automática e a mensagem que falhou depois da
    chamada: a chamada custou, então é cobrada. O que escapar por uma queda depois de a chamada terminar é cobrado no pedido
    seguinte; uma chamada interrompida antes de gravar o fim (processo derrubado) não tem registro e não é cobrada.
  - **Salão movimentado** (correção da validação de 07/10): a varredura lê só as chamadas ainda não cobradas, das mais antigas
    para as mais novas, em lotes de 50 por transação e até 20 lotes por varredura. Antes, ela lia as 500 mais antigas da janela,
    inclusive as já cobradas, e deixava as novas sem cobrança num salão com mais de 500 chamadas em 48 h; um acúmulo grande
    também podia estourar o tempo da transação e recusar todos os pedidos.
  - Chamada sem tokens informados é cobrada como uma chamada média (US$ 0,003).
  - Chamadas de antes do lançamento (a noite de testes do piloto) e com mais de 48 h não são cobradas.
  - Cada gravação é cobrada uma vez (`voice:<id>`), mesmo que não seja enviada, antes do registro de auditoria. Sem custo
    informado, cobra pela duração, a US$ 0,006 por minuto.
  - **Gravação que falha** (correção da validação de 07/10): erro devolvido pela OpenAI libera a reserva e não cobra nada (a
    OpenAI não cobra a chamada recusada); tempo esgotado, conexão caída ou resposta ilegível podem ter sido cobrados, então
    valem a duração declarada ao preço por minuto do modelo, só no teto do salão: o crédito do cliente nunca paga uma gravação que não devolveu texto. Antes, a reserva do pior caso ficava no teto para sempre, e umas
    37 falhas seguidas esgotavam o US$ 1 do dia, travando também o texto.
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
  - **alerta** (validação de 07/10): toda compra que entra em revisão manda um e-mail ao administrador da plataforma
    (`PLATFORM_ADMIN_NOTIFICATION_EMAIL`, com o Resend configurado), só com ids e códigos, e o dono do salão vê no cartão que o
    pagamento está em conferência. O relatório do HQ mostra `purchases_in_review` por salão;
  - um pagamento divergente que chega depois não tira do estado "Pago" uma compra já paga: o crédito dela continua;
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
- **Confirmação (dono, 06/10: "pagou, o crédito cai na hora"):** em todos os caminhos o pagamento é relido no Mercado Pago e
  conferido (referência, conta, moeda, valor e modo), e o crédito entra uma vez só.
  - Webhook (tópico `payment`, ramo `efc:`): cada compra leva o próprio endereço do aviso (`notification_url`), então o
    Mercado Pago avisa mesmo que o painel de Webhooks não tenha o evento Pagamentos.
  - Quem olha confirma (`syncPendingCreditPurchases`): o cartão de Plano e assinatura, a barra de crédito da Secretária e um
    pedido recusado por falta de crédito conferem antes as compras do salão que aguardam pagamento. O cartão pergunta a cada
    5 s enquanto houver compra pendente e de novo quando a página volta a ser vista (Pix pago no app do banco).
  - Rotina de cobrança (`/api/cron/billing`), como rede de segurança.
  - Caso real: em 06/10 a compra de R$ 15 do Studio Martinelli ficou 1h40 sem crédito (sem aviso, sem volta pelo botão, e a
    rotina do GitHub rodando poucas vezes ao dia); creditada pela rotina disparada à mão.
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

## Baratear o custo: resultado da medição (06/10)

A hipótese era que só 58% do pedido vinha do cache porque os dados de cada mensagem ficavam antes das definições das
ferramentas. A chave `SALON_SECRETARY_CACHE_LAYOUT=dynamic-last` move esses dados para o fim. Ela foi medida numa bateria
Golden k=3 com a chave ligada (`golden-20261006-deepseek-cache-layout-k3`).

| | Layout certificado (bateria de 05/10) | Layout novo (06/10) |
|---|---|---|
| Resultado | 90/90 | 90/90 |
| Texto vindo do cache | **94,8%** | 89,1% |
| Custo real informado pelo OpenRouter, por chamada | **US$ 0,00051** | US$ 0,00069 |

**Conclusão: o layout novo não barateia.** O provedor já reaproveita o prefixo com o layout atual. Os 58% do piloto vêm de
**cache frio**: as mensagens chegaram com minutos de intervalo e o cache expirou entre elas. A chave fica no código desligada,
sem certificado.

**Achado para o multiplicador:** o custo real que o OpenRouter cobra (US$ 0,00051 por chamada) é cerca de **40% do custo pelo
qual cobramos** (US$ 0,00131 por chamada, pela tabela de preço máximo). Com "×10" sobre a tabela máxima, o multiplicador
efetivo sobre o custo real fica perto de ×25, uma margem de cerca de 96%. Cobrar ×10 sobre o custo real faria o pedido sair
pela metade ou menos. Essa decisão é do dono.
