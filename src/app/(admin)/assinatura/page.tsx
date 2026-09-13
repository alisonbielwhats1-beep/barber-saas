import Link from "next/link";
import { requireRole } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { billingEnabled } from "@/lib/billing/config";
import { resolveBillingIntent } from "@/lib/billing/presentation";
import { SubscriptionPortal } from "@/components/billing/subscription-portal";

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ billingPlan?: string; cycle?: string; extraAgendas?: string }> }) {
  const ctx = await requireRole(["OWNER"]);
  const query = await searchParams;
  const data = await withTenant(ctx, async tx => ({
    salon: await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { name: true, timezone: true } }),
    user: await tx.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { email: true } }),
  }));
  return <div className="space-y-6"><header><Link href="/configuracoes#plano" className="text-sm text-muted-foreground underline">Voltar às configurações</Link><h1 className="mt-3 text-2xl font-semibold">Plano e assinatura</h1><p className="mt-1 text-muted-foreground">{data.salon.name}</p></header>
    {billingEnabled() ? <SubscriptionPortal key={ctx.salonId} salonId={ctx.salonId} email={data.user.email} timezone={data.salon.timezone} initial={resolveBillingIntent(query)} /> : <p>A contratação online ainda não está disponível. Seu acesso atual permanece preservado.</p>}
  </div>;
}
