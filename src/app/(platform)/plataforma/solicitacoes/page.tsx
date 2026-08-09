import { Building2, CheckCircle2, Clock3, ShieldAlert, XCircle } from "lucide-react";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { withUser } from "@/lib/prisma-tenant";
import { ApprovalControls } from "./approval-controls";

const STATUS = {
  PENDING: { label: "Pendente", icon: Clock3, className: "text-amber-400" },
  APPROVED: { label: "Ativo", icon: CheckCircle2, className: "text-emerald-400" },
  REJECTED: { label: "Recusado", icon: XCircle, className: "text-rose-400" },
  SUSPENDED: { label: "Suspenso", icon: ShieldAlert, className: "text-orange-400" },
} as const;

export default async function AccessRequestsPage() {
  const admin = await getPlatformAdminContext();
  const salons = await withUser(admin.userId, (tx) =>
    tx.salon.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        segment: true,
        plan: true,
        accessStatus: true,
        accessRequestedAt: true,
        accessReviewedAt: true,
        memberships: {
          where: { role: "OWNER" },
          take: 1,
          select: { user: { select: { name: true, email: true, phone: true } } },
        },
        accessEvents: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { type: true, reason: true, createdAt: true },
        },
      },
      orderBy: { accessRequestedAt: "desc" },
      take: 100,
    }),
  );

  const ordered = [...salons].sort((a, b) => {
    if (a.accessStatus === "PENDING" && b.accessStatus !== "PENDING") return -1;
    if (a.accessStatus !== "PENDING" && b.accessStatus === "PENDING") return 1;
    return b.accessRequestedAt.getTime() - a.accessRequestedAt.getTime();
  });
  const pendingCount = salons.filter((salon) => salon.accessStatus === "PENDING").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
            Controle de acesso
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Estabelecimentos</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Aprove novos cadastros e escolha o plano sem apagar nenhum dado.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card px-5 py-3 text-right">
          <p className="text-2xl font-semibold">{pendingCount}</p>
          <p className="text-xs text-muted-foreground">aguardando análise</p>
        </div>
      </header>

      {ordered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Nenhum estabelecimento cadastrado.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {ordered.map((salon) => {
            const status = STATUS[salon.accessStatus];
            const StatusIcon = status.icon;
            const owner = salon.memberships[0]?.user;
            const lastEvent = salon.accessEvents[0];
            return (
              <article key={salon.id} className="rounded-3xl border border-border bg-card p-5">
                <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-semibold">{salon.name}</h2>
                      <span className={`inline-flex items-center gap-1 rounded-full bg-background px-2.5 py-1 text-xs ${status.className}`}>
                        <StatusIcon className="h-3.5 w-3.5" /> {status.label}
                      </span>
                      <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                        {salon.plan}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {owner?.name ?? "Proprietário não identificado"} · {owner?.email ?? "sem e-mail"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      /{salon.slug} · {salon.segment ?? "segmento não definido"} · solicitado em {salon.accessRequestedAt.toLocaleString("pt-BR")}
                    </p>
                    {lastEvent?.reason && (
                      <p className="mt-3 rounded-xl bg-background px-3 py-2 text-xs text-muted-foreground">
                        Último motivo: {lastEvent.reason}
                      </p>
                    )}
                  </div>
                  <ApprovalControls
                    salonId={salon.id}
                    salonName={salon.name}
                    status={salon.accessStatus}
                    currentPlan={salon.plan}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
