import { RecentReceipts } from "./recent-receipts";
import { ReceiptWorkspace } from "./receipt-workspace";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { requireRole, FINANCE_ROLES } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getFinanceMetrics } from "@/lib/finance";
import { type RangeKey } from "@/lib/dashboard";
import { dateKeyInTimeZone, formatPeriodLabel, isDateKey } from "@/lib/time";
import type { FinanceCalendarPeriod } from "@/lib/finance-period";
import { FinancePeriodFilter } from "./finance-period-filter";
import { cn, formatMoney } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  Wallet,
  PiggyBank,
  Percent,
  Scissors,
  Package,
  HandCoins,
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  Layers,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Receipt,
  TrendingUp,
  TrendingDown,
  PieChart,
} from "lucide-react";
import { RangeFilter } from "../dashboard/range-filter";
import { DonutChart } from "../dashboard/donut-chart";
import { CashflowChart } from "./cashflow-chart";
import { ExpenseManager, type ExpenseRow } from "./expense-manager";
import { AutoRefresh } from "@/components/auto-refresh";
import { FoldSection } from "../relatorios/report-section";
import { formatMoneyHero, formatMoneyWhole, KpiCard, SectionTitle, SummaryRow, ToneChip, type Tone } from "../dashboard/results-ui";

const VALID: RangeKey[] = ["today", "yesterday", "7d", "15d", "30d", "90d", "year"];

