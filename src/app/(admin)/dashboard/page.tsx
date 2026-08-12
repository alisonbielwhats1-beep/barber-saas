import Link from "next/link";
import { requireRole } from "@/lib/tenant";
import { DASHBOARD_ROLES } from "@/lib/role-permissions";
import { getDashboardMetrics, RANGE_LABELS, type RangeKey } from "@/lib/dashboard";
import { withSalon } from "@/lib/prisma-tenant";
import { formatMoney, formatDuration } from "@/lib/utils";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import {
  addCalendarDays,
  dateKeyInTimeZone,
  startOfDateInTimeZone,
} from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  PiggyBank,
  Gauge,
  Receipt,
  CalendarX,
  UserX,
  Users,
  UserPlus,
  Repeat,
  PackageX,
  HandCoins,
  Scissors,
  Trophy,
  User,
  UserRound,
  Sparkles,
  CheckCircle2,
  Circle,
  ArrowRight,
  Bell,
  Hourglass,
  Activity,
  ChevronDown,
} from "lucide-react";
import { RangeFilter } from "./range-filter";
import { RevenueChart } from "./revenue-chart";
import { DonutChart } from "./donut-chart";
import { LembretesPanel } from "./lembretes-panel";
import { AutoRefresh } from "@/components/auto-refresh";
import { NowStrip } from "./now-strip";

const MALE_COLOR = "#3B9EFF";
const FEMALE_COLOR = "#E85D9E";

const VALID: RangeKey[] = ["today", "yesterday", "7d", "15d", "30d", "90d", "year"];

function isTransientDatabaseError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return (
    ["P1001", "P1002", "P2024"].includes(code) ||
    /connection pool|can't reach database|timed out/i.test(message)
  );
}

