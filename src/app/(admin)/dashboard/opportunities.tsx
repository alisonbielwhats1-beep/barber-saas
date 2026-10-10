import Link from "next/link";
import { withTenant } from "@/lib/prisma-tenant";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { ArrowUpRight, CalendarClock, Receipt, Users } from "lucide-react";
import { dateKeyInTimeZone } from "@/lib/time";
import { formatMoneyWhole, ToneChip, type Tone } from "./results-ui";
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
  const items: { icon: typeof Receipt; title: string; value: number; detail: string; href: string; tone: Tone }[] = [
    { icon: Receipt, title: "Concluídos sem recebimento", value: data.unpaid._count._all, detail: `${formatMoneyWhole(data.unpaid._sum.priceCents ?? 0)} em serviços; confira descontos e comanda`, href: "/financeiro", tone: "warning" },
    { icon: CalendarClock, title: "Pacotes próximos do vencimento", value: data.expiring, detail: "Com sessões restantes e vencimento nos próximos 7 dias", href: "/pacotes?filter=expiring", tone: "warning" },
    { icon: Users, title: "Pedidos de encaixe ativos", value: data.waitlist, detail: "Revise os períodos e confirme vagas pela ordem da fila", href: "/agenda", tone: "accent" },
  ];
  // Celular: uma lista (pastilha, título e apoio, número à direita). Computador: três cartões.
  return (
    <section aria-label="Próximas ações" className="flex flex-col gap-2.5">
      <h2 className="text-sm font-semibold">Próximas ações</h2>
      <div className="max-md:divide-y max-md:divide-border max-md:overflow-hidden max-md:rounded-[14px] max-md:border max-md:border-border max-md:bg-card md:grid md:grid-cols-3 md:gap-3">
        {items.map(({ icon, ...item }) => (
          <Link key={item.title} href={item.href}
            className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-3.5 py-3 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:flex md:flex-col md:gap-1.5 md:rounded-[14px] md:border md:border-border md:bg-card md:p-4">
            <span className="md:order-1"><ToneChip icon={icon} tone={item.value ? item.tone : "neutral"} size="md" /></span>
            <span className="min-w-0 md:order-3">
              <span className="block text-sm font-medium leading-snug">{item.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{item.detail}</span>
            </span>
            <span className="text-lg font-semibold tabular-nums md:order-2 md:mt-1.5 md:text-2xl md:leading-tight">{item.value}</span>
            <ArrowUpRight aria-hidden="true" className="absolute right-4 top-4 hidden h-4 w-4 text-muted-foreground md:block" />
          </Link>
        ))}
      </div>
    </section>
  );
}
