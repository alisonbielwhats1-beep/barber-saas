import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { ServiceForm } from "./service-form";
import { ServicesCatalog, type ServiceCard } from "./services-catalog";
import { PageHeader } from "@/components/page-header";
import { getBusinessExperience } from "@/config/business-experience";

export default async function ServicosPage() {
  const ctx = await getTenantContext();
  const { salonId, role } = ctx;
  const canManage = role === "OWNER" || role === "MANAGER";
  const canSeeFinancial = canManage || role === "SUPER_ADMIN";

  // Sequencial dentro da mesma transação/conexão — não concorrente entre si,
  // então não reintroduz o esgotamento de pool que as waves de 4 evitam.
  const { services, sold, segment } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: { segment: true },
    });
    const services = await tx.service.findMany({
      where: { salonId },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, description: true, durationMin: true,
        priceCents: true, costCents: true, category: true, imageUrl: true,
        colorHex: true, active: true,
        _count: { select: { professionals: true } },
      },
    });
    // Popularidade: atendimentos concluídos por serviço
    const sold = canSeeFinancial
      ? await tx.appointment.groupBy({
          by: ["serviceId"],
          where: { salonId, status: "COMPLETED" },
          _count: { _all: true },
          _sum: { priceCents: true },
        })
      : [];
    return { services, sold, segment: salon?.segment };
  });
  const experience = getBusinessExperience(segment);

  const stats = new Map(sold.map((g) => [g.serviceId, { sold: g._count._all, revenue: g._sum.priceCents ?? 0 }]));

  const cards: ServiceCard[] = services.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    durationMin: s.durationMin,
    priceCents: s.priceCents,
    costCents: canSeeFinancial ? s.costCents : 0,
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
      <PageHeader
        kicker="Catálogo"
        title={experience.navigation.services}
        description={experience.pages.servicesDescription}
      >
        {canManage && <ServiceForm />}
      </PageHeader>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-[13px] text-muted-foreground">
          {experience.emptyStates.services}
        </div>
      ) : (
        <ServicesCatalog
          services={cards}
          canManage={canManage}
          canSeeFinancial={canSeeFinancial}
        />
      )}
    </div>
  );
}
