import { getTenantContext } from "@/lib/tenant";
import { getDashboardMetrics, RANGE_LABELS, type RangeKey } from "@/lib/dashboard";
import { formatMoney, formatDuration } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  PiggyBank,
  Gauge,
  Receipt,
  CalendarClock,
  CalendarX,
  UserX,
  Users,
  UserPlus,
  Repeat,
  Timer,
  Package,
  PackageX,
  Coins,
  HandCoins,
  Scissors,
  Trophy,
  User,
  UserRound,
  Sparkles,
} from "lucide-react";
import { RangeFilter } from "./range-filter";
import { RevenueChart } from "./revenue-chart";
import { DonutChart } from "./donut-chart";

const MALE_COLOR = "#3B9EFF";
const FEMALE_COLOR = "#E85D9E";

const VALID: RangeKey[] = ["today", "yesterday", "7d", "15d", "30d", "90d", "year"];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const { salonId } = await getTenantContext();
  const range: RangeKey = VALID.includes(searchParams.range as RangeKey)
    ? (searchParams.range as RangeKey)
    : "30d";

  const m = await getDashboardMetrics(salonId, range);
  const genderTotal = m.gender.male.revenue + m.gender.female.revenue;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" />
              {RANGE_LABELS[range]}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {format(m.period.from, "d MMM", { locale: ptBR })} –{" "}
              {format(m.period.to, "d MMM yyyy", { locale: ptBR })}
            </span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">Visão geral</h1>
        </div>
        <RangeFilter current={range} />
      </header>

      {/* ── Hero KPIs ──────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HeroKpi
          accent="primary"
          icon={Wallet}
          label="Faturamento"
          value={formatMoney(m.revenue.value)}
          change={m.revenue.change}
          hint={`${m.appointments.value} atendimentos`}
        />
        <HeroKpi
          accent="info"
          icon={PiggyBank}
          label="Lucro (pós-comissão)"
          value={formatMoney(m.profit.value)}
          hint={`Margem ${(m.profit.margin * 100).toFixed(0)}%`}
        />
        <HeroKpi
          accent="marketing"
          icon={Gauge}
          label="Taxa de ocupação"
          value={`${Math.round(m.occupancy.rate * 100)}%`}
          hint={`${Math.round(m.occupancy.idleMinutes / 60)}h ociosas`}
        />
        <HeroKpi
          accent="warning"
          icon={Receipt}
          label="Ticket médio"
          value={formatMoney(m.avgTicket.value)}
          change={m.avgTicket.change}
          hint={`Atendimento ~${formatDuration(m.avgDuration || 0)}`}
        />
      </section>

      {/* ── Stat tiles ─────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile accent="info" icon={Coins} label="Receita hoje" value={formatMoney(m.revenueToday)} />
        <StatTile accent="marketing" icon={TrendingUp} label="Receita prevista" value={formatMoney(m.forecast)} hint="Próximos 30 dias" />
        <StatTile accent="primary" icon={HandCoins} label="Comissão paga" value={formatMoney(m.commissionPaid)} />
        <StatTile accent="warning" icon={HandCoins} label="Comissão pendente" value={formatMoney(m.commissionPending)} />
        <StatTile accent="info" icon={CalendarClock} label="Agendados hoje" value={m.apptsToday.toString()} />
        <StatTile accent="info" icon={CalendarClock} label="Agendados amanhã" value={m.apptsTomorrow.toString()} />
        <StatTile accent="danger" icon={CalendarX} label="Cancelamentos" value={m.cancellations.toString()} />
        <StatTile accent="danger" icon={UserX} label="No-show" value={m.noShow.toString()} />
        <StatTile accent="muted" icon={Timer} label="Tempo médio" value={formatDuration(m.avgDuration || 0)} />
        <StatTile accent="primary" icon={Package} label="Produtos vendidos" value={m.products.sold.toString()} />
        <StatTile accent="warning" icon={PackageX} label="Produtos em falta" value={m.products.outOfStock.toString()} />
        <StatTile accent="info" icon={Users} label="Clientes ativos" value={m.clients.active.toString()} />
      </section>

      {/* ── Charts ─────────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelTitle icon={TrendingUp}>Faturamento diário</PanelTitle>
          <div className="mt-4 h-64">
            <RevenueChart data={m.series} />
          </div>
        </Panel>

        <Panel>
          <PanelTitle icon={UserRound}>Receita por gênero</PanelTitle>
          <DonutChart
            centerLabel="Total"
            centerValue={formatMoney(genderTotal)}
            slices={[
              { name: "Masculino", value: m.gender.male.revenue, color: MALE_COLOR },
              { name: "Feminino", value: m.gender.female.revenue, color: FEMALE_COLOR },
            ]}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <LegendRow color={MALE_COLOR} label="Masculino" value={formatMoney(m.gender.male.revenue)} />
            <LegendRow color={FEMALE_COLOR} label="Feminino" value={formatMoney(m.gender.female.revenue)} />
          </div>
        </Panel>
      </section>

      {/* ── Público masculino x feminino ───────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <GenderPanel
          icon={User}
          color={MALE_COLOR}
          title="Público masculino"
          data={m.gender.male}
          share={genderTotal > 0 ? m.gender.male.revenue / genderTotal : 0}
        />
        <GenderPanel
          icon={UserRound}
          color={FEMALE_COLOR}
          title="Público feminino"
          data={m.gender.female}
          share={genderTotal > 0 ? m.gender.female.revenue / genderTotal : 0}
        />
      </section>

      {/* ── Clientes ───────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniStat icon={Users} accent="info" label="Base total" value={m.clients.total.toString()} />
        <MiniStat icon={UserPlus} accent="primary" label="Novos no período" value={m.clients.new.toString()} />
        <MiniStat icon={Repeat} accent="marketing" label="Recorrentes" value={m.clients.returning.toString()} />
        <MiniStat icon={UserX} accent="danger" label="Sumidos (60d+)" value={m.clients.lost.toString()} />
        <MiniStat icon={TrendingUp} accent="primary" label="Retenção" value={`${Math.round(m.clients.retentionRate * 100)}%`} />
      </section>

      {/* ── Rankings ───────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelTitle icon={Scissors}>Serviços mais vendidos</PanelTitle>
          <div className="mt-4 space-y-4">
            {m.topServices.length === 0 ? (
              <Empty title="Sem dados neste período" />
            ) : (
              m.topServices.map((s, i) => {
                const max = m.topServices[0].revenueCents || 1;
                const share = Math.max(0.06, s.revenueCents / max);
                return (
                  <div key={s.serviceId}>
                    <div className="mb-1.5 flex items-center gap-3">
                      <span className="w-4 text-[11px] text-muted-foreground">{i + 1}</span>
                      <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.name}</p>
                      <p className="shrink-0 text-[13px] font-semibold">{formatMoney(s.revenueCents)}</p>
                    </div>
                    <div className="ml-7 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${share * 100}%`, background: s.colorHex ?? "hsl(var(--primary))" }}
                        />
                      </div>
                      <span className="w-8 text-right text-[11px] text-muted-foreground">{s.count}×</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Panel>

        <Panel>
          <PanelTitle icon={Trophy}>Performance da equipe</PanelTitle>
          <div className="mt-3 space-y-1">
            {m.proPerf.length === 0 ? (
              <Empty title="Sem atendimentos concluídos" />
            ) : (
              m.proPerf.map((p, i) => (
                <div
                  key={p.professionalId}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-card-hover"
                >
                  <span className="w-4 text-center text-[11px] font-medium text-muted-foreground">
                    {i + 1}
                  </span>
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-black/80"
                    style={{ background: p.colorHex ?? "hsl(var(--primary))" }}
                  >
                    {p.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {p.appointments} atend. · comissão {formatMoney(p.commissionCents)}
                    </p>
                  </div>
                  <p className="shrink-0 text-[13px] font-semibold">{formatMoney(p.revenueCents)}</p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </section>
    </div>
  );
}

/* ─────────────────────────── Building blocks ─────────────────────────── */

type Accent = "primary" | "info" | "warning" | "danger" | "marketing" | "muted";

const ACCENT: Record<Accent, { chip: string; glow: string }> = {
  primary: { chip: "bg-primary/10 text-primary", glow: "hsl(var(--primary))" },
  info: { chip: "bg-info/10 text-info", glow: "hsl(var(--info))" },
  warning: { chip: "bg-warning/10 text-warning", glow: "hsl(var(--warning))" },
  danger: { chip: "bg-danger/10 text-danger", glow: "hsl(var(--danger))" },
  marketing: { chip: "bg-marketing/10 text-marketing", glow: "hsl(var(--marketing))" },
  muted: { chip: "bg-muted text-muted-foreground", glow: "hsl(var(--muted-foreground))" },
};

type IconType = React.ComponentType<{ className?: string }>;

function HeroKpi({
  accent,
  icon: Icon,
  label,
  value,
  change,
  hint,
}: {
  accent: Accent;
  icon: IconType;
  label: string;
  value: string;
  change?: number | null;
  hint?: string;
}) {
  return (
    <div className="card-interactive animate-rise glass relative overflow-hidden rounded-2xl p-5">
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl"
        style={{ background: ACCENT[accent].glow }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${ACCENT[accent].chip}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-[28px] font-semibold leading-none tracking-tight">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {change != null && <TrendBadge change={change} />}
        {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

function StatTile({
  accent,
  icon: Icon,
  label,
  value,
  hint,
}: {
  accent: Accent;
  icon: IconType;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card-interactive rounded-xl border border-border bg-card p-4">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${ACCENT[accent].chip}`}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-xl font-semibold tracking-tight">{value}</p>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function MiniStat({
  accent,
  icon: Icon,
  label,
  value,
}: {
  accent: Accent;
  icon: IconType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ACCENT[accent].chip}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none tracking-tight">{value}</p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function TrendBadge({ change }: { change: number }) {
  const up = change >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
        up ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(change * 100).toFixed(0)}%
    </span>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-5 ${className}`}>{children}</div>
  );
}

function PanelTitle({ icon: Icon, children }: { icon: IconType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-[13px] font-semibold">{children}</h3>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-1 px-2.5 py-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0">
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
        <p className="text-[12px] font-semibold">{value}</p>
      </div>
    </div>
  );
}

function GenderPanel({
  icon: Icon,
  color,
  title,
  data,
  share,
}: {
  icon: IconType;
  color: string;
  title: string;
  data: {
    revenue: number;
    count: number;
    avgTicket: number;
    clients: number;
    newClients: number;
    topService: { name: string; count: number } | null;
  };
  share: number;
}) {
  return (
    <div className="card-interactive rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 place-items-center rounded-lg"
            style={{ background: `${color}1f`, color }}
          >
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="text-[13px] font-semibold">{title}</h3>
        </div>
        <span className="text-[12px] font-medium text-muted-foreground">
          {(share * 100).toFixed(0)}% da receita
        </span>
      </div>

      <p className="mt-4 text-2xl font-semibold tracking-tight">{formatMoney(data.revenue)}</p>

      {/* Barra de participação */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: color }} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <GenderRow label="Ticket médio" value={formatMoney(data.avgTicket)} />
        <GenderRow label="Atendimentos" value={data.count.toString()} />
        <GenderRow label="Clientes" value={data.clients.toString()} />
        <GenderRow label="Novos no período" value={data.newClients.toString()} />
      </div>

      <div className="mt-4 rounded-xl bg-surface-1 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Serviço mais usado
        </p>
        <p className="mt-0.5 text-[13px] font-medium">
          {data.topService ? `${data.topService.name} · ${data.topService.count}×` : "—"}
        </p>
      </div>
    </div>
  );
}

function GenderRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-[15px] font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function Empty({ title }: { title: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-[13px] text-muted-foreground">{title}</p>
    </div>
  );
}
