# Plano e assinatura — revisão de UX de 27/09/2026

Branch `claude/plan-subscription-ui-fix-a842b9`. Candidata não publicada.
Somente apresentação e orquestração no cliente: preços, catálogo, regras de
proporcionalidade, idempotência, webhooks, worker, RLS e schema preservados.
Sem migration, flag, SQL ou chamada produtiva.

## Diagnóstico

- **Atalho do topo incoerente.** O layout só lia assinatura com `paidThrough`;
  uma contratação pendente mostrava o plano legado ("Essencial · Alterar plano")
  enquanto a página exibia "Equipe · 5 agendas · Aguardando pagamento". Atraso,
  restrição, renovação cancelada e troca em andamento também não apareciam.
- **Dois seletores de plano.** Pendente e pago usavam painéis diferentes; os
  cards não indicavam o plano atual, escolher o próprio plano gerava
  `PLAN_UNCHANGED` e o upgrade ficava atrás de "Escolher outro plano".
- **Pendente recriava a contratação.** Escolher o mesmo plano pendente cancelava
  a tentativa e abria outra, em vez de continuar o checkout existente.
- **Pagamento de upgrade sem continuidade.** Após confirmar, o link aparecia só
  no polling de 8 s, sem indicação; a cotação expira em 15 minutos.
- **Erros genéricos e fora da vista.** Códigos como `INVALID_ORIGIN` (acesso
  pelo domínio antigo) caíam em "Não foi possível consultar sua assinatura", no
  topo da página, longe do botão clicado.

## Referências adotadas

Stripe Customer Portal (resumo do plano, confirmação com "cobrança hoje" e
próxima recorrência), Linear/Vercel/Notion (alternância mensal/anual com
economia, "Plano atual" no card, upgrade × redução, uso da capacidade),
GitHub/Linear (cancelamento em seção separada e discreta).

## Entrega

- Atalho do topo com plano **e situação** (Ativo, Aguardando pagamento, Troca
  em andamento, Pagamento em atraso, Regularizar pagamento, Renovação
  cancelada, Plano encerrado). Chip neutro; borda e ponto âmbar/vermelho só
  quando o dono precisa agir. Tentativa abandonada volta ao plano em uso.
  `loadPlanBadge` usa as mesmas regras de estado/cancelamento da API.
- Página em blocos: **Seu plano** (situação, valor, próxima cobrança, acesso
  pago, agendas em uso, avisos e troca em andamento), **Mudar de plano**
  (catálogo único), **Histórico de cobranças** (tabela) e **Renovação
  automática** (cancelamento).
- Catálogo com a composição aprovada da landing: Individual, Essencial e Equipe
  com seletor 5/10 agendas e adicionais. Rótulos por contexto: Assinar, Trocar
  para este plano, Fazer upgrade, Reduzir para este plano, Mudar para anual/
  mensal, Plano atual, Continuar pagamento. Capacidade menor que a equipe fica
  bloqueada com explicação (o servidor continua validando).
- Revisão da troca: atual → novo, cobrança adicional agora, nova recorrência,
  quando vale. "Confirmar e pagar diferença" segue para o Mercado Pago assim
  que o link validado por `safeCheckout` existe (polling de 3 s por até 90 s).
- Troca de contratação pendente em duas etapas visíveis; o botão de pagamento
  só aparece após a confirmação do encerramento no Mercado Pago.
- Retorno do checkout redireciona para `/assinatura?retorno=mercadopago`, que
  só acelera o acompanhamento; nenhum parâmetro libera acesso.
- Aviso quando a página é aberta fora do `NEXTAUTH_URL`: as mutações exigem a
  origem oficial, então o painel orienta abrir o endereço oficial.
- Mensagens para `INVALID_ORIGIN`, `INVALID_CHANGE_PERIOD`,
  `IDEMPOTENCY_MISMATCH` e outros códigos; erro de ação aparece junto aos cards.
- Tokens de tema (`success`, `warning`, `danger`, `card`, `surface-1`) nos dois
  temas; sem cor fixa. Responsivo de 320 px a desktop sem rolagem horizontal.

