import { requireRole } from "@/lib/tenant";
import { MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { ProductForm } from "./product-form";
import { ProductsCatalog, type ProductCard } from "./products-catalog";

export default async function ProdutosPage() {
  const ctx = await requireRole(MANAGEMENT_ROLES);
  const { salonId } = ctx;

  const { products, appointmentSales, directSales } = await withTenant(ctx, async (tx) => {
    const products = await tx.product.findMany({
      where: { salonId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    const appointmentSales = await tx.appointmentProduct.groupBy({
      by: ["productId"],
      where: { appointment: { salonId, status: "COMPLETED" } },
      _sum: { quantity: true },
    });
    const directSales = await tx.productSale.groupBy({
      by: ["productId"],
      where: { salonId },
      _sum: { quantity: true },
    });
    return { products, appointmentSales, directSales };
  });

  const soldMap = new Map<string, number>();
  for (const sale of [...appointmentSales, ...directSales]) {
    soldMap.set(
      sale.productId,
      (soldMap.get(sale.productId) ?? 0) + (sale._sum.quantity ?? 0),
    );
  }
  const topId = [...soldMap.entries()].reduce<string | null>(
    (top, [productId, quantity]) =>
      top === null || quantity > (soldMap.get(top) ?? 0) ? productId : top,
    null,
  );

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
        <ProductForm />
      </header>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-[13px] text-muted-foreground">
          Nenhum produto cadastrado ainda. Crie o primeiro no botão acima.
        </div>
      ) : (
        <ProductsCatalog products={cards} />
      )}
    </div>
  );
}
