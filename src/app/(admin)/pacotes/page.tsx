import { featureEntitlement } from "@/lib/billing/plan-grants";
import { requireRole } from "@/lib/tenant";
import { MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { formatMoney } from "@/lib/utils";
import { Crown, Package, TrendingUp, Users, Wallet } from "lucide-react";
import { PacotesView } from "./pacotes-view";
import { canUsePlanFeature } from "@/lib/plan-entitlements";
import { PlanUpgradeAction } from "@/components/plan-upgrade-action";

export default async function PacotesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const ctx = await requireRole(MANAGEMENT_ROLES);
  const { salonId } = ctx;

  // Sequencial de propósito: pooler com connection_limit=1 em serverless —
  // 6 queries em Promise.all estouravam o timeout do pool (P2024). Rodar
  // dentro de withTenant vai além: as 6 passam a usar uma única conexão em
  // vez de 6 aquisições separadas do pool.
  const { packages, purchases, plans, subscriptions, clients, services, plan } = await withTenant(
    ctx,
    async (tx) => {
      const salon = await tx.salon.findUnique({ where: { id: salonId }, select: { plan: true } });
      const packages = await tx.package.findMany({
        where: { salonId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, description: true, serviceId: true, sessions: true,
          priceCents: true, validityDays: true, active: true,
          service: { select: { name: true } },
          _count: { select: { purchases: true } },
        },
      });
      const purchases = await tx.packagePurchase.findMany({
        where: { salonId },
        orderBy: { purchasedAt: "desc" },
        select: {
          id: true, sessionsUsed: true, sessionsTotal: true, expiresAt: true, status: true, priceCents: true,
          client: { select: { name: true } },
          package: { select: { name: true } },
        },
      });
      const plans = await tx.membershipPlan.findMany({
        where: { salonId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, description: true, priceCents: true, interval: true,
          discountPct: true, benefits: true, active: true,
          _count: { select: { subscriptions: true } },
        },
      });
      const subscriptions = await tx.clientSubscription.findMany({
        where: { salonId },
        orderBy: { startedAt: "desc" },
        select: {
          id: true, renewsAt: true, status: true,
          client: { select: { name: true } },
          plan: { select: { name: true, priceCents: true, interval: true } },
        },
      });
      const clients = await tx.clientProfile.findMany({ where: { salonId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      const services = await tx.service.findMany({ where: { salonId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      return { packages, purchases, plans, subscriptions, clients, services, plan: await featureEntitlement(tx, salonId, salon?.plan) };
    },
  );

  // KPIs
  const activePackages = purchases.filter((p) => p.status === "ACTIVE").length;
  const packageRevenue = purchases.reduce((s, p) => s + p.priceCents, 0);
  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE");
  const mrr = activeSubs.reduce(
    (s, sub) => s + (sub.plan.interval === "ANNUAL" ? Math.round(sub.plan.priceCents / 12) : sub.plan.priceCents),
    0,
  );

  const packageRows = packages.map((p) => ({
    id: p.id, name: p.name, description: p.description, serviceId: p.serviceId,
    serviceName: p.service?.name ?? null, sessions: p.sessions, priceCents: p.priceCents,
    validityDays: p.validityDays, active: p.active, soldCount: p._count.purchases,
  }));
  const purchaseRows = purchases.map((p) => ({
    id: p.id, clientName: p.client.name, packageName: p.package.name,
    sessionsUsed: p.sessionsUsed, sessionsTotal: p.sessionsTotal,
    expiresAt: p.expiresAt.toISOString(), status: p.status, priceCents: p.priceCents,
  }));
  const planRows = plans.map((p) => ({
    id: p.id, name: p.name, description: p.description, priceCents: p.priceCents,
    interval: p.interval as "MONTHLY" | "ANNUAL", discountPct: p.discountPct,
    benefits: p.benefits, active: p.active, subCount: p._count.subscriptions,
  }));
  const subRows = subscriptions.map((s) => ({
    id: s.id, clientName: s.client.name, planName: s.plan.name, interval: s.plan.interval,
    priceCents: s.plan.priceCents, renewsAt: s.renewsAt.toISOString(), status: s.status,
  }));
  const packagesEnabled = canUsePlanFeature(plan, "PACKAGES");

  return (
    <div className="flex min-w-0 flex-col gap-3.5 lg:gap-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">Pacotes e planos</h1>
        <p className="mt-1 hidden text-sm text-muted-foreground lg:block">Receita recorrente</p>
      </div>

      {!packagesEnabled && (
        <section className="flex items-start gap-3 rounded-xl border border-border-strong bg-card px-3.5 py-3 text-sm">
          <Crown aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <strong className="block font-semibold text-foreground">Pacotes e planos recorrentes ficam disponíveis nos planos pagos.</strong>
            <p className="text-muted-foreground">Consulte os dados existentes e contrate um plano pago quando quiser ativar novas ofertas.</p>
            <PlanUpgradeAction role={ctx.role} />
          </div>
        </section>
      )}

      <section aria-label="Indicadores de pacotes e planos" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Kpi icon={Package} label="Pacotes ativos" value={activePackages.toString()} />
        <Kpi icon={Wallet} label="Receita de pacotes" value={wholeMoney(packageRevenue)} full={formatMoney(packageRevenue)} />
        <Kpi icon={Users} label="Assinantes ativos" value={activeSubs.length.toString()} />
        <Kpi icon={TrendingUp} label="Receita recorrente (MRR)" value={wholeMoney(mrr)} full={formatMoney(mrr)} />
      </section>

      <PacotesView
        initialFilter={filter === "expiring" ? "expiring" : "all"}
        packages={packageRows}
        purchases={purchaseRows}
        plans={planRows}
        subscriptions={subRows}
        clients={clients}
        services={services}
        enabled={packagesEnabled}
      />
    </div>
  );
}

const WHOLE_BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
/** Indicadores sem centavos, como no restante do painel ("R$ 3.740"); o valor exato fica no title. */
function wholeMoney(cents: number) {
  return WHOLE_BRL.format(Math.round(cents / 100));
}

/** Cartão de indicador: rótulo 12 à esquerda, ícone de 28 px em lilás suave à direita e valor 24. */
function Kpi({ icon: Icon, label, value, full }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; full?: string }) {
  return (
    <div className="flex min-h-24 min-w-0 flex-col gap-1.5 rounded-[14px] border border-border bg-card p-3.5 lg:gap-2 lg:p-4">
      <div className="flex min-h-[34px] items-start justify-between gap-2">
        <p className="min-w-0 text-xs font-medium leading-snug text-muted-foreground">{label}</p>
        <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-info/15 text-info">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-auto overflow-hidden text-ellipsis whitespace-nowrap text-lg font-semibold leading-tight tracking-tight tabular-nums min-[380px]:text-2xl" title={full ?? value}>{value}</p>
    </div>
  );
}