## Validação

- `npm run lint`, `tsc --noEmit`, suíte Vitest completa (217 arquivos, 1.175
  testes) e `npm run build` aprovados localmente. `http.test.ts` passou a
  esperar o marcador fixo `retorno=mercadopago`, mantendo o descarte de
  parâmetros do provedor.
- Navegador local com PostgreSQL descartável e dados do seed: estados
  pendente, ativo, troca aguardando pagamento, atraso e renovação cancelada,
  em claro/escuro e 320/390/1440 px, sem rolagem horizontal. Cotação real do
  servidor conferida (diferença proporcional e recorrência); nenhuma
  confirmação enviada ao Mercado Pago.
- `billing-postgres.integration.test.ts` em PostgreSQL 16 local descartável com
  schema atual + migrations manuais 020/023/024/025 e role sem BYPASSRLS/FORCE
  RLS: 66 testes aprovados (62 existentes + processamento direcionado, backoff,
  isolamento de tenant, sincronização do dono e reativação ponta a ponta).
- E2E `billing-changes.spec.ts` atualizado para os novos rótulos. Localmente,
  com `next dev` no Windows, a execução completa passou pelas revisões de
  cancelamento e upgrade com axe WCAG 2.1 AA em 320/390/1280 px, pela revisão
  anual e pelo acesso bloqueado, e excedeu os 180 s no `reload` final;
  reexecuções falharam por falta de memória da máquina. A confirmação
  definitiva fica para o `schema-smoke` do CI.

## Complemento aprovado: confirmação imediata e reativação

Decisão registrada em `DECISOES_PRODUTO.md` (27/09/2026).

- **Processamento imediato.** `drainBillingSubscription` continua as etapas da
  assinatura afetada logo após webhook, cancelamento, troca, reativação ou
  sincronização pedida pelo dono, com o mesmo lease do worker global (nunca em
  paralelo), orçamento de 35 s e no máximo 6 etapas. Para quando uma etapa não
  produz progresso observável (situação do provedor, troca, cobranças, inbox),
  por exemplo enquanto o Mercado Pago aguarda o dono; job em backoff de erro
  fica para o agendamento. `drainTriggeredSubscription` também avança a
  assinatura de origem quando o gatilho é uma recorrência substituta.
- **Sincronização sob demanda.** `POST /api/billing/sync` (mesma origem, rate
  limit e verificação de proprietário das demais escritas) coloca na fila a
  assinatura atual do próprio estabelecimento e a processa em seguida. É
  chamada no retorno do checkout e em "Atualizar situação"; ignorada se houve
  sincronização nos últimos 15 s. Nada vindo do navegador libera acesso.
- **Reativação da renovação.** `POST /api/billing/reactivate` cria uma troca
  `CYCLE` com termos iguais (o CHECK da 025 só aceita UPGRADE/SCHEDULED/CYCLE):
  o worker cria a nova recorrência com `start_date` no fim do período pago,
  libera o link de autorização e promove a nova assinatura após o primeiro
  pagamento — o mesmo caminho já validado da troca mensal/anual. Requer
  renovação totalmente cancelada, pelo menos 1 h de período pago, sem revisão
  financeira, sem troca pendente e capacidade compatível; idempotente por
  `requestKey`. Link válido por 24 h; "Desistir da reativação" encerra a nova
  autorização. Novo cancelamento encerra também a recorrência reativada.
- **Retenção.** O diálogo de cancelamento oferece "Ver planos menores" quando
  existe plano menor que ainda comporta a equipe.

## Limites conhecidos

- A reconciliação agendada continua no GitHub Actions (a cada 5 minutos, sujeita
  a atrasos). Com o processamento imediato ela passa a ser só rede de
  segurança; migrar para `pg_cron` exige SQL em Production e autorização.
- Enquanto uma reativação aguarda o início da nova recorrência, trocas de plano
  ficam bloqueadas (mesma regra da troca mensal/anual existente).
- Reativação e processamento imediato foram validados com o Mercado Pago
  simulado nos testes de integração; nenhuma chamada real foi feita.
