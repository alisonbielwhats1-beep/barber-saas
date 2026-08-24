import Link from "next/link";
import { requireRole, FINANCE_ROLES } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getFinanceMetrics } from "@/lib/finance";
import { RANGE_LABELS, type RangeKey } from "@/lib/dashboard";
import { formatPeriodLabel } from "@/lib/time";
import { formatMoney } from "@/lib/utils";
import {
  Wallet,
  TrendingDown,
  PiggyBank,
  Percent,
  Scissors,
  Package,
  HandCoins,
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  Activity,
  CreditCard,
  Layers,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { RangeFilter } from "../dashboard/range-filter";
import { DonutChart } from "../dashboard/donut-chart";
import { CashflowChart } from "./cashflow-chart";
import { ExpenseManager, type ExpenseRow } from "./expense-manager";
import { AutoRefresh } from "@/components/auto-refresh";

const VALID: RangeKey[] = ["today", "yesterday", "7d", "15d", "30d", "90d", "year"];

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  // Financeiro do salão inteiro: só dono/gerente. Profissional e recepcionista
  // são redirecionados — antes bastava abrir a URL para ver o DRE completo.
  const ctx = await requireRole(FINANCE_ROLES);
  const { salonId } = ctx;
  const { range: selectedRange } = await searchParams;
  const range: RangeKey = VALID.includes(selectedRange as RangeKey)
    ? (selectedRange as RangeKey)
    : "30d";

  const { m, expenseRows, timezone } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true },
    });
    if (!salon) throw new Error("Estabelecimento não encontrado");
    const m = await getFinanceMetrics(tx, salonId, range, salon.timezone);
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
    return { m, expenseRows, timezone: salon.timezone };
  });
  const received = m.byMethod.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={120_000} />
      {/* Header */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Wallet className="h-3 w-3" />
              {RANGE_LABELS[range]}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {formatPeriodLabel(m.period.from, m.period.to, timezone)}
            </span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">Financeiro</h1>
        </div>
        <RangeFilter current={range} />
      </header>

      {/* Posição financeira: uma leitura curta antes do detalhamento. */}
      <section aria-labelledby="finance-position-title" className="space-y-3">
        <div>
          <h2 id="finance-position-title" className="text-[15px] font-semibold">Posição do período</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Recebido é pagamento registrado; realizado considera atendimentos concluídos; a receber são reservas futuras ativas.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Hero featured accent="#2ECC8B" icon={Wallet} label="Recebido" value={formatMoney(received)} hint={`${formatMoney(m.revenue)} realizado · ${m.byMethod.length} formas`} />
          <Hero accent="#3B9EFF" icon={ArrowDownCircle} label="A receber" value={formatMoney(m.receivable)} hint="Agendamentos futuros ativos" />
          <Hero accent="#EF4444" icon={TrendingDown} label="Despesas" value={formatMoney(m.expenseTotal)} hint={`${formatMoney(m.expenseFixed)} fixas · ${formatMoney(m.expenseVar)} variáveis`} />
          <Hero accent={m.netProfit >= 0 ? "#2ECC8B" : "#EF4444"} icon={PiggyBank} label="Resultado líquido" value={formatMoney(m.netProfit)} hint={`Margem líquida ${(m.margin * 100).toFixed(0)}%`} />
        </div>
      </section>

      {(m.receivable > 0 || m.payable > 0) && (
        <section aria-labelledby="finance-pending-title" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 id="finance-pending-title" className="text-[13px] font-semibold">Pendências que pedem ação</h2>
              <p className="text-[11px] text-muted-foreground">Acompanhe o que ainda pode virar caixa ou sair do caixa.</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {m.receivable > 0 && (
              <Link href="/agenda" className="group flex min-h-11 items-center gap-3 rounded-xl border border-info/25 bg-info/5 px-3.5 py-3 transition-colors hover:border-info/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ArrowDownCircle className="h-4 w-4 shrink-0 text-info" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium">Reservas a receber</span>
                  <span className="block text-[11px] text-muted-foreground">{formatMoney(m.receivable)} em agendamentos futuros</span>
                </span>
                <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
            {m.payable > 0 && (
              <Link href="#despesas" className="group flex min-h-11 items-center gap-3 rounded-xl border border-warning/25 bg-warning/5 px-3.5 py-3 transition-colors hover:border-warning/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ArrowUpCircle className="h-4 w-4 shrink-0 text-warning" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium">Despesas pendentes</span>
                  <span className="block text-[11px] text-muted-foreground">{formatMoney(m.payable)} ainda não marcadas como pagas</span>
                </span>
                <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Fluxo de caixa + DRE */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelTitle icon={Activity}>Fluxo de caixa</PanelTitle>
          <div className="mt-4 h-64">
            <CashflowChart data={m.cashflow} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <Legend color="#2ECC8B" label="Entradas" />
            <Legend color="#EF4444" label="Saídas" />
            <Legend color="#3B9EFF" label="Saldo" />
          </div>
        </Panel>

        {/* DRE simplificada */}
        <Panel>
          <PanelTitle icon={Layers}>DRE simplificada</PanelTitle>
          <div className="mt-4 space-y-0.5 text-[13px]">
            <DreRow label="Receita bruta" value={formatMoney(m.revenue)} strong />
            <DreRow label="(−) Comissões" value={`- ${formatMoney(m.commissions)}`} muted />
            <DreRow label="= Lucro bruto" value={formatMoney(m.grossProfit)} divider />
            <DreRow label="(−) Despesas fixas" value={`- ${formatMoney(m.expenseFixed)}`} muted />
            <DreRow label="(−) Despesas variáveis" value={`- ${formatMoney(m.expenseVar)}`} muted />
            <DreRow label="= Lucro líquido" value={formatMoney(m.netProfit)} divider strong accent={m.netProfit >= 0 ? "#2ECC8B" : "#EF4444"} />
          </div>
          <div className="mt-4 rounded-xl bg-surface-1 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Margem líquida</p>
            <p className="mt-0.5 text-lg font-semibold" style={{ color: m.margin >= 0 ? "#2ECC8B" : "#EF4444" }}>
              {(m.margin * 100).toFixed(1)}%
            </p>
          </div>
        </Panel>
      </section>

      {/* Donuts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelTitle icon={Building2}>Despesas por categoria</PanelTitle>
          {m.byCategory.length === 0 ? (
            <Empty title="Sem despesas neste período" />
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-1/2">
                <DonutChart centerLabel="Total" centerValue={formatMoney(m.expenseTotal)} slices={m.byCategory} />
              </div>
              <div className="flex-1 space-y-1.5">
                {m.byCategory.map((c) => (
                  <BreakdownRow key={c.name} color={c.color} label={c.name} value={formatMoney(c.value)} />
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelTitle icon={CreditCard}>Receita por forma de pagamento</PanelTitle>
          {m.byMethod.length === 0 ? (
            <Empty title="Sem pagamentos registrados" />
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-1/2">
                <DonutChart centerLabel="Recebido" centerValue={formatMoney(m.byMethod.reduce((s, x) => s + x.value, 0))} slices={m.byMethod.map((x) => ({ name: x.label, value: x.value, color: x.color }))} />
              </div>
              <div className="flex-1 space-y-1.5">
                {m.byMethod.map((x) => (
                  <BreakdownRow key={x.method} color={x.color} label={x.label} value={formatMoney(x.value)} />
                ))}
              </div>
            </div>
          )}
        </Panel>
      </section>

      <details className="group overflow-hidden rounded-2xl border border-border bg-card">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Layers aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">Composição detalhada</span>
            <span className="block text-[12px] text-muted-foreground">Serviços, produtos, comissões, lucro bruto e contas em aberto</span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid grid-cols-2 gap-3 border-t border-border p-4 sm:grid-cols-3 xl:grid-cols-6">
          <Tile accent="#2ECC8B" icon={Scissors} label="Receita serviços" value={formatMoney(m.serviceRevenue)} />
          <Tile accent="#2ECC8B" icon={Package} label="Receita produtos" value={formatMoney(m.productRevenue)} />
          <Tile accent="#F59E0B" icon={HandCoins} label="Comissões" value={formatMoney(m.commissions)} />
          <Tile accent="#3B9EFF" icon={PiggyBank} label="Lucro bruto" value={formatMoney(m.grossProfit)} />
          <Tile accent="#2ECC8B" icon={ArrowDownCircle} label="A receber" value={formatMoney(m.receivable)} />
          <Tile accent="#EF4444" icon={ArrowUpCircle} label="A pagar" value={formatMoney(m.payable)} />
          <Tile accent="#A855F7" icon={Percent} label="Margem líquida" value={`${(m.margin * 100).toFixed(0)}%`} />
        </div>
      </details>

      {/* Gestão de despesas */}
      <section id="despesas" className="scroll-mt-24">
        <ExpenseManager expenses={expenseRows} />
      </section>
    </div>
  );
}

/* ── bits ── */
type IconType = React.ComponentType<{ className?: string }>;

function Hero({ accent, icon: Icon, label, value, hint, featured = false }: { accent: string; icon: IconType; label: string; value: string; hint?: string; featured?: boolean }) {
  const isNegativeResult = label === "Resultado líquido" && accent.toUpperCase() === "#EF4444";
  const iconTone = featured
    ? "bg-primary/10 text-primary"
    : label === "Resultado líquido"
      ? isNegativeResult
        ? "bg-danger/10 text-danger"
        : "bg-success/10 text-success"
      : "bg-muted text-muted-foreground";

  return (
    <div className={`card-interactive rounded-2xl border bg-card p-5 ${featured ? "border-primary/30" : "border-border"}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${iconTone}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-[26px] font-semibold leading-none tracking-tight">{value}</p>
      {hint && <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Tile({ accent, icon: Icon, label, value }: { accent: string; icon: IconType; label: string; value: string }) {
  return (
    <div className="card-interactive rounded-xl border border-border bg-card p-4">
      <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-lg font-semibold tracking-tight">{value}</p>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-card p-5 ${className}`}>{children}</div>;
}

function PanelTitle({ icon: Icon, children }: { icon: IconType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-[13px] font-semibold">{children}</h3>
    </div>
  );
}

function DreRow({ label, value, muted, strong, divider, accent }: { label: string; value: string; muted?: boolean; strong?: boolean; divider?: boolean; accent?: string }) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${divider ? "mt-1 border-t border-border pt-2.5" : ""}`}>
      <span className={muted ? "text-muted-foreground" : strong ? "font-medium" : ""}>{label}</span>
      <span className={strong ? "font-semibold" : ""} style={accent ? { color: accent } : undefined}>{value}</span>
    </div>
  );
}

function BreakdownRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 font-medium">{value}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Empty({ title }: { title: string }) {
  return <div className="py-10 text-center text-[13px] text-muted-foreground">{title}</div>;
}
