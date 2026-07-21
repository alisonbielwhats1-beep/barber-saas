import { getTenantContext } from "@/lib/tenant";
import { getDashboardMetrics, RANGE_LABELS, type RangeKey } from "@/lib/dashboard";
import { getFinanceMetrics } from "@/lib/finance";
import { formatMoney, formatDuration } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, TrendingDown, FileBarChart } from "lucide-react";
import { RangeFilter } from "../dashboard/range-filter";
import { ReportActions, type ReportSection } from "./report-actions";

const VALID: RangeKey[] = ["today", "yesterday", "7d", "15d", "30d", "90d", "year"];

export default async function RelatoriosPage({ searchParams }: { searchParams: { range?: string } }) {
  const { salonId } = await getTenantContext();
  const range: RangeKey = VALID.includes(searchParams.range as RangeKey) ? (searchParams.range as RangeKey) : "30d";

  const [m, fin] = await Promise.all([
    getDashboardMetrics(salonId, range),
    getFinanceMetrics(salonId, range),
  ]);

  const periodLabel = `${format(m.period.from, "d MMM", { locale: ptBR })} – ${format(m.period.to, "d MMM yyyy", { locale: ptBR })}`;

  // Seções exportáveis (CSV)
  const sections: ReportSection[] = [
    {
      title: "Resumo",
      headers: ["Indicador", "Valor"],
      rows: [
        ["Receita", (m.revenue.value / 100).toFixed(2)],
        ["Despesas", (fin.expenseTotal / 100).toFixed(2)],
        ["Lucro líquido", (fin.netProfit / 100).toFixed(2)],
        ["Atendimentos", m.appointments.value],
        ["Ticket médio", (m.avgTicket.value / 100).toFixed(2)],
        ["Ocupação (%)", Math.round(m.occupancy.rate * 100)],
      ],
    },
    {
      title: "Serviços mais vendidos",
      headers: ["Serviço", "Qtd", "Receita"],
      rows: m.topServices.map((s) => [s.name, s.count, (s.revenueCents / 100).toFixed(2)]),
    },
    {
      title: "Performance da equipe",
      headers: ["Profissional", "Atendimentos", "Receita", "Comissão"],
      rows: m.proPerf.map((p) => [p.name, p.appointments, (p.revenueCents / 100).toFixed(2), (p.commissionCents / 100).toFixed(2)]),
    },
    {
      title: "Receita por forma de pagamento",
      headers: ["Forma", "Valor"],
      rows: fin.byMethod.map((x) => [x.label, (x.value / 100).toFixed(2)]),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <FileBarChart className="h-3 w-3" /> {RANGE_LABELS[range]}
            </span>
            <span className="text-[11px] text-muted-foreground">{periodLabel}</span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">Relatórios</h1>
        </div>
        <div className="flex items-center gap-3">
          <RangeFilter current={range} />
          <ReportActions sections={sections} filename={`relatorio-${range}`} />
        </div>
      </header>

      {/* Comparativo com período anterior */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Compare label="Receita" value={formatMoney(m.revenue.value)} change={m.revenue.change} />
        <Compare label="Atendimentos" value={m.appointments.value.toString()} change={m.appointments.change} />
        <Compare label="Ticket médio" value={formatMoney(m.avgTicket.value)} change={m.avgTicket.change} />
        <Compare label="Lucro líquido" value={formatMoney(fin.netProfit)} />
      </section>

      {/* Resumo financeiro */}
      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Mini label="Receita serviços" value={formatMoney(fin.serviceRevenue)} />
        <Mini label="Receita produtos" value={formatMoney(fin.productRevenue)} />
        <Mini label="Despesas" value={formatMoney(fin.expenseTotal)} />
        <Mini label="Comissões" value={formatMoney(fin.commissions)} />
        <Mini label="Ocupação" value={`${Math.round(m.occupancy.rate * 100)}%`} />
        <Mini label="Tempo médio" value={formatDuration(m.avgDuration || 0)} />
      </section>

      {/* Tabelas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="Serviços mais vendidos" headers={["Serviço", "Qtd", "Receita"]}
          rows={m.topServices.map((s) => [s.name, s.count.toString(), formatMoney(s.revenueCents)])}
          empty="Sem dados no período" />
        <Table title="Performance da equipe" headers={["Profissional", "Atend.", "Receita", "Comissão"]}
          rows={m.proPerf.map((p) => [p.name, p.appointments.toString(), formatMoney(p.revenueCents), formatMoney(p.commissionCents)])}
          empty="Sem atendimentos concluídos" />
        <Table title="Receita por forma de pagamento" headers={["Forma", "Valor"]}
          rows={fin.byMethod.map((x) => [x.label, formatMoney(x.value)])}
          empty="Sem pagamentos registrados" />
        <Table title="Receita por gênero" headers={["Público", "Atend.", "Receita"]}
          rows={[
            ["Masculino", m.gender.male.count.toString(), formatMoney(m.gender.male.revenue)],
            ["Feminino", m.gender.female.count.toString(), formatMoney(m.gender.female.revenue)],
          ]}
          empty="Sem dados" />
      </div>
    </div>
  );
}

function Compare({ label, value, change }: { label: string; value: string; change?: number | null }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {change != null ? (
        <span className={`mt-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${change >= 0 ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
          {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {Math.abs(change * 100).toFixed(0)}% vs período anterior
        </span>
      ) : (
        <span className="mt-1.5 block text-[11px] text-muted-foreground">no período</span>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-lg font-semibold tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Table({ title, headers, rows, empty }: { title: string; headers: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3 text-[13px] font-semibold">{title}</div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                {headers.map((h, i) => (
                  <th key={h} className={`px-5 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/50 last:border-0">
                  {r.map((cell, ci) => (
                    <td key={ci} className={`px-5 py-2.5 ${ci === 0 ? "font-medium" : "text-right"}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
