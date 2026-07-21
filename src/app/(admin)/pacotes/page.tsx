import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { Layers, CircleDollarSign, BadgePercent, TrendingUp } from "lucide-react";
import { PacotesView } from "./pacotes-view";

export default async function PacotesPage() {
  const { salonId } = await getTenantContext();

  const [packages, purchases, plans, subscriptions, clients, services] = await Promise.all([
    prisma.package.findMany({
      where: { salonId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, description: true, serviceId: true, sessions: true,
        priceCents: true, validityDays: true, active: true,
        service: { select: { name: true } },
        _count: { select: { purchases: true } },
      },
    }),
    prisma.packagePurchase.findMany({
      where: { salonId },
      orderBy: { purchasedAt: "desc" },
      select: {
        id: true, sessionsUsed: true, sessionsTotal: true, expiresAt: true, status: true, priceCents: true,
        client: { select: { name: true } },
        package: { select: { name: true } },
      },
    }),
    prisma.membershipPlan.findMany({
      where: { salonId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, description: true, priceCents: true, interval: true,
        discountPct: true, benefits: true, active: true,
        _count: { select: { subscriptions: true } },
      },
    }),
    prisma.clientSubscription.findMany({
      where: { salonId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true, renewsAt: true, status: true,
        client: { select: { name: true } },
        plan: { select: { name: true, priceCents: true, interval: true } },
      },
    }),
    prisma.clientProfile.findMany({ where: { salonId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.service.findMany({ where: { salonId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

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

  return (
    <div className="space-y-6">
      <header>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Receita recorrente
        </p>
        <h1 className="text-[26px] font-semibold tracking-tight">Pacotes & Planos</h1>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Layers} accent="#3B9EFF" label="Pacotes ativos" value={activePackages.toString()} />
        <Kpi icon={CircleDollarSign} accent="#2ECC8B" label="Receita de pacotes" value={formatMoney(packageRevenue)} />
        <Kpi icon={BadgePercent} accent="#A855F7" label="Assinantes ativos" value={activeSubs.length.toString()} />
        <Kpi icon={TrendingUp} accent="#F59E0B" label="Receita recorrente (MRR)" value={formatMoney(mrr)} />
      </section>

      <PacotesView
        packages={packageRows}
        purchases={purchaseRows}
        plans={planRows}
        subscriptions={subRows}
        clients={clients}
        services={services}
      />
    </div>
  );
}

function Kpi({ icon: Icon, accent, label, value }: { icon: React.ComponentType<{ className?: string }>; accent: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none tracking-tight">{value}</p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
