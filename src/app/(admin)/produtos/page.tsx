import { requireRole } from "@/lib/tenant";
import { MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { ProductForm } from "./product-form";
import { ProductsCatalog, type ProductCard } from "./products-catalog";
import { Button } from "@/components/ui/button";
import { PackageOpen, Plus } from "lucide-react";
import { canUsePlanFeature } from "@/lib/plan-entitlements";

export default async function ProdutosPage() {
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
    return { products, sales, movements, plan: salon?.plan };
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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Catálogo
          </p>
          <h1 className="text-[26px] font-semibold tracking-tight">Produtos</h1>
        </div>
        {inventoryEnabled && <ProductForm />}
      </header>

      {!inventoryEnabled && (
        <section className="rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 text-[12px] text-muted-foreground">
          <strong className="text-foreground">Estoque e produtos ficam disponíveis no plano Fundador.</strong>{" "}
          Você ainda pode consultar o histórico existente; faça upgrade para cadastrar, editar ou movimentar produtos.
        </section>
      )}

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <PackageOpen className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Comece seu catálogo</h2>
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
            Cadastre o primeiro produto para acompanhar estoque, margem e reposição em um só lugar.
          </p>
          {inventoryEnabled ? <ProductForm
            trigger={
              <Button size="lg" className="mt-5">
                <Plus className="h-4 w-4" /> Cadastrar primeiro produto
              </Button>
            }
          /> : <p className="mx-auto mt-5 max-w-sm text-[12px] text-primary">Faça upgrade para liberar o catálogo e o controle de estoque.</p>}
        </div>
      ) : (
        <ProductsCatalog enabled={inventoryEnabled} products={cards} movements={movements.map((movement) => ({
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
