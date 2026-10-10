import Link from "next/link";
import { ChevronDown, ChevronLeft, ListChecks } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { billingEnabled, checkoutPaused, planChangesPaused } from "@/lib/billing/config";
import { stripeOfferedTo } from "@/lib/billing/stripe/config";
import { resolveBillingIntent } from "@/lib/billing/presentation";
import { getPlanEntitlement } from "@/lib/plan-entitlements";
import { SubscriptionPortal } from "@/components/billing/subscription-portal";
import { SecretaryCreditsCard } from "@/components/billing/secretary-credits-card";
import { creditsEnabled } from "@/lib/secretary-credits";
import { secretaryAvailableTo } from "@/lib/secretary-availability";
import { complimentaryEntitlement, grantEntitlement } from "@/lib/billing/plan-grants";

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ billingPlan?: string; cycle?: string; extraAgendas?: string; retorno?: string }> }) {
  const ctx = await requireRole(["OWNER"]);
  const query = await searchParams;
  const data = await withTenant(ctx, async tx => {
    const [salon, user, professionals, invites] = await Promise.all([
      tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { name: true, timezone: true, plan: true, slug: true } }),
      tx.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { email: true } }),
      // Display only: same occupancy the billing service enforces under its capacity lock.
      tx.professional.count({ where: { salonId: ctx.salonId, active: true } }),
      tx.userInvite.count({ where: { salonId: ctx.salonId, role: "PROFESSIONAL", usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return { salon, user, grant: await complimentaryEntitlement(tx, ctx.salonId), occupiedAgendas: professionals + invites };
  });
  const entitlement = data.grant ? grantEntitlement(data.grant) : getPlanEntitlement(data.salon.plan);
  const legacy = { label: entitlement.label, agendas: entitlement.maxProfessionals, free: !data.grant && data.salon.plan === "FREE",
    courtesyThrough: data.grant?.throughDate };
  let billingOrigin: string | null = null;
  try { billingOrigin = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null; } catch { billingOrigin = null; }
  return <div className="w-full max-w-6xl space-y-5 lg:space-y-6">
    <header>
      <Link href="/configuracoes#plano" className="-ml-1 inline-flex min-h-11 items-center gap-0.5 rounded-lg pr-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline lg:min-h-7"><ChevronLeft aria-hidden="true" className="h-4 w-4" />Configurações</Link>
      <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">Plano e assinatura</h1>
      <p className="mt-1 text-sm text-muted-foreground">{data.salon.name} · Acompanhe seu plano, pagamentos e renovação.</p>
    </header>
    {data.grant && <section aria-label="Período gratuito" className="space-y-1 rounded-xl border border-border-strong bg-card px-3.5 py-3 text-sm leading-relaxed">
      <p className="font-semibold">{entitlement.label} grátis até {data.grant.throughDate.split("-").reverse().join("/")}, inclusive.</p>
      <p>Sem cobrança automática. Ao terminar, seu acesso volta ao Grátis e seu histórico permanece. Para continuar no Individual ou outro plano, contrate abaixo. A contratação inicia a cobrança, inclusive se feita antes do fim da cortesia.</p>
    </section>}
    {billingEnabled() ? <SubscriptionPortal key={ctx.salonId} salonId={ctx.salonId} email={data.user.email} timezone={data.salon.timezone} initial={resolveBillingIntent(query)}
      legacy={legacy} occupiedAgendas={data.occupiedAgendas} billingOrigin={billingOrigin} returnedFromCheckout={query.retorno === "mercadopago" || query.retorno === "stripe"}
      newContractsPaused={checkoutPaused() && !stripeOfferedTo(data.salon.slug)} changesPaused={planChangesPaused()}
      stripeAvailable={stripeOfferedTo(data.salon.slug)} mercadoPagoPaused={checkoutPaused()} />
      : <p className="rounded-xl border border-border-strong bg-card px-3.5 py-3 text-sm">A contratação online ainda não está disponível. Seu acesso atual permanece preservado.</p>}
    {creditsEnabled() && secretaryAvailableTo(ctx) && <SecretaryCreditsCard salonId={ctx.salonId} timezone={data.salon.timezone} returnedFromCheckout={query.retorno === "creditos"} />}
    <details className="group overflow-hidden rounded-[14px] border border-border bg-card">
      <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-muted text-foreground"><ListChecks className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1 text-sm font-medium">Guia de configuração do estabelecimento</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-border px-3.5 py-3">
        <p className="text-sm text-muted-foreground">Configure horários, serviços e profissionais. No final do guia, conheça o aplicativo e o link que você compartilha com os clientes.</p>
        <Link href="/onboarding/configuracao" className={buttonVariants()}>Configurar meu estabelecimento</Link>
      </div>
    </details>
  </div>;
}
