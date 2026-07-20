"use client";

import Image from "next/image";
import { Plus, Check } from "lucide-react";
import { useCart } from "@/lib/cart";
import { formatMoney } from "@/lib/utils";

type Product = {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  priceCents: number;
  stock: number;
  imageUrl: string;
};

export function ProductList({
  salonSlug,
  products,
  currency,
}: {
  salonSlug: string;
  products: Product[];
  currency: string;
}) {
  const { items, add } = useCart(salonSlug);
  const inCart = new Set(items.map((i) => i.productId));

  return (
    <div className="grid grid-cols-2 gap-3">
      {products.map((p) => {
        const added = inCart.has(p.id);
        const soldOut = p.stock === 0;
        return (
          <article
            key={p.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
          >
            <div className="relative aspect-square w-full">
              <Image
                src={p.imageUrl}
                alt={p.name}
                fill
                sizes="45vw"
                className="object-cover"
              />
              {soldOut && (
                <div className="absolute inset-0 grid place-items-center bg-background/70 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Esgotado
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
              {p.brand && (
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {p.brand}
                </p>
              )}
              <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
              <p className="mt-auto flex items-center justify-between">
                <span className="text-sm font-semibold text-primary">
                  {formatMoney(p.priceCents, currency)}
                </span>
                <button
                  disabled={soldOut}
                  onClick={() =>
                    add({
                      productId: p.id,
                      name: p.name,
                      priceCents: p.priceCents,
                      imageUrl: p.imageUrl,
                    })
                  }
                  className={`grid h-8 w-8 place-items-center rounded-full transition ${
                    added
                      ? "bg-primary/20 text-primary"
                      : "bg-primary text-primary-foreground"
                  } disabled:opacity-30`}
                  aria-label="Adicionar ao carrinho"
                >
                  {added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </button>
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
