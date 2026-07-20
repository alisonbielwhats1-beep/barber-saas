import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
          <h1 className="font-display text-3xl md:text-4xl">Produtos</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo que aparece no app do cliente com opção de carrinho
          </p>
        </div>
        <ProductForm />
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {products.map((p, i) => (
          <Card key={p.id} className="overflow-hidden">
            <div className="relative aspect-square w-full bg-muted">
              <Image
                src={p.imageUrl || imageForProduct(i)}
                alt={p.name}
                fill
                sizes="(max-width: 768px) 100vw, 30vw"
                className="object-cover"
              />
              {!p.active && (
                <div className="absolute inset-0 grid place-items-center bg-background/70">
                  <Badge variant="outline">Pausado</Badge>
                </div>
              )}
              {p.stock === 0 && p.active && (
                <div className="absolute right-2 top-2">
                  <Badge variant="warn">Sem estoque</Badge>
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  {p.brand && <p className="text-xs text-muted-foreground">{p.brand}</p>}
                </div>
                <p className="text-sm font-semibold">{formatMoney(p.priceCents)}</p>
              </div>
              {p.description && (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
              )}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Estoque: <strong>{p.stock}</strong>
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
          <Card className="col-span-full p-12 text-center text-muted-foreground">
            Nenhum produto cadastrado ainda. Clique em "Novo produto" para começar.
          </Card>
        )}
      </div>
    </div>
  );
}
