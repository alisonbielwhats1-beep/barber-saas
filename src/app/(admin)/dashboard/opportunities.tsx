import Link from "next/link";
import { withTenant } from "@/lib/prisma-tenant";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { ArrowUpRight, CalendarClock, Receipt, Users } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { dateKeyInTimeZone } from "@/lib/time";
export async function Opportunities() {
  const ctx = await getTenantContext(); assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = await withTenant(ctx, async tx => {
    const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { timezone: true } });
    const now = new Date(); const today = dateKeyInTimeZone(now, salon.timezone);
    const unpaid = await tx.appointment.aggregate({ where: { salonId: ctx.salonId, status: "COMPLETED", payment: null }, _count: { _all: true }, _sum: { priceCents: true } });
    const expiring = await tx.packagePurchase.findMany({ where: { salonId: ctx.salonId, status: "ACTIVE", expiresAt: { gte: now, lte: new Date(+now + 7 * 86400000) } }, select: { sessionsTotal: true, sessionsUsed: true } });
    const waitlist = await tx.flexibleWaitlist.count({ where: { salonId: ctx.salonId, status: "WAITING", toDate: { gte: today } } });
    return { unpaid, expiring: expiring.filter(p => p.sessionsUsed < p.sessionsTotal).length, waitlist };
  });
  const items = [
    { icon: Receipt, title: "Concluídos sem recebimento", value: String(data.unpaid._count._all), detail: `${formatMoney(data.unpaid._sum.priceCents ?? 0)} em serviços; confira descontos e comanda`, href: "/fechamento", color: "text-warning" },
    { icon: CalendarClock, title: "Pacotes próximos do vencimento", value: String(data.expiring), detail: "Com sessões restantes e vencimento nos próximos 7 dias", href: "/pacotes?filter=expiring", color: "text-info" },
    { icon: Users, title: "Pedidos de encaixe ativos", value: String(data.waitlist), detail: "Revise os períodos e confirme vagas pela ordem da fila", href: "/agenda", color: "text-success" },
  ];
  return <section aria-label="Próximas ações" className="space-y-3"><h2 className="text-sm font-semibold">Próximas ações</h2><div className="grid gap-3 md:grid-cols-3">{items.map(({ icon: Icon, ...item }) => <Link key={item.title} href={item.href} className="group rounded-xl border border-border bg-card p-4 transition hover:border-primary/50"><div className="flex items-center justify-between"><Icon className={`h-5 w-5 ${item.color}`} /><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></div><p className="mt-3 text-2xl font-semibold tabular-nums">{item.value}</p><p className="mt-1 text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></Link>)}</div></section>;
}
