import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/tenant";
import { DASHBOARD_ROLES } from "@/lib/role-permissions";
import { getDashboardMetrics, RANGE_LABELS, type RangeKey } from "@/lib/dashboard";
import { withSalon, withTenant } from "@/lib/prisma-tenant";
import { getInitialSetup } from "@/lib/initial-setup-server";
import { SETUP_PATH, setupChecks, shouldStartSetup } from "@/lib/initial-setup";
import { cn, formatMoney, formatDuration } from "@/lib/utils";
import {
  addCalendarDays,
  dateKeyInTimeZone,
  startOfDateInTimeZone,
  formatPeriodLabel,
} from "@/lib/time";
import { buttonVariants } from "@/components/ui/button";
import {
  TrendingUp,
  Wallet,
  Coins,
  Gauge,
  Receipt,
  CalendarX,
  UserX,
  Users,
  UserPlus,
  Repeat,
  PackageX,
  HandCoins,
  User,
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
import { getMarketingSettings } from "@/lib/marketing-settings";
import { SetupGuide, PlanInterestNotice } from "@/components/setup-guide";
import { billingEnabled } from "@/lib/billing/config";
import { Opportunities } from "./opportunities";
import {
  formatMoneyHero,
  formatMoneyWhole,
  KpiCard,
  PeriodBadge,
  SectionTitle,
  SummaryRow,
  ToneChip,
  type Tone,
} from "./results-ui";

/* Gênero em tons neutros da paleta (a cor fica para situação, não para público). */
const GENDER_COLOR = {
  male: "hsl(var(--muted-foreground))",
  female: "hsl(var(--foreground))",
  other: "hsl(var(--muted-foreground) / 0.55)",
  unknown: "hsl(var(--border-strong))",
} as const;

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
  searchParams: Promise<{ range?: string; plan?: string }>;
}) {
  const ctx = await requireRole(DASHBOARD_ROLES);
  const { salonId, role } = ctx;
  // A recepção tem a operação do dia; nunca consultar métricas gerenciais
  // para depois apenas escondê-las no JSX.
  if (role === "RECEPTIONIST") redirect("/hoje");
  const setup = await withTenant(ctx, tx => getInitialSetup(tx, ctx));
  if (shouldStartSetup(setup, role)) redirect(SETUP_PATH);
  const { range: selectedRange, plan: planIntent } = await searchParams;
  const range: RangeKey = VALID.includes(selectedRange as RangeKey)
    ? (selectedRange as RangeKey)
    : "30d";

  const now = new Date();
  const { salonData, marketingSettings } = await withSalon(salonId, async (tx) => {
    const salonData = await tx.salon.findUnique({
      where: { id: salonId },
      select: { name: true, timezone: true, plan: true },
    });
    const marketingSettings = await getMarketingSettings(tx, salonId);
    return { salonData, marketingSettings };
  });
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
    getDashboardMetrics(salonId, range, timezone, marketingSettings.lapsedClientDays),
  );

  const [todayAppts] =
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
              client: { select: { name: true, phone: true } },
              service: { select: { name: true, colorHex: true } },
              professional: { select: { user: { select: { name: true } } } },
            },
          }),
        ),
      ]),
    );
  const salonName = salonData.name;
  const genderTotal = m.gender.male.revenue + m.gender.female.revenue + m.gender.other.revenue + m.gender.unknown.revenue;

  const reminders = remindersRaw.map((r) => ({
    id: r.id,
    startAt: r.startAt.toISOString(),
    clientName: r.clientName,
    clientPhone: r.clientPhone,
    serviceName: r.serviceName,
    proName: r.proName,
    salonName,
  }));

  const checks = setupChecks(setup);
  const steps = ["Definir horários", "Revisar serviços", "Configurar profissionais", "Conhecer o aplicativo do cliente"]
    .map((label, i) => ({ done: checks[i], label, href: `${SETUP_PATH}?step=${i}` }));


  const periodLabel = formatPeriodLabel(m.period.from, m.period.to, timezone);
  const count = m.appointments.value;
  const revenueHint = `${count} ${count === 1 ? "atendimento" : "atendimentos"}`;
  const marginPct = (m.profit.margin * 100).toFixed(0);
  const occupancyPct = Math.round(m.occupancy.rate * 100);
  const idleHours = Math.round(m.occupancy.idleMinutes / 60);
  const avgDuration = formatDuration(m.avgDuration || 0);
  const pctOfPeriod = (rate: number | null | undefined) => rate != null ? `${Math.round(rate * 100)}% do período` : undefined;

  const signals: SignalItem[] = [
    { icon: TrendingUp, label: "Receita prevista", value: formatMoneyWhole(m.forecast), hint: "Próximos 30 dias", tone: "accent" },
    { icon: HandCoins, label: "Comissão pendente", value: formatMoneyWhole(m.commissionPending), tone: "accent" },
    { icon: CalendarX, label: "Cancelamentos", value: m.cancellations.toString(), hint: pctOfPeriod(m.cancellationRate), tone: "neutral", alert: m.cancellations > 0 ? "warning" : undefined },
    { icon: UserX, label: "Não compareceram", value: m.noShow.toString(), hint: pctOfPeriod(m.noShowRate), tone: "neutral", alert: m.noShow > 0 ? "danger" : undefined },
    {
      icon: Hourglass,
      label: "Conversão da fila",
      value: m.waitlist.total > 0 ? `${Math.round((m.waitlist.conversionRate ?? 0) * 100)}%` : "—",
      hint: m.waitlist.total > 0 ? `${m.waitlist.fulfilled}/${m.waitlist.total} confirmados` : "Sem entradas no período",
      tone: "accent",
    },
    { icon: PackageX, label: "Produtos em falta", value: m.products.outOfStock.toString(), tone: "neutral" },
    { icon: Users, label: "Clientes ativos", value: m.clients.active.toString(), tone: "accent" },
  ];
  const base: SignalItem[] = [
    { icon: Users, label: "Base total", value: m.clients.total.toString(), tone: "neutral" },
    { icon: UserPlus, label: "Novos no período", value: m.clients.new.toString(), tone: "neutral" },
    { icon: Repeat, label: "Recorrentes", value: m.clients.returning.toString(), tone: "neutral" },
    { icon: UserX, label: `Sumidos (${marketingSettings.lapsedClientDays}d+)`, value: m.clients.lost.toString(), tone: "neutral" },
    { icon: TrendingUp, label: "Retenção", value: `${Math.round(m.clients.retentionRate * 100)}%`, tone: "neutral" },
  ];
  const genderSlices = [
    { name: "Masculino", value: m.gender.male.revenue, color: GENDER_COLOR.male },
    { name: "Feminino", value: m.gender.female.revenue, color: GENDER_COLOR.female },
    { name: "Outro", value: m.gender.other.revenue, color: GENDER_COLOR.other },
    { name: "Não informado", value: m.gender.unknown.revenue, color: GENDER_COLOR.unknown },
  ];

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <AutoRefresh />
      {/* ── Cabeçalho: título, período e trilho de períodos ─────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-lg:w-full">
          <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">Visão geral</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2">
            <PeriodBadge>{RANGE_LABELS[range]}</PeriodBadge>
            <span className="text-sm text-muted-foreground tabular-nums">{periodLabel}</span>
          </p>
        </div>
        <RangeFilter current={range} />
      </div>

      <PlanInterestNotice intent={billingEnabled() ? undefined : planIntent} currentPlan={salonData.plan} />
      <SetupGuide steps={steps} resumeHref={setup.status === "new" ? undefined : SETUP_PATH} />

      {/* ── Operação antes da análise (no celular os números do período vêm antes) ── */}
      <div className="flex flex-col gap-4 max-lg:order-2 lg:gap-5">
        {(role === "OWNER" || role === "MANAGER") && <Opportunities />}

        {/* ── Faixa Agora ─────────────────────────────────── */}
        <NowStrip
          appointments={todayAppts}
          salonName={salonName}
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
          <section aria-labelledby="reminders-title" className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="reminders-title" className="flex items-center gap-2 text-sm font-semibold">
                <Bell aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                Lembretes de amanhã
              </h2>
              <span className="inline-flex min-h-[22px] shrink-0 items-center rounded-full bg-warning/15 px-2.5 text-xs font-medium text-warning">
                {reminders.length} sem lembrete
              </span>
            </div>
            <LembretesPanel reminders={reminders} salonName={salonName} timezone={timezone} />
          </section>
        )}
      </div>

      {/* ── Indicadores do período ─────────────────────────── */}
      <section aria-label="Indicadores do período" className="max-lg:order-1">
        {/* Celular: o faturamento em destaque e os demais numa lista. */}
        <div className="flex flex-col gap-3 sm:hidden">
          <KpiCard featured icon={Wallet} label="Faturamento de serviços" value={formatMoneyHero(m.revenue.value)} full={formatMoney(m.revenue.value)} change={m.revenue.change} hint={revenueHint} />
          <div className="divide-y divide-border rounded-[14px] border border-border bg-card px-4">
            <SummaryRow label="Resultado após comissões" hint={`Margem ${marginPct}% · despesas não incluídas`} value={formatMoneyWhole(m.profit.value)} />
            <SummaryRow label="Ticket médio" hint={`Duração média ${avgDuration}`} value={formatMoneyWhole(m.avgTicket.value)} change={m.avgTicket.change} />
            <SummaryRow label="Taxa de ocupação" hint={`${idleHours}h ociosas`} value={`${occupancyPct}%`} />
          </div>
        </div>
        {/* Computador: grade de 4. */}
        <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          <KpiCard featured icon={Wallet} label="Faturamento de serviços" value={formatMoneyHero(m.revenue.value)} full={formatMoney(m.revenue.value)} change={m.revenue.change} hint={revenueHint} />
          <KpiCard icon={Coins} label="Resultado após comissões" value={formatMoneyHero(m.profit.value)} full={formatMoney(m.profit.value)} hint={`Margem após comissão ${marginPct}% · despesas não incluídas`} />
          <KpiCard icon={Gauge} label="Taxa de ocupação" value={`${occupancyPct}%`} hint={`${idleHours}h ociosas`} />
          <KpiCard icon={Receipt} label="Ticket médio" value={formatMoneyHero(m.avgTicket.value)} full={formatMoney(m.avgTicket.value)} change={m.avgTicket.change} hint={`Duração média ${avgDuration}`} />
        </div>
      </section>

      {/* ── Análise: gráfico, rankings e profundidade sob demanda ─────── */}
      <div className="flex flex-col gap-4 max-lg:order-3 lg:gap-5">
        <Panel aria-labelledby="revenue-chart-title">
          <SectionTitle id="revenue-chart-title" title="Faturamento diário" sub={periodLabel} />
          <div className="mt-4 h-44 lg:h-60">
            <RevenueChart data={m.series} />
          </div>
        </Panel>

        <section className="grid gap-4 lg:grid-cols-2">
          <Panel aria-labelledby="top-services-title">
            <SectionTitle id="top-services-title" title="Serviços por faturamento" sub="Os 5 que mais rendem no período" />
            <div className="mt-4 flex flex-col gap-3.5">
              {m.topServices.length === 0 ? (
                <Empty title="Sem dados neste período" />
              ) : (
                m.topServices.map((s, i) => {
                  const max = m.topServices[0].revenueCents || 1;
                  const share = Math.max(0.06, s.revenueCents / max);
                  return (
                    <div key={s.serviceId} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-3">
                        <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={s.name}>{s.name}</p>
                        <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoneyWhole(s.revenueCents)}</p>
                      </div>
                      <div className="flex items-center gap-2 pl-7">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{s.count}×</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel aria-labelledby="team-revenue-title">
            <SectionTitle id="team-revenue-title" title="Faturamento por profissional" sub="Com a comissão estimada de cada um" />
            <div className="mt-2 flex flex-col">
              {m.proPerf.length === 0 ? (
                <Empty title="Sem atendimentos concluídos" />
              ) : (
                m.proPerf.map((p, i) => (
                  <div key={p.professionalId} className="flex min-h-12 items-center gap-3 py-1.5">
                    <span className="w-4 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <span
                      aria-hidden="true"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-black/80"
                      style={{ background: p.colorHex ?? "hsl(var(--accent))" }}
                    >
                      {p.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={p.name}>{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="whitespace-nowrap">{p.appointments} atend.</span> · <span className="whitespace-nowrap">comissão {formatMoneyWhole(p.commissionCents)}</span>
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoneyWhole(p.revenueCents)}</p>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </section>

        {/* ── Profundidade sob demanda ───────────────────────── */}
        <details className="group overflow-hidden rounded-[14px] border border-border bg-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ToneChip icon={Activity} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Análises complementares</span>
              <span className="block text-xs text-muted-foreground">
                Sinais do período, público e base de clientes
              </span>
            </span>
            <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>

          <div className="flex flex-col gap-5 border-t border-border p-4 sm:p-5">
            <section aria-labelledby="operation-signals-title" className="flex flex-col gap-3">
              <SectionTitle as="h3" id="operation-signals-title" title="Sinais do período" sub="Previsão, equipe e ocorrências para aprofundar a leitura." />
              <SignalList items={signals} />
              <div className="hidden gap-3 sm:grid sm:grid-cols-3 xl:grid-cols-4">
                {signals.map((item) => <SignalTile key={item.label} {...item} />)}
              </div>
            </section>

            <section aria-label="Público" className="grid gap-4 lg:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4 sm:p-5">
                <SectionTitle as="h3" title="Receita por gênero informado" sub="Considera apenas o cadastro. Dados não informados permanecem separados." />
                <DonutChart centerLabel="Total" centerValue={formatMoneyWhole(genderTotal)} slices={genderSlices} />
                <div className="grid grid-cols-2 gap-2">
                  {genderSlices.map((slice) => (
                    <LegendRow key={slice.name} color={slice.color} label={slice.name} value={formatMoneyWhole(slice.value)} />
                  ))}
                </div>
              </div>
              <div className="grid gap-4 lg:col-span-2 lg:grid-cols-2">
                <GenderPanel
                  title="Público masculino"
                  data={m.gender.male}
                  share={genderTotal > 0 ? m.gender.male.revenue / genderTotal : 0}
                />
                <GenderPanel
                  title="Público feminino"
                  data={m.gender.female}
                  share={genderTotal > 0 ? m.gender.female.revenue / genderTotal : 0}
                />
              </div>
            </section>

            <section aria-label="Indicadores da base de clientes">
              <SignalList items={base} />
              <div className="hidden gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-5">
                {base.map((item) => (
                  <div key={item.label} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3">
                    <ToneChip icon={item.icon} tone={item.tone} size="md" />
                    <div className="min-w-0">
                      <p className="text-lg font-semibold leading-tight tabular-nums">{item.value}</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="flex justify-end">
              <Link
                href="/relatorios"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-sm:w-full")}
              >
                Abrir relatórios
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

/* ─────────────────────────── Building blocks ─────────────────────────── */

type IconType = React.ComponentType<{ className?: string }>;
type SignalItem = { icon: IconType; label: string; value: string; hint?: string; tone: Tone; alert?: "warning" | "danger" };

const ALERT_TILE = {
  warning: "border-warning/35 bg-warning/10",
  danger: "border-danger/35 bg-danger/10",
} as const;

/** Celular: os sinais numa lista; o valor ganha a cor do alerta. */
function SignalList({ items }: { items: SignalItem[] }) {
  return (
    <div className="divide-y divide-border rounded-[14px] border border-border bg-card px-4 sm:hidden">
      {items.map((item) => (
        <SummaryRow
          key={item.label}
          label={item.label}
          hint={item.hint}
          value={item.value}
          valueClassName={item.alert === "danger" ? "text-danger" : item.alert === "warning" ? "text-warning" : undefined}
        />
      ))}
    </div>
  );
}

function SignalTile({ icon, label, value, hint, tone, alert }: SignalItem) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 rounded-xl border p-3.5", alert ? ALERT_TILE[alert] : "border-border bg-card")}>
      <span className="mb-2"><ToneChip icon={icon} tone={alert ?? tone} size="md" /></span>
      <p className="truncate text-lg font-semibold leading-tight tabular-nums">{value}</p>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

function Panel({ children, className = "", ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("min-w-0 rounded-[14px] border border-border bg-card p-4 sm:p-5", className)} {...props}>{children}</section>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[10px] bg-muted/60 px-2.5 py-2">
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="whitespace-nowrap text-sm font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function GenderPanel({
  title,
  data,
  share,
}: {
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
    <div className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <ToneChip icon={User} size="md" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {(share * 100).toFixed(0)}% da receita
        </span>
      </div>

      <p className="whitespace-nowrap text-2xl font-semibold leading-tight tracking-tight tabular-nums">{formatMoneyWhole(data.revenue)}</p>

      {/* Barra de participação */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <GenderRow label="Ticket médio" value={formatMoneyWhole(data.avgTicket)} />
        <GenderRow label="Atendimentos" value={data.count.toString()} />
        <GenderRow label="Clientes" value={data.clients.toString()} />
        <GenderRow label="Novos no período" value={data.newClients.toString()} />
      </div>

      <div className="rounded-xl border border-border-strong px-3 py-2.5">
        <p className="text-xs text-muted-foreground">Serviço mais usado</p>
        <p className="mt-0.5 text-sm font-medium">
          {data.topService ? `${data.topService.name} · ${data.topService.count}×` : "—"}
        </p>
      </div>
    </div>
  );
}

function GenderRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="whitespace-nowrap text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Empty({ title }: { title: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-muted-foreground">{title}</p>
    </div>
  );
}
