import { requireRole, FINANCE_ROLES } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getDashboardMetrics, RANGE_LABELS, type RangeKey } from "@/lib/dashboard";
import { getFinanceMetrics } from "@/lib/finance";
import { cn, formatMoney, formatDuration } from "@/lib/utils";
import { formatPeriodLabel } from "@/lib/time";
import { CalendarDays, Receipt, UserPlus, Wallet } from "lucide-react";
import { RangeFilter } from "../dashboard/range-filter";
import { KpiCard, PeriodBadge } from "../dashboard/results-ui";
import { ReportActions, type ReportSection } from "./report-actions";
import { FoldSection } from "./report-section";
import { calculateRetentionMetrics } from "@/lib/operational-flows";
import { getMarketingSettings } from "@/lib/marketing-settings";
import { Opportunities } from "../dashboard/opportunities";

const VALID: RangeKey[] = ["today", "yesterday", "7d", "15d", "30d", "90d", "year"];

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  // Relatórios expõem faturamento, comissões e DRE — mesma restrição do
  // /financeiro. Ver requireRole em lib/tenant.ts.
  const ctx = await requireRole(FINANCE_ROLES);
  const { salonId } = ctx;
  const { range: selectedRange } = await searchParams;
  const range: RangeKey = VALID.includes(selectedRange as RangeKey)
    ? (selectedRange as RangeKey)
    : "30d";

  // Sequencial: são as duas funções mais pesadas do sistema (~21 queries
  // somadas). Em paralelo, competiam pela única conexão do pool (P2024).
  // getDashboardMetrics mantém as próprias waves de prisma.* cru (RLS-M6,
  // fora de escopo aqui); só a chamada a getFinanceMetrics abre transação,
  // por causa da mudança de assinatura de lib/finance.ts.
  const { timezone, marketingSettings } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true },
    });
    if (!salon) throw new Error("Estabelecimento não encontrado");
    const marketingSettings = await getMarketingSettings(tx, salonId);
    return { timezone: salon.timezone, marketingSettings };
  });
  const m = await getDashboardMetrics(salonId, range, timezone, marketingSettings.lapsedClientDays);
  const fin = await withTenant(ctx, (tx) =>
    getFinanceMetrics(tx, salonId, range, timezone),
  );
  const retentionSource = await withTenant(ctx, (tx) => tx.clientProfile.findMany({
    where: { salonId },
    select: { appointments: { where: { status: "COMPLETED" }, select: { startAt: true }, orderBy: { startAt: "desc" } } },
  }));
  const retention = calculateRetentionMetrics(
    retentionSource.map((client) => ({ visits: client.appointments.map((appointment) => appointment.startAt) })),
    new Date(),
    marketingSettings.lapsedClientDays,
  );

  const periodLabel = formatPeriodLabel(m.period.from, m.period.to, timezone);

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
        ["Retenção de clientes (%)", retention.returningClientRatePct],
        ["Intervalo médio entre visitas (dias)", retention.averageDaysBetweenVisits],
        [`Clientes inativos há ${marketingSettings.lapsedClientDays} dias ou mais`, retention.lapsedClients],
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

  const financeMinis: [string, string][] = [
    ["Receita serviços", formatMoney(fin.serviceRevenue)],
    ["Receita produtos", formatMoney(fin.productRevenue)],
    ["Despesas", formatMoney(fin.expenseTotal)],
    ["Comissões", formatMoney(fin.commissions)],
    ["Ocupação", `${Math.round(m.occupancy.rate * 100)}%`],
    ["Tempo médio", formatDuration(m.avgDuration || 0)],
  ];
  const retentionMinis: [string, string][] = [
    ["Clientes que retornaram", `${retention.returningClientRatePct}%`],
    ["Intervalo médio entre visitas", `${retention.averageDaysBetweenVisits} dias`],
    [`Clientes inativos há ${marketingSettings.lapsedClientDays}+ dias`, retention.lapsedClients.toString()],
  ];

  return (
    <div className="admin-summary-page mx-auto flex w-full max-w-7xl flex-col gap-4 lg:gap-5">
      {/* Cabeçalho: título, período, exportação e trilho de períodos */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-lg:w-full">
          <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">Relatórios</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2">
            <PeriodBadge>{RANGE_LABELS[range]}</PeriodBadge>
            <span className="text-sm text-muted-foreground tabular-nums" aria-label="Período do relatório">{periodLabel}</span>
          </p>
          <div className="mt-3"><ReportActions sections={sections} filename={`relatorio-${range}`} /></div>
        </div>
        <RangeFilter current={range} />
      </div>

      {/* Comparativo com período anterior */}
      <section aria-label="Comparativo com o período anterior" className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <KpiCard icon={Wallet} label="Faturamento" value={formatMoney(m.revenue.value)} change={m.revenue.change} hint={m.revenue.change != null ? "vs período anterior" : "no período"} />
          <KpiCard icon={CalendarDays} label="Agendamentos" value={m.appointments.value.toString()} change={m.appointments.change} hint={m.appointments.change != null ? "vs período anterior" : "no período"} />
          <KpiCard icon={Receipt} label="Ticket médio" value={formatMoney(m.avgTicket.value)} change={m.avgTicket.change} hint={m.avgTicket.change != null ? "vs período anterior" : "no período"} />
          <KpiCard icon={UserPlus} tone="neutral" label="Novos clientes" value={m.clients.new.toString()} hint="no período" />
        </div>
        <p className="text-xs text-muted-foreground">O comparativo usa o período anterior de mesmo tamanho.</p>
      </section>

      {/* Tabelas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <FoldSection id="report-services-title" title="Serviços mais vendidos" defaultOpen>
          <Table title="Serviços mais vendidos" headers={["Serviço", "Qtd", "Receita"]}
            rows={m.topServices.map((s) => [s.name, s.count.toString(), formatMoney(s.revenueCents)])}
            empty="Sem dados no período" />
        </FoldSection>
        <FoldSection id="report-team-title" title="Desempenho por profissional" sub="Comissão estimada pelo percentual de cada profissional" defaultOpen>
          <Table title="Desempenho por profissional" headers={["Profissional", "Atend.", "Receita", "Comissão"]} stack
            rows={m.proPerf.map((p) => [p.name, p.appointments.toString(), formatMoney(p.revenueCents), formatMoney(p.commissionCents)])}
            empty="Sem atendimentos concluídos" />
        </FoldSection>
      </div>

      <FoldSection id="report-finance-title" title="Resultado financeiro e operação" sub="Receitas, despesas, comissões, formas de pagamento e gênero" openOnDesktop>
        {/* Resumo financeiro */}
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-3 sm:px-5 xl:grid-cols-6">
          {financeMinis.map(([label, value]) => <Mini key={label} label={label} value={value} />)}
        </div>
        <SubTitle>Receita por forma de pagamento</SubTitle>
        <Table title="Receita por forma de pagamento" headers={["Forma", "Valor"]}
          rows={fin.byMethod.map((x) => [x.label, formatMoney(x.value)])}
          empty="Sem pagamentos registrados" />
        <SubTitle>Receita por gênero</SubTitle>
        <Table title="Receita por gênero" headers={["Público", "Atend.", "Receita"]}
          rows={[
            ["Masculino", m.gender.male.count.toString(), formatMoney(m.gender.male.revenue)],
            ["Feminino", m.gender.female.count.toString(), formatMoney(m.gender.female.revenue)],
          ]}
          empty="Sem dados" />
      </FoldSection>

      <FoldSection id="report-retention-title" title="Retenção de clientes" sub="Quem volta, em quanto tempo e quem sumiu" openOnDesktop>
        <div className="flex flex-col gap-4 px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {retentionMinis.map(([label, value]) => <Mini key={label} label={label} value={value} />)}
          </div>
          {(ctx.role === "OWNER" || ctx.role === "MANAGER") && <Opportunities />}
        </div>
      </FoldSection>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-card p-3.5">
      <p className="truncate text-lg font-semibold leading-tight tabular-nums">{value}</p>
      <p className="text-xs font-medium leading-snug text-muted-foreground">{label}</p>
    </div>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pb-2 pt-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground sm:px-5">{children}</p>;
}

/**
 * Tabela do relatório. Com `stack`, no celular cada linha vira um bloco (nome em cima e as colunas
 * numéricas embaixo, com o rótulo), para a última coluna não ficar escondida.
 */
function Table({ title, headers, rows, empty, stack = false }: { title: string; headers: string[]; rows: string[][]; empty: string; stack?: boolean }) {
  if (rows.length === 0) return <p className="px-4 py-7 text-center text-sm text-muted-foreground">{empty}</p>;
  const last = headers.length - 1;
  const edge = (i: number) => cn(i === 0 && "pl-4 sm:pl-5", i === last && "pr-4 sm:pr-5");
  return (
    <div role="region" aria-label={title} tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <table className={cn("w-full border-collapse text-sm", stack && "max-sm:block")}>
        <thead className={cn(stack && "max-sm:sr-only")}>
          <tr>
            {headers.map((h, i) => (
              <th key={h} scope="col" className={cn("whitespace-nowrap border-y border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground", i === 0 ? "text-left" : "text-right", edge(i))}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className={cn(stack && "max-sm:block")}>
          {rows.map((r, ri) => (
            <tr key={ri} className={cn("border-b border-border last:border-0", stack && "max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] max-sm:gap-x-4 max-sm:gap-y-1 max-sm:px-4 max-sm:py-2.5")}>
              {r.map((cell, ci) => (
                <td
                  key={ci}
                  data-label={headers[ci]}
                  className={cn(
                    "px-3 py-3 leading-snug",
                    ci === 0 ? "font-medium" : "whitespace-nowrap text-right tabular-nums",
                    edge(ci),
                    stack && "max-sm:block max-sm:p-0 max-sm:text-left",
                    stack && ci === 0 && "max-sm:col-span-full",
                    stack && ci > 0 && "max-sm:before:block max-sm:before:text-xs max-sm:before:font-normal max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