/* Fatias dos donuts em tons da paleta: formas de pagamento em lilás, despesas em tons do texto. */
const SHADES = [1, 0.78, 0.62, 0.5, 0.4, 0.32, 0.25, 0.2, 0.16, 0.12];
const shade = (token: "accent" | "foreground", i: number) => `hsl(var(--${token}) / ${SHADES[i % SHADES.length]})`;

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; period?: string; date?: string }>;
}) {
  // Financeiro do salão inteiro: só dono/gerente. Profissional e recepcionista
  // são redirecionados — antes bastava abrir a URL para ver o DRE completo.
  const ctx = await requireRole(FINANCE_ROLES);
  const { salonId } = ctx;
  const { range: selectedRange, period: selectedPeriod, date: selectedDate } = await searchParams;
  const range: RangeKey = VALID.includes(selectedRange as RangeKey)
    ? (selectedRange as RangeKey)
    : "30d";

  const { m, expenseRows, timezone, calendar, referenceDate } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true },
    });
    if (!salon) throw new Error("Estabelecimento não encontrado");
    const referenceDate = typeof selectedDate === "string" && isDateKey(selectedDate) ? selectedDate : dateKeyInTimeZone(new Date(), salon.timezone);
    const mode = selectedPeriod === "day" || selectedPeriod === "week" || selectedPeriod === "month" ? selectedPeriod : null;
    const calendar: FinanceCalendarPeriod | undefined = mode ? { mode, date: referenceDate } : VALID.includes(selectedRange as RangeKey) ? undefined : { mode: selectedDate ? "day" : "month", date: referenceDate };
    const m = await getFinanceMetrics(tx, salonId, range, salon.timezone, calendar);
    const expenses = await tx.expense.findMany({
      where: { salonId, dueDate: { gte: m.bounds.from, lt: m.bounds.to } },
      select: { id: true, description: true, category: true, kind: true, amountCents: true, dueDate: true, paidAt: true },
      orderBy: { dueDate: "desc" },
    });
    const expenseRows = expenses.map((e) => ({
      id: e.id,
      description: e.description,
      category: e.category,
      kind: e.kind,
      amountCents: e.amountCents,
      dueDate: e.dueDate.toISOString(),
      paidAt: e.paidAt ? e.paidAt.toISOString() : null,
    })) as ExpenseRow[];
    return { m, expenseRows, timezone: salon.timezone, calendar, referenceDate };
  });
  const received = m.byMethod.reduce((sum, item) => sum + item.value, 0);

  // Textos do período (só apresentação).
  const periodLabel = formatPeriodLabel(m.period.from, m.period.to, timezone);
  const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const buttonLabel = calendar?.mode === "month"
    ? capitalize(formatInTimeZone(m.period.from, timezone, "MMMM yyyy", { locale: ptBR }))
    : calendar?.mode === "day"
      ? capitalize(formatInTimeZone(m.period.from, timezone, "EEE, d 'de' MMM", { locale: ptBR }))
      : periodLabel;
  const receivedWord = calendar?.mode === "month"
    ? `em ${formatInTimeZone(m.period.from, timezone, "MMMM", { locale: ptBR })}`
    : calendar?.mode === "day"
      ? (referenceDate === dateKeyInTimeZone(new Date(), timezone) ? "hoje" : `em ${formatInTimeZone(m.period.from, timezone, "dd/MM")}`)
      : calendar?.mode === "week" ? "na semana" : "no período";
  const unpaidInPeriod = expenseRows.filter((expense) => !expense.paidAt).length;
  const expenseHint = unpaidInPeriod ? `${unpaidInPeriod} ainda sem pagar` : expenseRows.length ? "Tudo pago" : "Sem despesas";
  const marginLabel = `Margem líquida ${(m.margin * 100).toFixed(1).replace(".", ",")}%`;
  const negative = m.netProfit < 0;

  return (
    <div className="admin-summary-page finance-workspace mx-auto flex w-full max-w-7xl flex-col gap-4 lg:gap-5">
      <AutoRefresh intervalMs={120_000} />
      {/* Cabeçalho: título, período e filtro */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">Financeiro</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="tabular-nums">{periodLabel}</span> · valores arredondados, sem centavos
          </p>
          <nav aria-label="Operações financeiras" className="mt-3 flex flex-wrap gap-2">
            <Link href="#recebimentos" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-sm:flex-1")}><Receipt aria-hidden="true" className="h-4 w-4" />Recebimentos</Link>
            <Link href="#despesas" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-sm:flex-1")}><Layers aria-hidden="true" className="h-4 w-4" />Despesas</Link>
          </nav>
        </div>
        <FinancePeriodFilter mode={calendar?.mode ?? null} date={referenceDate} label={periodLabel} buttonLabel={buttonLabel} />
      </div>

      <section aria-label="Resumo financeiro">
        {/* Celular: o recebido em destaque e o resto numa lista curta. */}
        <div className="flex flex-col gap-3 sm:hidden">
          <KpiCard featured icon={Wallet} label={`Recebido ${receivedWord}`} value={formatMoneyHero(received)} full={formatMoney(received)} hint="Pela data do recebimento" />
          <div className="divide-y divide-border rounded-[14px] border border-border bg-card px-4">
            <SummaryRow label="A receber" value={formatMoneyWhole(m.receivable)} href={m.receivable > 0 ? "#recebimentos" : undefined}
              trailing={m.receivable > 0 ? <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /> : <span aria-hidden="true" className="w-4 shrink-0" />} />
            <SummaryRow label="Despesas do período" value={formatMoneyWhole(m.expenseTotal)} trailing={<span aria-hidden="true" className="w-4 shrink-0" />} />
            <SummaryRow label="Resultado operacional" value={formatMoneyWhole(m.netProfit)} valueClassName={negative ? "text-danger" : undefined} trailing={<span aria-hidden="true" className="w-4 shrink-0" />} />
          </div>
        </div>
        {/* Computador: quatro indicadores, cada um com a cor do que significa. */}
        <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          <KpiCard featured icon={Wallet} tone="accent" label="Recebido" value={formatMoneyHero(received)} full={formatMoney(received)} hint="Pela data do recebimento" />
          <KpiCard icon={Receipt} tone="warning" label="A receber" value={formatMoneyHero(m.receivable)} full={formatMoney(m.receivable)} hint="Total em aberto" href={m.receivable > 0 ? "#recebimentos" : undefined} />
          <KpiCard icon={Layers} tone="danger" label="Despesas do período" value={formatMoneyHero(m.expenseTotal)} full={formatMoney(m.expenseTotal)} hint={expenseHint} />
          <KpiCard icon={negative ? TrendingDown : TrendingUp} tone={negative ? "danger" : "accent"} label="Resultado operacional" value={formatMoneyHero(m.netProfit)} full={formatMoney(m.netProfit)} hint={marginLabel} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-label="Fluxo de caixa do período" className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4 sm:p-5">
          <SectionTitle title="Fluxo de caixa" sub={`${buttonLabel} · entradas pela data do recebimento`} />
          <div className="h-36 lg:h-48"><CashflowChart data={m.cashflow} /></div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <Legend swatch="bg-success" label="Entradas" />
            <Legend swatch="bg-danger" label="Saídas" />
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-3.5 border-t-2 border-dashed border-foreground" />Saldo</span>
          </div>
        </section>
        <section aria-labelledby="payment-methods-title" className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4 sm:p-5">
          <SectionTitle id="payment-methods-title" title="Forma de pagamento" sub={received > 0 ? `${formatMoneyWhole(received)} recebidos no período` : "Pela data do recebimento"} />
          {m.byMethod.length === 0 ? <Empty title="Sem pagamentos registrados" /> : (
            <div className="flex flex-col gap-3.5">
              {m.byMethod.map(method => {
                const pct = received > 0 ? Math.round(method.value / received * 100) : 0;
                return (
                  <div key={method.method} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate" title={method.label}>{method.label}</span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{formatMoneyWhole(method.value)} · {pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <ReceiptWorkspace history />
      <section id="despesas" className="scroll-mt-24"><ExpenseManager expenses={expenseRows} timezone={timezone} /></section>

      {/* No computador abre sozinho (como no protótipo); no celular fica recolhido. */}
      <FoldSection id="finance-analysis-title" title="Análises e detalhamento" sub="Pendências, resultado, comissões e recibos" openOnDesktop leading={<ToneChip icon={PieChart} size="md" />}>
        <div className="flex flex-col gap-4 border-t border-border p-4 sm:p-5">
          <details className="group/other rounded-xl border border-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              Outros períodos
              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/other:rotate-180" />
            </summary>
            <div className="border-t border-border p-3.5"><RangeFilter current={range} compact clearCalendar /></div>
          </details>

          {(m.receivable > 0 || m.payable > 0) && (
            <section aria-labelledby="finance-pending-title" className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4 sm:p-5">
              <SectionTitle id="finance-pending-title" title="Pendências que pedem ação" sub="Acompanhe o que ainda pode virar caixa ou sair do caixa." />
              <div className="grid gap-2.5 sm:grid-cols-2">
                {m.receivable > 0 && (
                  <PendingLink href="#recebimentos" icon={ArrowDownCircle} title="Atendimentos a receber" detail={`${formatMoneyWhole(m.receivable)} em atendimentos concluídos`} />
                )}
                {m.payable > 0 && (
                  <PendingLink href="#despesas" icon={ArrowUpCircle} title="Despesas pendentes" detail={`${formatMoneyWhole(m.payable)} ainda não marcadas como pagas`} />
                )}
              </div>
            </section>
          )}

          <RecentReceipts />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {/* Resultado operacional */}
            <section aria-labelledby="finance-dre-title" className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4 sm:p-5 md:col-span-2 xl:col-span-1">
              <SectionTitle id="finance-dre-title" title="Resultado operacional" sub="Receita bruta por atendimento e despesas por vencimento. Comissões são estimativas, não comprovantes de repasse." />
              <div className="flex flex-col text-sm">
                <DreRow label="Receita realizada bruta" value={formatMoney(m.revenue)} strong />
                <DreRow label="(−) Comissões estimadas" value={`- ${formatMoney(m.commissions)}`} muted />
                <DreRow label="= Lucro bruto" value={formatMoney(m.grossProfit)} divider />
                <DreRow label="(−) Despesas fixas" value={`- ${formatMoney(m.expenseFixed)}`} muted />
                <DreRow label="(−) Despesas variáveis" value={`- ${formatMoney(m.expenseVar)}`} muted />
                <DreRow label="= Lucro líquido" value={formatMoney(m.netProfit)} divider strong tone={m.netProfit >= 0 ? "text-success" : "text-danger"} />
              </div>
              <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-background px-3.5 py-3">
                <p className="text-xs text-muted-foreground">Margem líquida</p>
                <p className={`text-lg font-semibold tabular-nums ${m.margin >= 0 ? "text-success" : "text-danger"}`}>
                  {(m.margin * 100).toFixed(1)}%
                </p>
              </div>
            </section>

            {/* Donuts */}
            <section aria-labelledby="finance-categories-title" className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4 sm:p-5">
              <SectionTitle id="finance-categories-title" title="Despesas por categoria" />
              {m.byCategory.length === 0 ? (
                <Empty title="Sem despesas neste período" />
              ) : (
                <>
                  <DonutChart size="sm" centerLabel="Total" centerValue={formatMoneyWhole(m.expenseTotal)} slices={m.byCategory.map((c, i) => ({ ...c, color: shade("foreground", i) }))} />
                  <div className="flex flex-col gap-1.5">
                    {m.byCategory.map((c, i) => (
                      <BreakdownRow key={c.name} color={shade("foreground", i)} label={c.name} value={formatMoneyWhole(c.value)} />
                    ))}
                  </div>
                </>
              )}
            </section>

            <section aria-labelledby="finance-methods-title" className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4 sm:p-5">
              <SectionTitle id="finance-methods-title" title="Receita por forma de pagamento" />
              {m.byMethod.length === 0 ? (
                <Empty title="Sem pagamentos registrados" />
              ) : (
                <>
                  <DonutChart size="sm" centerLabel="Recebido" centerValue={formatMoneyWhole(m.byMethod.reduce((s, x) => s + x.value, 0))} slices={m.byMethod.map((x, i) => ({ name: x.label, value: x.value, color: shade("accent", i) }))} />
                  <div className="flex flex-col gap-1.5">
                    {m.byMethod.map((x, i) => (
                      <BreakdownRow key={x.method} color={shade("accent", i)} label={x.label} value={formatMoneyWhole(x.value)} />
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          <details className="group/detail overflow-hidden rounded-[14px] border border-border bg-card">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ToneChip icon={Layers} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Composição detalhada</span>
                <span className="block text-xs font-normal text-muted-foreground">Serviços, produtos, comissões, lucro bruto e contas em aberto</span>
              </span>
              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/detail:rotate-180" />
            </summary>
            <div className="grid grid-cols-2 gap-3 border-t border-border p-4 sm:grid-cols-4">
              <Tile tone="accent" icon={Scissors} label="Receita serviços" value={formatMoneyWhole(m.serviceRevenue)} />
              <Tile tone="accent" icon={Package} label="Receita produtos" value={formatMoneyWhole(m.productRevenue)} />
              <Tile tone="neutral" icon={HandCoins} label="Comissões" value={formatMoneyWhole(m.commissions)} />
              <Tile tone="accent" icon={PiggyBank} label="Lucro bruto" value={formatMoneyWhole(m.grossProfit)} />
              <Tile tone="neutral" icon={CalendarClock} label="Reservas futuras" value={formatMoneyWhole(m.forecast)} />
              <Tile tone="warning" icon={ArrowDownCircle} label="A receber" value={formatMoneyWhole(m.receivable)} />
              <Tile tone="danger" icon={ArrowUpCircle} label="A pagar" value={formatMoneyWhole(m.payable)} />
              <Tile tone={m.margin >= 0 ? "success" : "danger"} icon={Percent} label="Margem líquida" value={`${(m.margin * 100).toFixed(0)}%`} />
            </div>
          </details>
        </div>
      </FoldSection>
    </div>
  );
}

/* ── bits ── */
type IconType = React.ComponentType<{ className?: string }>;

function Tile({ tone, icon, label, value }: { tone: Tone; icon: IconType; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-card p-3.5">
      <span className="mb-2"><ToneChip icon={icon} tone={tone} size="md" /></span>
      <p className="truncate text-lg font-semibold leading-tight tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function PendingLink({ href, icon, title, detail }: { href: string; icon: IconType; title: string; detail: string }) {
  return (
    <Link href={href} className="group flex min-h-14 items-center gap-3 rounded-xl border border-border-strong bg-card px-3.5 py-2.5 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <ToneChip icon={icon} tone="warning" size="md" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
      <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function DreRow({ label, value, muted, strong, divider, tone }: { label: string; value: string; muted?: boolean; strong?: boolean; divider?: boolean; tone?: string }) {
  return (
    <div className={cn("flex min-h-[38px] items-center justify-between gap-3", divider && "mt-1 border-t border-border pt-1.5", muted && "text-muted-foreground", strong && "font-semibold")}>
      <span className="min-w-0">{label}</span>
      <span className={cn("whitespace-nowrap tabular-nums", tone)}>{value}</span>
    </div>
  );
}

function BreakdownRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={label}>{label}</span>
      <span className="shrink-0 whitespace-nowrap font-medium tabular-nums">{value}</span>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-[3px]", swatch)} />
      {label}
    </span>
  );
}

function Empty({ title }: { title: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{title}</div>;
}
