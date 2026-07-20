"use client";

import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, Trash2, ArrowRight, ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart";
import { formatMoney } from "@/lib/utils";

export function CartView({ salonSlug }: { salonSlug: string }) {
  const { items, totalCents, setQuantity, remove } = useCart(salonSlug);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-10 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
          <ShoppingBag className="h-6 w-6" />
        </div>
        <p className="text-sm text-muted-foreground">Seu carrinho está vazio.</p>
        <Link
          href={`/book/${salonSlug}/produtos`}
          className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
        >
          Ver produtos
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {items.map((it) => (
          <div
            key={it.productId}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
          >
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
              <Image src={it.imageUrl} alt={it.name} fill sizes="64px" className="object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-medium">{it.name}</p>
              <p className="mt-1 text-sm font-semibold text-primary">
                {formatMoney(it.priceCents * it.quantity)}
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-border bg-background px-1 py-1">
              <button
                onClick={() => setQuantity(it.productId, it.quantity - 1)}
                className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                aria-label="Diminuir"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="min-w-5 text-center text-sm font-medium">{it.quantity}</span>
              <button
                onClick={() => setQuantity(it.productId, it.quantity + 1)}
                className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                aria-label="Aumentar"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <button
              onClick={() => remove(it.productId)}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:text-destructive"
              aria-label="Remover"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Subtotal produtos</span>
          <span className="text-lg font-semibold text-foreground">{formatMoney(totalCents)}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Você retira e paga no atendimento — sem cobrança agora.
        </p>
      </div>

      <Link
        href={`/book/${salonSlug}/agendar`}
        className="mb-6 flex items-center justify-between rounded-full bg-primary px-6 py-4 text-base font-semibold text-primary-foreground"
      >
        Ir para agendamento
        <ArrowRight className="h-5 w-5" />
      </Link>
    </>
  );
}
