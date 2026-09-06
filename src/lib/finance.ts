import type { Tx } from "./prisma-tenant";
import { resolveRange, type RangeKey } from "./dashboard";
import { getProfessionalPerformance } from "./kpis";
import {
  DEFAULT_TIMEZONE,
  addCalendarDays,
  dateKeyInTimeZone,
} from "./time";

/**
 * Motor financeiro do painel do dono. Consolida receitas (serviços +
 * produtos), despesas (modelo Expense), comissões e deriva lucro, fluxo de
 * caixa, DRE, quebras por categoria e por forma de pagamento, além de contas
 * a pagar/receber. Reaproveita resolveRange do dashboard para o filtro.
 *
 * Recebe `tx` do chamador (de `withTenant`) em vez de abrir a própria
 * conexão — mesmo padrão de kpis.ts.
 */

const METHOD_LABEL: Record<string, string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  CASH: "Dinheiro",
  TRANSFER: "Transferência",
};

const METHOD_COLOR: Record<string, string> = {
  PIX: "#2ECC8B",
  CREDIT_CARD: "#3B9EFF",
  DEBIT_CARD: "#A855F7",
  CASH: "#F59E0B",
  TRANSFER: "#94A3B8",
};

const CAT_COLORS = ["#3B9EFF", "#A855F7", "#F59E0B", "#EF4444", "#2ECC8B", "#EC4899", "#94A3B8"];

export async function getFinanceMetrics(
  tx: Tx,
  salonId: string,
  range: RangeKey,
  timezone = DEFAULT_TIMEZONE,
) {
  const now = new Date();
  const resolved = resolveRange(range, timezone, now);
  const { from, to } = resolved;

  // Sequencial de propósito: o pooler do Postgres roda com connection_limit=1
  // em serverless — 7 queries em Promise.all estouravam o timeout do pool
  // (P2024). Agora roda tudo numa única transação/conexão via withTenant no
  // chamador, então sequencial aqui também evita o anti-padrão de rodar
  // queries concorrentes na mesma transação interativa do Prisma.
  // Receita de serviços (atendimentos concluídos)
  const services = await tx.appointment.findMany({
    where: { salonId, status: "COMPLETED", startAt: { gte: from, lt: to } },
    select: { priceCents: true, startAt: true },
  });
  // Receita de produtos vendidos
  const products = await tx.appointmentProduct.findMany({
    where: { appointment: { salonId, status: "COMPLETED", startAt: { gte: from, lt: to } } },
    select: { quantity: true, priceCentsUnit: true, appointment: { select: { startAt: true } } },
  });
  // Despesas do período (por vencimento)
  const expenses = await tx.expense.findMany({
    where: { salonId, dueDate: { gte: from, lt: to } },
    select: { id: true, amountCents: true, category: true, kind: true, dueDate: true, paidAt: true },
  });
  // Caixa: a data do pagamento é independente da data do atendimento.
  const payments = await tx.payment.findMany({
    where: { appointment: { salonId }, paidAt: { gte: from, lt: to } },
    select: { amountCents: true, method: true, paidAt: true },
  });
  const paidExpenses = await tx.expense.findMany({
    where: { salonId, paidAt: { gte: from, lt: to } },
    select: { amountCents: true, paidAt: true },
  });
  const unpaidCompleted = await tx.appointment.findMany({
    where: { salonId, status: "COMPLETED", payment: { is: null } },
    select: { priceCents: true, products: { select: { quantity: true, priceCentsUnit: true } } },
  });
  const proPerf = await getProfessionalPerformance(tx, salonId, from, to);
  // Contas a receber: futuros confirmados/pendentes
  const upcoming = await tx.appointment.findMany({
    where: { salonId, status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] }, startAt: { gte: now } },
    select: { priceCents: true },
  });
  // Contas a pagar: despesas não pagas (qualquer vencimento)
  const unpaidExpenses = await tx.expense.findMany({
    where: { salonId, paidAt: null },
    select: { id: true, description: true, amountCents: true, dueDate: true, category: true },
    orderBy: { dueDate: "asc" },
  });

  const serviceRevenue = services.reduce((s, a) => s + a.priceCents, 0);
  const productRevenue = products.reduce((s, x) => s + x.quantity * x.priceCentsUnit, 0);
  const revenue = serviceRevenue + productRevenue;

  const commissions = proPerf.reduce((s, p) => s + p.commissionCents, 0);
  const expenseTotal = expenses.reduce((s, e) => s + e.amountCents, 0);
  const expenseFixed = expenses.filter((e) => e.kind === "FIXED").reduce((s, e) => s + e.amountCents, 0);
  const expenseVar = expenseTotal - expenseFixed;

  const grossProfit = revenue - commissions; // após comissões
  const netProfit = grossProfit - expenseTotal; // após despesas
  const margin = revenue > 0 ? netProfit / revenue : 0;

  // ── Fluxo de caixa diário (entradas - saídas) ─────────────────
  const bucket = new Map<string, { in: number; out: number }>();
  for (
    let date = resolved.fromDate;
    date < resolved.toDate;
    date = addCalendarDays(date, 1)
  ) {
    bucket.set(date, { in: 0, out: 0 });
  }
  for (const payment of payments) {
    const entry = bucket.get(dateKeyInTimeZone(payment.paidAt, timezone));
    if (entry) entry.in += payment.amountCents;
  }
  for (const expense of paidExpenses) {
    if (!expense.paidAt) continue;
    const entry = bucket.get(dateKeyInTimeZone(expense.paidAt, timezone));
    if (entry) entry.out += expense.amountCents;
  }
  const cashflow = [...bucket.entries()].map(([date, v]) => ({
    date,
    inflow: v.in,
    outflow: v.out,
    net: v.in - v.out,
  }));

  // ── Despesas por categoria ────────────────────────────────────
  const catMap = new Map<string, number>();
  for (const e of expenses) catMap.set(e.category, (catMap.get(e.category) ?? 0) + e.amountCents);
  const byCategory = [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({ name, value, color: CAT_COLORS[i % CAT_COLORS.length] }));

  // ── Receita por forma de pagamento ────────────────────────────
  const methodMap = new Map<string, number>();
  for (const pay of payments) methodMap.set(pay.method, (methodMap.get(pay.method) ?? 0) + pay.amountCents);
  const byMethod = [...methodMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([method, value]) => ({
      method,
      label: METHOD_LABEL[method] ?? method,
      value,
      color: METHOD_COLOR[method] ?? "#94A3B8",
    }));

  const forecast = upcoming.reduce((s, a) => s + a.priceCents, 0);
  const receivable = unpaidCompleted.reduce((sum, appointment) => sum + appointment.priceCents
    + appointment.products.reduce((total, product) => total + product.quantity * product.priceCentsUnit, 0), 0);
  const payable = unpaidExpenses.reduce((s, e) => s + e.amountCents, 0);

  return {
    range,
    period: { from, to: new Date(to.getTime() - 1) },
    bounds: { from, to },
    revenue,
    serviceRevenue,
    productRevenue,
    commissions,
    expenseTotal,
    expenseFixed,
    expenseVar,
    grossProfit,
    netProfit,
    margin,
    cashflow,
    byCategory,
    byMethod,
    receivable,
    forecast,
    payable,
    unpaidExpenses,
    expensesInPeriod: expenses.length,
  };
}

export type FinanceMetrics = Awaited<ReturnType<typeof getFinanceMetrics>>;
