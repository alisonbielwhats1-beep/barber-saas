import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {format(period.from, "MMM yyyy")} · comparação vs. mês anterior
          </p>
        </div>
        <Badge variant="outline">Atualizado agora</Badge>
      </header>

      {/* KPIs */}
      <section className="grid gap-4 md:grid-cols-4">
        <Kpi
          icon={TrendingUp}
          label="Faturamento no mês"
          value={formatMoney(rev.revenue.value)}
          hint={`${rev.appointments.value} atendimentos concluídos`}
          change={rev.revenue.change}
        />
        <Kpi
          icon={Percent}
          label="Taxa de ocupação"
          value={`${Math.round(occ.rate * 100)}%`}
          hint={`${Math.round(occ.bookedMinutes / 60)}h de ${Math.round(
            occ.availableMinutes / 60,
          )}h disponíveis`}
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
          hint="na equipe hoje"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display">Faturamento diário</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <RevenueChart data={series} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display">Serviços top do mês</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados neste mês.</p>
            ) : (
              topServices.map((s) => (
                <div key={s.serviceId} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: s.colorHex ?? "hsl(var(--primary))" }}
                    />
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.count} atendimentos</p>
                    </div>
                  </div>
                  <p className="text-sm font-medium">{formatMoney(s.revenueCents)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Performance da equipe</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-3">Profissional</th>
                  <th className="pb-3">Atendimentos</th>
                  <th className="pb-3">Faturamento</th>
                  <th className="pb-3">Comissão estimada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {proPerf.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted-foreground">
                      Sem atendimentos concluídos.
                    </td>
                  </tr>
                ) : (
                  proPerf.map((p) => (
                    <tr key={p.professionalId}>
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: p.colorHex ?? "hsl(var(--primary))" }}
                          />
                          {p.name}
                        </div>
                      </td>
                      <td className="py-3">{p.appointments}</td>
                      <td className="py-3">{formatMoney(p.revenueCents)}</td>
                      <td className="py-3">{formatMoney(p.commissionCents)}</td>
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
    <Card>
      <CardContent className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <p className="font-display text-3xl">{value}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{hint}</span>
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
        up
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-destructive/10 text-destructive"
      }`}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {pct.toFixed(0)}%
    </span>
  );
}
