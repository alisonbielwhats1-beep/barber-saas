import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Clock3, ShieldCheck, XCircle } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { withUser } from "@/lib/prisma-tenant";
import { AccessStatusActions } from "./access-status-actions";
import { billingEnabled } from "@/lib/billing/config";
import { SubscriptionPortal } from "@/components/billing/subscription-portal";

const STATUS_CONTENT = {
  PENDING: {
    icon: Clock3,
    title: "Solicitação recebida",
    description:
      "Seu estabelecimento está aguardando análise. Assim que o acesso for liberado como Grátis ou Pro, você poderá entrar no painel.",
    badge: "Em análise",
  },
  REJECTED: {
    icon: XCircle,
    title: "Acesso não liberado",
    description:
      "A solicitação foi analisada e não pôde ser liberada neste momento. Entre em contato com o administrador para revisar os dados.",
    badge: "Não aprovado",
  },
  SUSPENDED: {
    icon: ShieldCheck,
    title: "Acesso temporariamente suspenso",
    description:
      "O estabelecimento e os dados continuam preservados, mas o painel está bloqueado até uma nova liberação do administrador.",
    badge: "Suspenso",
  },
} as const;

export default async function AccessStatusPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const activeSalonId = (await cookies()).get("active_salon")?.value;
  const memberships = await withUser(session.user.id, (tx) =>
    tx.membership.findMany({
      where: { userId: session.user.id },
      select: {
        salonId: true,
        role: true,
        salon: {
          select: { name: true, timezone: true, accessStatus: true, accessRequestedAt: true },
        },
      },
    }),
  );
  if (memberships.length === 0) redirect("/onboarding/create-salon");

  const membership =
    memberships.find((item) => item.salonId === activeSalonId) ??
    memberships.find((item) => item.salon.accessStatus !== "APPROVED") ??
    memberships[0];
  if (membership.salon.accessStatus === "APPROVED") redirect("/dashboard");

  const content = STATUS_CONTENT[membership.salon.accessStatus];
  const Icon = content.icon;
  const billingUser = billingEnabled() && membership.role === "OWNER" ? await withUser(session.user.id, tx => tx.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { email: true } })) : null;

  return (
    <main id="main-content" tabIndex={-1} className="grid min-h-dvh place-items-center bg-background px-5 py-10 outline-none">
      <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-7 shadow-2xl">
        <span className="inline-flex rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
          {content.badge}
        </span>
        <span className="mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-7 w-7" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{content.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {content.description}
        </p>
        <div className="my-6 rounded-2xl border border-border bg-background/60 p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Estabelecimento
          </p>
          <p className="mt-1 font-semibold">{membership.salon.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Solicitado em {membership.salon.accessRequestedAt.toLocaleDateString("pt-BR")}
          </p>
        </div>
        <p className="mb-5 text-xs leading-relaxed text-muted-foreground">
          Não é necessário criar outra conta. Seus dados já estão salvos e o
          acesso aparecerá automaticamente após a aprovação.
        </p>
        <AccessStatusActions />
        {billingUser && <details className="mt-6 border-t border-border pt-5"><summary className="cursor-pointer py-2 font-medium underline">Gerenciar ou cancelar assinatura</summary><div className="mt-4"><p className="mb-4 text-sm text-muted-foreground">O cancelamento da cobrança continua disponível mesmo com o painel bloqueado.</p><SubscriptionPortal salonId={membership.salonId} email={billingUser.email} timezone={membership.salon.timezone} accessBlocked /></div></details>}
      </section>
    </main>
  );
}