async function withDatabaseRetry<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientDatabaseError(error)) throw error;
    console.warn(`[dashboard] retrying transient database operation: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return operation();
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { salonId } = await requireRole(DASHBOARD_ROLES);
  const { range: selectedRange } = await searchParams;
  const range: RangeKey = VALID.includes(selectedRange as RangeKey)
    ? (selectedRange as RangeKey)
    : "30d";

  const now = new Date();
  const salonData = await withSalon(salonId, (tx) =>
    tx.salon.findUnique({
      where: { id: salonId },
      select: { name: true, timezone: true },
    }),
  );
  if (!salonData) throw new Error("Estabelecimento não encontrado");
  const timezone = salonData.timezone;
  const todayDate = dateKeyInTimeZone(now, timezone);
  const today = {
    from: startOfDateInTimeZone(todayDate, timezone),
    to: startOfDateInTimeZone(addCalendarDays(todayDate, 1), timezone),
  };
  const tomorrow = today.to;
  const tomorrowEnd = startOfDateInTimeZone(addCalendarDays(todayDate, 2), timezone);

  // Lembretes de amanhã — $queryRaw evita erro de tipo antes do prisma generate;
  // try/catch protege caso a migration 003 ainda não tenha sido aplicada.
  type ReminderRow = {
    id: string;
    startAt: Date;
    clientName: string;
    clientPhone: string | null;
    serviceName: string;
    proName: string;
  };
  let remindersRaw: ReminderRow[] = [];
  try {
    remindersRaw = await withSalon(salonId, (tx) => tx.$queryRaw<ReminderRow[]>`
      SELECT
        a.id,
        a."startAt",
        c.name      AS "clientName",
        c.phone     AS "clientPhone",
        s.name      AS "serviceName",
        u.name      AS "proName"
      FROM "Appointment" a
      JOIN "ClientProfile" c  ON c.id = a."clientId"
      JOIN "Service"       s  ON s.id = a."serviceId"
      JOIN "Professional"  p  ON p.id = a."professionalId"
      JOIN "User"          u  ON u.id = p."userId"
      WHERE a."salonId"        = ${salonId}
        AND a."startAt"       >= ${tomorrow}
        AND a."startAt"        < ${tomorrowEnd}
        AND a.status          IN ('CONFIRMED', 'PENDING')
        AND a."reminderSentAt" IS NULL
      ORDER BY a."startAt" ASC
      LIMIT 10
    `);
  } catch {}

  // Carrega primeiro as métricas para não somar as queries auxiliares às
  // ondas concorrentes do motor do dashboard.
  const m = await withDatabaseRetry("metrics", () =>
    getDashboardMetrics(salonId, range, timezone),
  );

  const [todayAppts, svcCount, proCount] =
    await withDatabaseRetry("summary", () =>
      Promise.all([
        withSalon(salonId, (tx) =>
          tx.appointment.findMany({
            where: {
              salonId,
              startAt: { gte: today.from, lt: today.to },
              endAt: { gte: now },
              status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
            },
            orderBy: { startAt: "asc" },
            take: 5,
            select: {
              id: true,
              startAt: true,
              status: true,
              client: { select: { name: true } },
              service: { select: { name: true, colorHex: true } },
              professional: { select: { user: { select: { name: true } } } },
            },
          }),
        ),
        withSalon(salonId, (tx) => tx.service.count({ where: { salonId, active: true } })),
        withSalon(salonId, (tx) => tx.professional.count({ where: { salonId, active: true } })),
      ]),
    );
  const [whCount, apptCount] = await withDatabaseRetry("setup", () =>
    Promise.all([
      withSalon(salonId, (tx) => tx.workingHours.count({ where: { professional: { salonId } } })),
      withSalon(salonId, (tx) => tx.appointment.count({ where: { salonId } })),
    ]),
  );
  const salonName = salonData.name;
  const genderTotal = m.gender.male.revenue + m.gender.female.revenue;

  const reminders = remindersRaw.map((r) => ({
    id: r.id,
    startAt: r.startAt.toISOString(),
    clientName: r.clientName,
    clientPhone: r.clientPhone,
    serviceName: r.serviceName,
    proName: r.proName,
    salonName,
  }));

  const steps = [
    { done: svcCount > 0, label: "Criar seus serviços", href: "/servicos" },
    { done: proCount > 0, label: "Cadastrar profissionais", href: "/profissionais" },
    { done: whCount > 0, label: "Definir horários de trabalho", href: "/profissionais" },
    { done: apptCount > 0, label: "Receber o primeiro agendamento", href: "/compartilhar" },
  ];
  const setupDone = steps.every((s) => s.done);

  return (
    <div className="space-y-6">
      <AutoRefresh />
      {/* ── Header ─────────────────────────────────────────── */}
      <PageHeader
        title="Visão geral"
        meta={
          <div className="mb-1 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" />
              {RANGE_LABELS[range]}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {formatInTimeZone(m.period.from, timezone, "d MMM", { locale: ptBR })} –{" "}
              {formatInTimeZone(m.period.to, timezone, "d MMM yyyy", { locale: ptBR })}
            </span>
          </div>
        }
      >
        <RangeFilter current={range} />
      </PageHeader>

      {/* ── Checklist de onboarding — some quando completo ─── */}
      {!setupDone && (
        <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Deixe seu salão pronto para agendar</h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {steps.filter((s) => s.done).length} de {steps.length} passos concluídos
              </p>
            </div>
            <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-muted sm:block">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${(steps.filter((s) => s.done).length / steps.length) * 100}%` }}
              />
            </div>
          </div>
          <div className="stagger mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {steps.map((s) =>
              s.done ? (
                <div
                  key={s.label}
                  className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] text-muted-foreground"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                  {s.label}
                </div>
              ) : (
                <Link
                  key={s.label}
                  href={s.href}
                  className="group flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] font-medium transition-colors hover:border-primary/40"
                >
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1">{s.label}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              ),
            )}
          </div>
        </section>
      )}

      {/* ── Faixa Agora: operação antes da análise ─────────── */}
      <NowStrip
        appointments={todayAppts}
        timezone={timezone}
        todayDate={todayDate}
        now={now}
        revenueToday={m.revenueToday}
        apptsToday={m.apptsToday}
        apptsTomorrow={m.apptsTomorrow}
        outOfStock={m.products.outOfStock}
      />

      {/* ── Lembretes de amanhã ────────────────────────────── */}
      {reminders.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <PanelTitle icon={Bell}>Lembretes de amanhã</PanelTitle>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {reminders.length} sem lembrete
            </span>
          </div>
          <LembretesPanel reminders={reminders} salonName={salonName} timezone={timezone} />
        </section>
      )}

      {/* ── Hero KPIs ──────────────────────────────────────── */}
      <section className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          hint={`Duração média ${formatDuration(m.avgDuration || 0)}`}
        />
      </section>

      {/* ── Charts ─────────────────────────────────────────── */}
      <section>
        <Panel>
          <PanelTitle icon={TrendingUp}>Faturamento diário</PanelTitle>
          <div className="mt-4 h-64">
            <RevenueChart data={m.series} />
          </div>
        </Panel>
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

      {/* ── Profundidade sob demanda ───────────────────────── */}
      <details className="group overflow-hidden rounded-2xl border border-border bg-card">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Activity aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">Análises complementares</span>
            <span className="block text-[12px] text-muted-foreground">
              Sinais do período, público e base de clientes
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>

        <div className="space-y-5 border-t border-border p-4 sm:p-5">
          <section aria-labelledby="operation-signals-title" className="space-y-3">
            <div>
              <h2 id="operation-signals-title" className="text-[14px] font-semibold">Sinais do período</h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Previsão, equipe e ocorrências para aprofundar a leitura.</p>
            </div>
            <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              <StatTile icon={TrendingUp} label="Receita prevista" value={formatMoney(m.forecast)} hint="Próximos 30 dias" />
              <StatTile icon={HandCoins} label="Comissão pendente" value={formatMoney(m.commissionPending)} />
              <StatTile
                icon={CalendarX}
                label="Cancelamentos"
                value={m.cancellations.toString()}
                hint={m.cancellationRate != null ? `${Math.round(m.cancellationRate * 100)}% do período` : undefined}
                tone={m.cancellations > 0 ? "warning" : "neutral"}
              />
              <StatTile
                icon={UserX}
                label="No-show"
                value={m.noShow.toString()}
                hint={m.noShowRate != null ? `${Math.round(m.noShowRate * 100)}% do período` : undefined}
                tone={m.noShow > 0 ? "danger" : "neutral"}
              />
              <StatTile
                icon={Hourglass}
                label="Conversão da fila"
                value={m.waitlist.total > 0 ? `${Math.round((m.waitlist.conversionRate ?? 0) * 100)}%` : "—"}
                hint={m.waitlist.total > 0 ? `${m.waitlist.fulfilled}/${m.waitlist.total} confirmados` : "Sem entradas no período"}
              />
              <StatTile icon={PackageX} label="Produtos em falta" value={m.products.outOfStock.toString()} />
              <StatTile icon={Users} label="Clientes ativos" value={m.clients.active.toString()} />
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Panel className="lg:col-span-1">
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
            <div className="grid gap-4 lg:col-span-2 lg:grid-cols-2">
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
            </div>
          </section>

          <section aria-label="Indicadores da base de clientes" className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MiniStat icon={Users} label="Base total" value={m.clients.total.toString()} />
            <MiniStat icon={UserPlus} label="Novos no período" value={m.clients.new.toString()} />
            <MiniStat icon={Repeat} label="Recorrentes" value={m.clients.returning.toString()} />
            <MiniStat icon={UserX} label="Sumidos (60d+)" value={m.clients.lost.toString()} />
            <MiniStat icon={TrendingUp} label="Retenção" value={`${Math.round(m.clients.retentionRate * 100)}%`} />
          </section>

          <div className="flex justify-end">
            <Link
              href="/relatorios"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-[13px] font-medium transition-colors hover:border-border-strong hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Abrir relatórios
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </details>
    </div>
  );
}

