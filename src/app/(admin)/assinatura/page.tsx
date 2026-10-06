import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { billingEnabled, checkoutPaused, planChangesPaused } from "@/lib/billing/config";
import { resolveBillingIntent } from "@/lib/billing/presentation";
import { getPlanEntitlement } from "@/lib/plan-entitlements";
import { SubscriptionPortal } from "@/components/billing/subscription-portal";
import { SecretaryCreditsCard } from "@/components/billing/secretary-credits-card";
import { creditsEnabled } from "@/lib/secretary-credits";
import { secretaryAvailableTo } from "@/lib/secretary-availability";

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ billingPlan?: string; cycle?: string; extraAgendas?: string; retorno?: string }> }) {
  const ctx = await requireRole(["OWNER"]);
  const query = await searchParams;
  const data = await withTenant(ctx, async tx => {
    const [salon, user, professionals, invites] = await Promise.all([
      tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { name: true, timezone: true, plan: true } }),
      tx.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { email: true } }),
      // Display only: same occupancy the billing service enforces under its capacity lock.
      tx.professional.count({ where: { salonId: ctx.salonId, active: true } }),
      tx.userInvite.count({ where: { salonId: ctx.salonId, role: "PROFESSIONAL", usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return { salon, user, occupiedAgendas: professionals + invites };
  });
  const entitlement = getPlanEntitlement(data.salon.plan);
  const legacy = { label: entitlement.label, agendas: entitlement.maxProfessionals, free: data.salon.plan === "FREE" };
  let billingOrigin: string | null = null;
  try { billingOrigin = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null; } catch { billingOrigin = null; }
  return <div className="mx-auto w-full max-w-5xl space-y-8">
    <header className="space-y-2">
      <Link href="/configuracoes#plano" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"><ChevronLeft aria-hidden="true" className="h-4 w-4" />Configurações</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Plano e assinatura</h1>
      <p className="text-muted-foreground">{data.salon.name} · Acompanhe seu plano, pagamentos e renovação.</p>
    </header>
    {billingEnabled() ? <SubscriptionPortal key={ctx.salonId} salonId={ctx.salonId} email={data.user.email} timezone={data.salon.timezone} initial={resolveBillingIntent(query)}
      legacy={legacy} occupiedAgendas={data.occupiedAgendas} billingOrigin={billingOrigin} returnedFromCheckout={query.retorno === "mercadopago"}
      newContractsPaused={checkoutPaused()} changesPaused={planChangesPaused()} />
      : <p>A contratação online ainda não está disponível. Seu acesso atual permanece preservado.</p>}
    {creditsEnabled() && secretaryAvailableTo(ctx) && <SecretaryCreditsCard salonId={ctx.salonId} timezone={data.salon.timezone} returnedFromCheckout={query.retorno === "creditos"} />}
    <details className="admin-detail-section"><summary>Guia de configuração do estabelecimento</summary><p className="mt-2 text-sm text-muted-foreground">Configure horários, serviços e profissionais. No final do guia, conheça o aplicativo e o link que você compartilha com os clientes.</p><Link href="/onboarding/configuracao" className="mb-4 mt-3 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Configurar meu estabelecimento</Link></details>
  </div>;
}
