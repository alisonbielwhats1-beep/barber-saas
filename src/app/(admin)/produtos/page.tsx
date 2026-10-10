import { featureEntitlement } from "@/lib/billing/plan-grants";
import { requireRole } from "@/lib/tenant";
import { MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { ProductForm } from "./product-form";
import { ProductsCatalog, type ProductCard } from "./products-catalog";
import { Button } from "@/components/ui/button";
import { Crown, PackageOpen, Plus } from "lucide-react";
import { canUsePlanFeature } from "@/lib/plan-entitlements";
import { PlanUpgradeAction } from "@/components/plan-upgrade-action";

export default async function ProdutosPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const ctx = await requireRole(MANAGEMENT_ROLES);
  const { salonId } = ctx;

  const { products, sales, movements, plan } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({ where: { id: salonId }, select: { plan: true } });
    const products = await tx.product.findMany({
      where: { salonId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    const sales = await tx.appointmentProduct.groupBy({
      by: ["productId"],
      where: { appointment: { salonId } },
      _sum: { quantity: true },
    });
    const movements = await tx.auditLog.findMany({
      where: { salonId, action: "STOCK_ADJUSTED", entityType: "Product" },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, actorName: true, reason: true, createdAt: true, metadata: true },
    });
    return { products, sales, movements, plan: await featureEntitlement(tx, salonId, salon?.plan) };
  });
  const inventoryEnabled = canUsePlanFeature(plan, "INVENTORY");

  const soldMap = new Map(sales.map((g) => [g.productId, g._sum.quantity ?? 0]));
  const topId = sales.length
    ? sales.reduce((a, b) => ((b._sum.quantity ?? 0) > (a._sum.quantity ?? 0) ? b : a)).productId
    : null;

  const cards: ProductCard[] = products.map((p, i) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    brand: p.brand,
    category: p.category,
    supplier: p.supplier,
    barcode: p.barcode,
    priceCents: p.priceCents,
    costCents: p.costCents,
    stock: p.stock,
    minStock: p.minStock,
    expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
    imageUrl: p.imageUrl,
    active: p.active,
    sold: soldMap.get(p.id) ?? 0,
    topSeller: p.id === topId && (soldMap.get(p.id) ?? 0) > 0,
    index: i,
  }));

  const categoryCount = new Set(cards.map((p) => p.category).filter(Boolean)).size;

  return (
    <div className="flex min-w-0 flex-col gap-3.5 lg:gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">Produtos</h1>
          {cards.length > 0 && (
            <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
              {cards.length} {cards.length === 1 ? "produto" : "produtos"}
              {categoryCount > 0 && ` · ${categoryCount} ${categoryCount === 1 ? "categoria" : "categorias"}`}
            </p>
          )}
        </div>
        {/* No celular o "+" fica ao lado da busca (dentro do catálogo); sem produtos, o botão daqui vale para todas as telas. */}
        {inventoryEnabled && (
          <ProductForm
            trigger={
              <Button className={cards.length > 0 ? "hidden lg:inline-flex" : undefined}>
                <Plus aria-hidden="true" className="h-4 w-4" /> Novo produto
              </Button>
            }
          />
        )}
      </div>

      {!inventoryEnabled && (
        <section className="flex items-start gap-3 rounded-xl border border-border-strong bg-card px-3.5 py-3 text-sm">
          <Crown aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <strong className="block font-semibold text-foreground">Estoque e produtos ficam disponíveis nos planos pagos.</strong>
            <p className="text-muted-foreground">Você ainda pode consultar o histórico existente; contrate um plano pago para cadastrar, editar ou movimentar produtos.</p>
            <PlanUpgradeAction role={ctx.role} />
          </div>
        </section>
      )}

      {cards.length === 0 ? (
        <div className="flex flex-col items-center rounded-[14px] border border-border bg-card px-6 py-12 text-center">
          <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-xl bg-muted text-foreground">
            <PackageOpen className="h-6 w-6" />
          </span>
          <h2 className="mt-4 text-base font-semibold">Comece seu catálogo</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Cadastre o primeiro produto para acompanhar estoque, margem e reposição em um só lugar.
          </p>
          {inventoryEnabled ? <ProductForm
            trigger={
              <Button className="mt-5">
                <Plus aria-hidden="true" className="h-4 w-4" /> Cadastrar primeiro produto
              </Button>
            }
          /> : <p className="mx-auto mt-5 max-w-sm text-sm text-muted-foreground">Contrate um plano pago para liberar o catálogo e o controle de estoque.</p>}
        </div>
      ) : (
        <ProductsCatalog initialFilter={filter === "restock" ? "restock" : "all"} enabled={inventoryEnabled} products={cards} movements={movements.map((movement) => ({
          id: movement.id,
          actorName: movement.actorName,
          reason: movement.reason,
          createdAt: movement.createdAt.toISOString(),
          metadata: movement.metadata as Record<string, unknown> | null,
        }))} />
      )}
    </div>
  );
}
