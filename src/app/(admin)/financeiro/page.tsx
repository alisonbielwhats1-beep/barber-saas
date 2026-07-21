import { getTenantContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { getFinanceMetrics } from "@/lib/finance";
import { RANGE_LABELS, type RangeKey } from "@/lib/dashboard";
import { formatMoney } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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
} from "lucide-react";
import { RangeFilter } from "../dashboard/range-filter";
import { DonutChart } from "../dashboard/donut-chart";
import { CashflowChart } from "./cashflow-chart";
import { ExpenseManager, type ExpenseRow } from "./expense-manager";

const VALID: RangeKey[] = ["today", "yesterday", "7d", "15d", "30d", "90d", "year"];

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const { salonId } = await getTenantContext();
  const range: RangeKey = VALID.includes(searchParams.range as RangeKey)
    ? (searchParams.range as RangeKey)
    : "30d";

  const m = await getFinanceMetrics(salonId, range);

  const expenseRows = (
    await prisma.expense.findMany({
      where: { salonId, dueDate: { gte: m.period.from, lte: m.period.to } },
      select: { id: true, description: true, category: true, kind: true, amountCents: true, dueDate: true, paidAt: true },
      orderBy: { dueDate: "desc" },
    })
  ).map((e) => ({
    id: e.id,
    description: e.description,
    category: e.category,
    kind: e.kind,
    amountCents: e.amountCents,
    dueDate: e.dueDate.toISOString(),
    paidAt: e.paidAt ? e.paidAt.toISOString() : null,
  })) as ExpenseRow[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Wallet className="h-3 w-3" />
              {RANGE_LABELS[range]}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {format(m.period.from, "d MMM", { locale: ptBR })} – {format(m.period.to, "d MMM yyyy", { locale: ptBR })}
            </span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">Financeiro</h1>
        </div>
        <RangeFilter current={range} />
      </header>

      {/* Hero KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Hero accent="#2ECC8B" icon={Wallet} label="Receita" value={formatMoney(m.revenue)} hint={`${formatMoney(m.serviceRevenue)} serviços · ${formatMoney(m.productRevenue)} produtos`} />
        <Hero accent="#EF4444" icon={TrendingDown} label="Despesas" value={formatMoney(m.expenseTotal)} hint={`${formatMoney(m.expenseFixed)} fixas · ${formatMoney(m.expenseVar)} variáveis`} />
        <Hero accent="#3B9EFF" icon={PiggyBank} label="Lucro líquido" value={formatMoney(m.netProfit)} hint="Após comissões e despesas" />
        <Hero accent="#A855F7" icon={Percent} label="Margem líquida" value={`${(m.margin * 100).toFixed(0)}%`} hint="Lucro ÷ receita" />
      </section>

      {/* Tiles */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile accent="#2ECC8B" icon={Scissors} label="Receita serviços" value={formatMoney(m.serviceRevenue)} />
        <Tile accent="#2ECC8B" icon={Package} label="Receita produtos" value={formatMoney(m.productRevenue)} />
        <Tile accent="#F59E0B" icon={HandCoins} label="Comissões" value={formatMoney(m.commissions)} />
        <Tile accent="#3B9EFF" icon={PiggyBank} label="Lucro bruto" value={formatMoney(m.grossProfit)} />
        <Tile accent="#2ECC8B" icon={ArrowDownCircle} label="A receber" value={formatMoney(m.receivable)} />
        <Tile accent="#EF4444" icon={ArrowUpCircle} label="A pagar" value={formatMoney(m.payable)} />
      </section>

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

      {/* Gestão de despesas */}
      <ExpenseManager expenses={expenseRows} />
    </div>
  );
}

/* ── bits ── */
type IconType = React.ComponentType<{ className?: string }>;

function Hero({ accent, icon: Icon, label, value, hint }: { accent: string; icon: IconType; label: string; value: string; hint?: string }) {
  return (
    <div className="card-interactive glass relative overflow-hidden rounded-2xl p-5">
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl" style={{ background: accent }} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}>
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
