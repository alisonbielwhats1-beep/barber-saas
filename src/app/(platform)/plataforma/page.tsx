import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  Crown,
  ShieldAlert,
  WalletCards,
} from "lucide-react";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { withUser } from "@/lib/prisma-tenant";

export default async function PlatformOverviewPage() {
  const admin = await getPlatformAdminContext();
  const [groups, latestRequests] = await withUser(admin.userId, (tx) =>
    Promise.all([
      tx.salon.groupBy({
        by: ["accessStatus", "plan"],
        _count: { _all: true },
      }),
      tx.salon.findMany({
        where: { accessStatus: "PENDING" },
        orderBy: [{ accessRequestedAt: "desc" }, { id: "desc" }],
        take: 5,
        select: {
          id: true,
          name: true,
          segment: true,
          accessRequestedAt: true,
          memberships: {
            where: { role: "OWNER" },
            take: 1,
            select: { user: { select: { name: true } } },
          },
        },
      }),
    ]),
  );

  const total = groups.reduce((sum, group) => sum + group._count._all, 0);
  const countStatus = (status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED") =>
    groups
      .filter((group) => group.accessStatus === status)
      .reduce((sum, group) => sum + group._count._all, 0);
  const countPlan = (plan: "FREE" | "STARTER" | "PRO" | "ENTERPRISE") =>
    groups
      .filter((group) => group.plan === plan)
      .reduce((sum, group) => sum + group._count._all, 0);

  const metrics = [
    { label: "Estabelecimentos", value: total, icon: Building2 },
    { label: "Aguardando análise", value: countStatus("PENDING"), icon: Clock3 },
    { label: "Ativos", value: countStatus("APPROVED"), icon: CheckCircle2 },
    { label: "Plano Pro", value: countPlan("PRO"), icon: Crown },
    { label: "Suspensos", value: countStatus("SUSPENDED"), icon: ShieldAlert },
  ];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Visão geral
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Olá, {admin.name.split(" ")[0]}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Controle central da plataforma. As ações abaixo atravessam tenants e ficam
          restritas à sua conta de administrador global.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <article key={metric.label} className="rounded-2xl border border-border bg-card p-5">
            <metric.icon className="h-5 w-5 text-muted-foreground" />
            <p className="mt-5 text-3xl font-semibold tabular-nums">{metric.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{metric.label}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Novas solicitações</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Cadastros que ainda precisam da sua decisão.
              </p>
            </div>
            <Link
              href="/plataforma/solicitacoes"
              className="inline-flex items-center gap-1 text-sm text-foreground transition hover:text-primary"
            >
              Ver todos <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {latestRequests.length === 0 ? (
            <p className="mt-8 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhuma solicitação pendente.
            </p>
          ) : (
            <div className="mt-5 divide-y divide-border">
              {latestRequests.map((salon) => (
                <div key={salon.id} className="flex items-center justify-between gap-4 py-4 first:pt-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{salon.name}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {salon.memberships[0]?.user.name ?? "Proprietário não identificado"}
                      {salon.segment ? ` · ${salon.segment}` : ""}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {salon.accessRequestedAt.toLocaleDateString("pt-BR")}
                  </time>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-border bg-card p-6">
          <WalletCards className="h-5 w-5 text-muted-foreground" />
          <h2 className="mt-5 text-lg font-semibold">Cobranças da plataforma</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            O plano de cada estabelecimento já pode ser definido manualmente. O registro de
            mensalidades será separado dos pagamentos de clientes para não misturar caixas.
          </p>
          <div className="mt-5 rounded-2xl bg-background p-4 text-xs leading-relaxed text-muted-foreground">
            Recomendação: começar com controle manual, sem cobrança automática nem serviço pago,
            e automatizar somente quando preço, vencimento e política de inadimplência estiverem definidos.
          </div>
        </section>
      </div>
    </div>
  );
}
