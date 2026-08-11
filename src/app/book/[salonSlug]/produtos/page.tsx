import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { CartBadge } from "../cart-badge";
import { ProductList } from "./product-list";
import { resolveProductImage } from "@/lib/images";

export default async function ClientProdutos({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  const salon = await withSalonBySlug(salonSlug, (tx, salonId) =>
    tx.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        name: true,
        currency: true,
        products: {
          where: { active: true },
          orderBy: [{ stock: "desc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            description: true,
            brand: true,
            category: true,
            priceCents: true,
            stock: true,
            imageUrl: true,
          },
        },
      },
    }),
  );
  if (!salon) notFound();

  const products = salon.products.map((p, i) => ({
    ...p,
    imageUrl: resolveProductImage({
      imageUrl: p.imageUrl,
      name: p.name,
      category: p.category,
      index: i,
    }),
  }));

  return (
    <main className="animate-fade-in space-y-6 px-5 pt-6">
      <header className="flex items-center gap-3">
        <Link
          href={`/book/${salonSlug}`}
          className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Loja
          </p>
          <p className="text-sm font-semibold">Produtos que amamos</p>
        </div>
        <CartBadge salonSlug={salonSlug} />
      </header>

      <ProductList salonSlug={salonSlug} products={products} currency={salon.currency} />

      {products.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Ainda sem produtos publicados.
        </div>
      )}

    </main>
  );
}
