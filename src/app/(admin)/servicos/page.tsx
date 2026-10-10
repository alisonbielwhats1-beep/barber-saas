import { Plus } from "lucide-react";
import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { Button } from "@/components/ui/button";
import { ServiceForm } from "./service-form";
import { ResourcePanel } from "./resource-panel";
import { ServicesCatalog, type ServiceCard } from "./services-catalog";

export default async function ServicosPage() {
  const ctx = await getTenantContext();
  const { salonId, role } = ctx;
  const canManage = role === "OWNER" || role === "MANAGER";
  const canSeeFinancial = canManage || role === "SUPER_ADMIN";

  // Sequencial dentro da mesma transação/conexão — não concorrente entre si,
  // então não reintroduz o esgotamento de pool que as waves de 4 evitam.
  const { services, sold } = await withTenant(ctx, async (tx) => {
    const services = await tx.service.findMany({
      where: { salonId },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, description: true, durationMin: true,
        priceCents: true, priceType: true, priceNote: true, costCents: true, category: true, imageUrl: true,
        colorHex: true, active: true,
        variantGroup: true, variantLabel: true, processingMin: true, finishingMin: true, physicalResourceId: true,
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
    return { services, sold };
  });

  const stats = new Map(sold.map((g) => [g.serviceId, { sold: g._count._all, revenue: g._sum.priceCents ?? 0 }]));

  const cards: ServiceCard[] = services.map((s) => ({
    id: s.id,
    variantGroup: s.variantGroup, variantLabel: s.variantLabel, processingMin: s.processingMin, finishingMin: s.finishingMin, physicalResourceId: s.physicalResourceId,
    name: s.name,
    description: s.description,
    durationMin: s.durationMin,
    priceCents: s.priceCents,
    priceType: s.priceType, priceNote: s.priceNote,
    costCents: canSeeFinancial ? s.costCents : 0,
    category: s.category,
    imageUrl: s.imageUrl,
    colorHex: s.colorHex,
    active: s.active,
    proCount: s._count.professionals,
    sold: stats.get(s.id)?.sold ?? 0,
    revenueCents: stats.get(s.id)?.revenue ?? 0,
  }));
  const categoryCount = new Set(cards.map((s) => s.category).filter(Boolean)).size;

  return (
    <div className="flex min-w-0 flex-col gap-3.5 lg:gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">Serviços</h1>
          {cards.length > 0 && (
            <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
              {cards.length} {cards.length === 1 ? "serviço" : "serviços"}
              {categoryCount > 0 && ` · ${categoryCount} ${categoryCount === 1 ? "categoria" : "categorias"}`}
            </p>
          )}
        </div>
        {/* No celular o "+" fica ao lado da busca (dentro do catálogo); sem serviços, o botão daqui vale para todas as telas. */}
        {canManage && (
          <ServiceForm
            trigger={
              <Button className={cards.length > 0 ? "hidden lg:inline-flex" : undefined}>
                <Plus aria-hidden="true" className="h-4 w-4" /> Novo serviço
              </Button>
            }
          />
        )}
      </div>

      {cards.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Nenhum serviço cadastrado ainda. Crie o primeiro no botão acima.
        </div>
      ) : (
        <ServicesCatalog
          services={cards}
          canManage={canManage}
          canSeeFinancial={canSeeFinancial}
        />
      )}
      {canManage && <ResourcePanel />}
      {canSeeFinancial && cards.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Margem = (preço − custo) ÷ preço. Vendas: atendimentos concluídos.
        </p>
      )}
    </div>
  );
}
