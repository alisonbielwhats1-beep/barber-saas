import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { ProductForm } from "./product-form";
import { imageForProduct } from "@/lib/images";

export default async function ProdutosPage() {
  const { salonId } = await getTenantContext();
  const products = await prisma.product.findMany({
    where: { salonId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Catálogo
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Produtos</h1>
        </div>
        <ProductForm />
      </header>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {products.map((p, i) => (
          <Card key={p.id} className="card-glow overflow-hidden">
            <div className="relative aspect-video w-full bg-muted">
              <Image
                src={p.imageUrl || imageForProduct(i)}
                alt={p.name}
                fill
                sizes="(max-width: 768px) 100vw, 30vw"
                className="object-cover"
              />
              {!p.active && (
                <div className="absolute inset-0 grid place-items-center bg-background/70">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                    Pausado
                  </span>
                </div>
              )}
              {p.stock === 0 && p.active && (
                <div className="absolute right-2 top-2">
                  <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-400">
                    Sem estoque
                  </span>
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{p.name}</p>
                  {p.brand && <p className="text-[11px] text-muted-foreground">{p.brand}</p>}
                </div>
                <p className="shrink-0 text-[13px] font-semibold">{formatMoney(p.priceCents)}</p>
              </div>
              {p.description && (
                <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">
                  {p.description}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
                <span className="text-[11px] text-muted-foreground">
                  Estoque: <strong className="text-foreground">{p.stock}</strong>
                </span>
                <ProductForm
                  product={{
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    brand: p.brand,
                    category: p.category,
                    priceCents: p.priceCents,
                    stock: p.stock,
                    imageUrl: p.imageUrl,
                  }}
                />
              </div>
            </div>
          </Card>
        ))}
        {products.length === 0 && (
          <Card className="col-span-full p-12 text-center text-[13px] text-muted-foreground">
            Nenhum produto cadastrado ainda.
          </Card>
        )}
      </div>
    </div>
  );
}
