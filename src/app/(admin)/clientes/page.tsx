import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getClientList } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { Users, Crown, Cake, Clock, ChartPie, ChevronDown, type LucideIcon } from "lucide-react";
import { ReturnOpportunities } from "./return-opportunities";
import { ClientsCrm, type ClientSegment } from "./clients-crm";
import { getMarketingSettings } from "@/lib/marketing-settings";
import { hiddenClientIds } from "@/lib/client-list-visibility";
import { AutoRefresh } from "@/components/auto-refresh";

const CLIENT_SEGMENTS = new Set<ClientSegment>(["all", "vip", "birthday", "lapsed", "recurring"]);

export default async function ClientesPage({ searchParams }: { searchParams: Promise<{ status?: string; segment?: string }> }) {
  const ctx = await getTenantContext();
  const { salonId, role } = ctx;
  const params = await searchParams;
  const showExcluded = role === "OWNER" && params.status === "excluded";
  const initialSegment = CLIENT_SEGMENTS.has(params.segment as ClientSegment)
    ? (params.segment as ClientSegment)
    : "all";
  const { clients, salon, marketingSettings } = await withTenant(ctx, async (tx) => {
    const marketingSettings = await getMarketingSettings(tx, salonId);
    const professional = role === "PROFESSIONAL"
      ? await tx.professional.findFirst({
          where: { salonId, userId: ctx.userId, active: true },
          select: { id: true },
        })
      : null;
    const allClients = role === "PROFESSIONAL" && !professional
      ? []
      : await getClientList(tx, salonId, {
          professionalId: professional?.id,
          includeCommercialData: role !== "PROFESSIONAL",
          lapsedClientDays: marketingSettings.lapsedClientDays,
        });
    const hiddenIds = await hiddenClientIds(tx, salonId);
    const clients = allClients.filter(client => hiddenIds.has(client.id) === showExcluded);
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: { name: true, timezone: true },
    });
    return { clients, salon, marketingSettings };
  });

  const vip = clients.filter((c) => c.isVip).length;
  const birthday = clients.filter((c) => c.birthdayThisMonth).length;
  const lapsed = clients.filter((c) => c.isLapsed).length;
  const totalLtv = clients.reduce((s, c) => s + c.totalSpent, 0);

  // The page's top element is the directory itself (no wrapper), so its sticky search spans the whole page.
  return (
    <>
      <AutoRefresh intervalMs={15_000} />
      <ClientsCrm
        key={`${showExcluded ? "excluded" : "active"}-${initialSegment}`}
        clients={clients}
        salonName={salon?.name ?? "nosso salão"}
        timezone={salon?.timezone ?? "America/Sao_Paulo"}
        canManage={role !== "PROFESSIONAL"}
        canDelete={role === "OWNER"}
        showExcluded={showExcluded}
        lapsedClientDays={marketingSettings.lapsedClientDays}
        initialSegment={initialSegment}
        indicators={
          <ClientIndicators
            kpis={[
              { icon: Users, tone: "selection", label: "Base de clientes", value: clients.length.toString(), hint: `${wholeMoney(totalLtv)} em LTV` },
              { icon: Crown, tone: "selection", label: "Clientes VIP", value: vip.toString() },
              { icon: Cake, tone: "neutral", label: "Aniversariantes do mês", value: birthday.toString() },
              { icon: Clock, tone: "warning", label: `Sumidos (${marketingSettings.lapsedClientDays}d+)`, value: lapsed.toString() },
            ]}
            summary={`${clients.length} ${clients.length === 1 ? "cliente" : "clientes"} · ${vip} VIP · ${lapsed} ${lapsed === 1 ? "sumido" : "sumidos"}`}
          />
        }
        returnOpportunities={!showExcluded && ["OWNER", "MANAGER"].includes(role) ? <ReturnOpportunities /> : null}
      />
    </>
  );
}

/** Indicators show whole reais, as in the prototype (lists of visits keep the cents). */
function wholeMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
}

type KpiTone = "selection" | "neutral" | "warning";
type Kpi = { icon: LucideIcon; tone: KpiTone; label: string; value: string; hint?: string };
const KPI_TONES: Record<KpiTone, string> = {
  selection: "bg-[hsl(var(--selection))] text-[hsl(var(--selection-foreground))]",
  neutral: "bg-muted text-muted-foreground",
  warning: "bg-warning/15 text-warning",
};

/** Computer: one card split in four. Phone and tablet: a collapsed card that opens the four indicators. */
function ClientIndicators({ kpis, summary }: { kpis: Kpi[]; summary: string }) {
  // One wrapper element (not a fragment): a server component's fragment reaches the client list as an unkeyed array.
  return (
    <div>
      <div role="group" aria-label="Indicadores da base de clientes" className="hidden rounded-[14px] border border-border bg-card lg:grid lg:grid-cols-4">
        {kpis.map((kpi, index) => (
          <div key={kpi.label} className={cn("flex min-w-0 flex-col gap-0.5 px-[18px] py-3", index > 0 && "border-l border-border")}>
            <span className="text-xs text-muted-foreground">{kpi.label}</span>
            <span className="text-lg font-semibold tabular-nums">{kpi.value}</span>
            {kpi.hint && <span className="text-xs text-muted-foreground">{kpi.hint}</span>}
          </div>
        ))}
      </div>
      <details className="group overflow-hidden rounded-[14px] border border-border bg-card lg:hidden">
        <summary className="press-row flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-3.5 py-2 hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-muted text-foreground"><ChartPie className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">Indicadores da base de clientes</span>
            <span className="block truncate text-sm text-muted-foreground">{summary}</span>
          </span>
          <ChevronDown aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid grid-cols-2 gap-2.5 px-3.5 pb-3.5">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-border bg-card p-3">
              <span className="flex min-h-[34px] items-start justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span className="min-w-0">{kpi.label}</span>
                <span aria-hidden="true" className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", KPI_TONES[kpi.tone])}><kpi.icon className="h-4 w-4" /></span>
              </span>
              <span className="text-2xl font-semibold leading-none tabular-nums">{kpi.value}</span>
              {kpi.hint && <span className="text-xs text-muted-foreground">{kpi.hint}</span>}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