/* ─────────────────────────── Building blocks ─────────────────────────── */

type Accent = "primary" | "info" | "warning" | "danger" | "marketing" | "muted";

/* Only the primary (revenue) KPI gets the brand color chip.
   All others use neutral so the dashboard feels calm, not noisy. */
const ACCENT: Record<Accent, { chip: string }> = {
  primary:   { chip: "bg-primary/10 text-primary" },
  info:      { chip: "bg-muted text-muted-foreground" },
  warning:   { chip: "bg-muted text-muted-foreground" },
  danger:    { chip: "bg-muted text-muted-foreground" },
  marketing: { chip: "bg-muted text-muted-foreground" },
  muted:     { chip: "bg-muted text-muted-foreground" },
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
  value: React.ReactNode;
  change?: number | null;
  hint?: string;
}) {
  return (
    <div className="card-interactive rounded-2xl border border-border bg-card p-5">
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
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: IconType;
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "warning" | "danger";
}) {
  const toneClass = tone === "danger"
    ? "border-danger/30 bg-danger/5"
    : tone === "warning"
      ? "border-warning/30 bg-warning/5"
      : "border-border bg-card";
  const iconClass = tone === "danger"
    ? "bg-danger/10 text-danger"
    : tone === "warning"
      ? "bg-warning/10 text-warning"
      : "bg-muted text-muted-foreground";
  return (
    <div className={`card-interactive min-w-0 rounded-xl border p-4 ${toneClass}`}>
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${iconClass}`}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-xl font-semibold tracking-tight">{value}</p>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: IconType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
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
    <div className={`min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5 ${className}`}>{children}</div>
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
