"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart";

export function CartBadge({ salonSlug }: { salonSlug: string }) {
  const { count } = useCart(salonSlug);
  return (
    <Link
      href={`/book/${salonSlug}/carrinho`}
      className="relative grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground"
      aria-label={`Carrinho ${count} itens`}
    >
      <ShoppingBag className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {count}
        </span>
      )}
    </Link>
  );
}
