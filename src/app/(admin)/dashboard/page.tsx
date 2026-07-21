import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import {
  getRevenueByDay,
  getRevenueKpis,
  getOccupancyKpi,
  getTopServices,
  getProfessionalPerformance,
} from "@/lib/kpis";
import { getTenantContext } from "@/lib/tenant";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RevenueChart } from "./revenue-chart";
import { TrendingUp, Users, CalendarCheck, Percent, ArrowUpRight, ArrowDownRight } from "lucide-react";

export default async function DashboardPage() {
  const { salonId } = await getTenantContext();
  const period = { from: startOfMonth(new Date()), to: endOfMonth(new Date()) };

  const [rev, occ, series, topServices, proPerf] = await Promise.all([
    getRevenueKpis(salonId, period),
    getOccupancyKpi(salonId, period),
    getRevenueByDay(salonId, period.from, period.to),
    getTopServices(salonId, period.from, period.to),
    getProfessionalPerformance(salonId, period.from, period.to),
  ]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {format(period.from, "MMMM yyyy", { locale: ptBR })}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Atualizado agora
        </span>
      </header>

      {/* KPIs */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={TrendingUp}
          label="Faturamento no mês"
          value={formatMoney(rev.revenue.value)}
          hint={`${rev.appointments.value} atendimentos`}
          change={rev.revenue.change}
        />
        <Kpi
          icon={Percent}
          label="Taxa de ocupação"
          value={`${Math.round(occ.rate * 100)}%`}
          hint={`${Math.round(occ.bookedMinutes / 60)}h / ${Math.round(occ.availableMinutes / 60)}h`}
          change={occ.change}
        />
        <Kpi
          icon={CalendarCheck}
          label="Ticket médio"
          value={formatMoney(rev.avgTicket.value)}
          hint="por atendimento"
          change={rev.avgTicket.change}
        />
        <Kpi
          icon={Users}
          label="Profissionais ativos"
          value={occ.professionalCount.toString()}
          hint="na equipe"
        />
      </section>

      {/* Charts row */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Faturamento diário
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <RevenueChart data={series} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Serviços top
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {topServices.length === 0 ? (
              <EmptyHint
                title="Sem dados neste mês"
                hint="Assim que os primeiros atendimentos forem concluídos, o ranking aparece aqui."
              />
            ) : (
              topServices.map((s, i) => {
                const maxRevenue = topServices[0].revenueCents || 1;
                const share = Math.max(0.06, s.revenueCents / maxRevenue);
                return (
                  <div key={s.serviceId}>
                    <div className="mb-1.5 flex items-center gap-3">
                      <span className="w-4 text-[11px] text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{s.name}</p>
                      </div>
                      <p className="shrink-0 text-[13px] font-medium">{formatMoney(s.revenueCents)}</p>
                    </div>
                    <div className="ml-7 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${share * 100}%`,
                            background: s.colorHex ?? "hsl(var(--primary))",
                          }}
                        />
                      </div>
                      <span className="w-8 text-right text-[11px] text-muted-foreground">
                        {s.count}×
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </section>

      {/* Team performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Performance da equipe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Profissional
                  </th>
                  <th className="pb-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Atend.
                  </th>
                  <th className="pb-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Faturamento
                  </th>
                  <th className="pb-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Comissão
                  </th>
                </tr>
              </thead>
              <tbody>
                {proPerf.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8">
                      <EmptyHint
                        title="Sem atendimentos concluídos"
                        hint="Cadastre a equipe em Profissionais e compartilhe o link de agendamento — os números aparecem conforme os atendimentos forem concluídos."
                      />
                    </td>
                  </tr>
                ) : (
                  proPerf.map((p) => (
                    <tr key={p.professionalId} className="border-b border-border/50 last:border-0">
                      <td className="py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-black/80"
                            style={{ background: p.colorHex ?? "hsl(var(--primary))" }}
                          >
                            {p.name
                              .split(" ")
                              .map((n: string) => n[0])
                              .slice(0, 2)
                              .join("")}
                          </span>
                          <span className="font-medium">{p.name}</span>
                        </div>
                      </td>
                      <td className="py-3 text-muted-foreground">{p.appointments}</td>
                      <td className="py-3 font-medium">{formatMoney(p.revenueCents)}</td>
                      <td className="py-3 text-muted-foreground">{formatMoney(p.commissionCents)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyHint({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="py-2 text-center">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  change,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  change?: number | null;
}) {
  return (
    <Card className="card-glow">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/10">
            <Icon className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">{hint}</span>
          {change != null && <DeltaBadge change={change} />}
        </div>
      </CardContent>
    </Card>
  );
}

function DeltaBadge({ change }: { change: number }) {
  const up = change >= 0;
  const pct = Math.abs(change * 100);
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
        up ? "bg-emerald-500/10 text-emerald-400" : "bg-destructive/10 text-destructive"
      }`}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {pct.toFixed(0)}%
    </span>
  );
}
