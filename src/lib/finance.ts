import { prisma } from "./prisma";
import { eachDayOfInterval, format } from "date-fns";
import { resolveRange, type RangeKey } from "./dashboard";
import { getProfessionalPerformance } from "./kpis";

/**
 * Motor financeiro do painel do dono. Consolida receitas (serviços +
 * produtos), despesas (modelo Expense), comissões e deriva lucro, fluxo de
 * caixa, DRE, quebras por categoria e por forma de pagamento, além de contas
 * a pagar/receber. Reaproveita resolveRange do dashboard para o filtro.
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

export async function getFinanceMetrics(salonId: string, range: RangeKey) {
  const now = new Date();
  const { from, to } = resolveRange(range, now);

  const [services, products, expenses, payments, proPerf, upcoming, unpaidExpenses] =
    await Promise.all([
      // Receita de serviços (atendimentos concluídos)
      prisma.appointment.findMany({
        where: { salonId, status: "COMPLETED", startAt: { gte: from, lte: to } },
        select: { priceCents: true, startAt: true },
      }),
      // Receita de produtos vendidos
      prisma.appointmentProduct.findMany({
        where: { appointment: { salonId, status: "COMPLETED", startAt: { gte: from, lte: to } } },
        select: { quantity: true, priceCentsUnit: true, appointment: { select: { startAt: true } } },
      }),
      // Despesas do período (por vencimento)
      prisma.expense.findMany({
        where: { salonId, dueDate: { gte: from, lte: to } },
        select: { id: true, amountCents: true, category: true, kind: true, dueDate: true, paidAt: true },
      }),
      // Pagamentos por forma (dos atendimentos concluídos do período)
      prisma.payment.findMany({
        where: { appointment: { salonId, status: "COMPLETED", startAt: { gte: from, lte: to } } },
        select: { amountCents: true, method: true },
      }),
      getProfessionalPerformance(salonId, from, to),
      // Contas a receber: futuros confirmados/pendentes
      prisma.appointment.findMany({
        where: { salonId, status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] }, startAt: { gte: now } },
        select: { priceCents: true },
      }),
      // Contas a pagar: despesas não pagas (qualquer vencimento)
      prisma.expense.findMany({
        where: { salonId, paidAt: null },
        select: { id: true, description: true, amountCents: true, dueDate: true, category: true },
        orderBy: { dueDate: "asc" },
      }),
    ]);

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
  for (const d of eachDayOfInterval({ start: from, end: to })) {
    bucket.set(format(d, "yyyy-MM-dd"), { in: 0, out: 0 });
  }
  for (const a of services) {
    const k = format(a.startAt, "yyyy-MM-dd");
    const b = bucket.get(k);
    if (b) b.in += a.priceCents;
  }
  for (const x of products) {
    const k = format(x.appointment.startAt, "yyyy-MM-dd");
    const b = bucket.get(k);
    if (b) b.in += x.quantity * x.priceCentsUnit;
  }
  for (const e of expenses) {
    const k = format(e.dueDate, "yyyy-MM-dd");
    const b = bucket.get(k);
    if (b) b.out += e.amountCents;
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

  const receivable = upcoming.reduce((s, a) => s + a.priceCents, 0);
  const payable = unpaidExpenses.reduce((s, e) => s + e.amountCents, 0);

  return {
    range,
    period: { from, to },
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
    payable,
    unpaidExpenses,
    expensesInPeriod: expenses.length,
  };
}

export type FinanceMetrics = Awaited<ReturnType<typeof getFinanceMetrics>>;
