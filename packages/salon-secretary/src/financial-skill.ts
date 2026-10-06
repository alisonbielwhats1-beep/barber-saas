import { z } from "zod";

export const financialMetric = z.enum(["service_revenue", "realized_revenue", "received_revenue", "completed_count", "average_ticket", "outstanding_receivables"]);
export const financialPeriod = z.enum(["today", "yesterday", "this_week", "last_week", "this_month", "last_month"]);
/** Interpretation only. No amounts, rows, tenant, refs, query language or arbitrary filters. */
export const financialInterpretation = z.object({
  metrics: z.array(financialMetric).min(1).max(6).nullable().optional(),
  period: financialPeriod.nullable().optional(),
  compare_period: financialPeriod.nullable().optional(),
  group_by: z.enum(["professional", "service"]).nullable().optional(),
}).strict();
export type FinancialInterpretation = z.infer<typeof financialInterpretation>;
export const financialRequirements = () => ({ operation: "financial.report", tool: "T09", read_only: true,
  metrics: financialMetric.options, periods: financialPeriod.options,
  default_metric: "service_revenue", period_required_except: "outstanding_receivables",
  group_by: ["professional", "service"], grouped_metric: "service_revenue", backend_only_calculation: true });
export const financialSkill = `Financial v1.0.0 — Secretária Everflair, T09 get_financial_summary, somente leitura.
Interprete métrica, período e agrupamento. Nunca calcule valores, percentuais, ticket ou disponibilidade de dados.
Faturamento sem qualificador = service_revenue: serviços de atendimentos COMPLETED por data do atendimento, bruto antes de desconto de fechamento, igual ao dashboard.
realized_revenue soma também produtos; received_revenue é valor registrado em Payment por data de pagamento; não é líquido de estornos/taxas.
completed_count conta atendimentos COMPLETED, não itens de serviço. average_ticket = service_revenue/completed_count.
outstanding_receivables é saldo atual de COMPLETED sem Payment, serviços e produtos. Não é previsão de agenda e não admite histórico/comparação por período.
Períodos: today, yesterday, this_week, last_week, this_month, last_month. Não invente período ausente; backend pergunta. Datas e timezone vêm do backend. Semana do domínio começa domingo.
Comparações usam compare_period; percentuais calculados pelo backend, base zero é indefinida.
group_by professional/service somente para service_revenue. Ranking por receita, não por quantidade vendida. Não suportamos ranking por quantidade neste Gate: peça reformulação, não converta mais vendido em maior receita.
Retorne somente seletores explícitos; null omite/preserva. Só backend fornece números/nomes do ranking com cobertura. Nenhum registro bruto de cliente/pagamento deve ser solicitado ao modelo.
Sem baixa, estorno, cobrança, escrita, lucros, previsão, taxas, métodos de pagamento ou filtros por entidade. Pedido fora do contrato exige esclarecimento; nunca substitua silenciosamente a métrica.
Reutilize a consulta incompleta atual. Sem proposta ou confirmação de escrita financeira. Somente Services/Customers/Scheduling possuem seus fluxos de escrita separados. Não afirme sucesso financeiro nem invente resposta: texto final é determinístico.`;
