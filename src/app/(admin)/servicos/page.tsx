import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { ServiceForm } from "./service-form";
import { ServicesCatalog, type ServiceCard } from "./services-catalog";

export default async function ServicosPage() {
  const { salonId } = await getTenantContext();

  const [services, sold] = await Promise.all([
    prisma.service.findMany({
      where: { salonId },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, description: true, durationMin: true,
        priceCents: true, costCents: true, category: true, imageUrl: true,
        colorHex: true, active: true,
        _count: { select: { professionals: true } },
      },
    }),
    // Popularidade: atendimentos concluídos por serviço
    prisma.appointment.groupBy({
      by: ["serviceId"],
      where: { salonId, status: "COMPLETED" },
      _count: { _all: true },
      _sum: { priceCents: true },
    }),
  ]);

  const stats = new Map(sold.map((g) => [g.serviceId, { sold: g._count._all, revenue: g._sum.priceCents ?? 0 }]));

  const cards: ServiceCard[] = services.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    durationMin: s.durationMin,
    priceCents: s.priceCents,
    costCents: s.costCents,
    category: s.category,
    imageUrl: s.imageUrl,
    colorHex: s.colorHex,
    active: s.active,
    proCount: s._count.professionals,
    sold: stats.get(s.id)?.sold ?? 0,
    revenueCents: stats.get(s.id)?.revenue ?? 0,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Catálogo
          </p>
          <h1 className="text-[26px] font-semibold tracking-tight">Serviços</h1>
        </div>
        <ServiceForm />
      </header>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-[13px] text-muted-foreground">
          Nenhum serviço cadastrado ainda. Crie o primeiro no botão acima.
        </div>
      ) : (
        <ServicesCatalog services={cards} />
      )}
    </div>
  );
}
