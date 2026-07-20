"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Carrinho client-side, persistido em localStorage por slug do salão.
 * Cada slug tem seu próprio carrinho (não vaza entre salões).
 *
 * Não é seguro pra checkout online — validação de disponibilidade e preço
 * acontece no server ao criar o Appointment. É apenas UI/UX.
 */

export type CartItem = {
  productId: string;
  name: string;
  priceCents: number;
  imageUrl: string;
  quantity: number;
};

type Cart = { items: CartItem[] };

const KEY = (slug: string) => `salon-cart:${slug}`;

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

function read(slug: string): Cart {
  if (typeof window === "undefined") return { items: [] };
  try {
    return JSON.parse(localStorage.getItem(KEY(slug)) ?? "") ?? { items: [] };
  } catch {
    return { items: [] };
  }
}

function write(slug: string, cart: Cart) {
  localStorage.setItem(KEY(slug), JSON.stringify(cart));
  emit();
}

export function useCart(slug: string) {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);
  const getSnapshot = useCallback(() => {
    const raw = typeof window === "undefined" ? "" : localStorage.getItem(KEY(slug)) ?? "";
    return raw;
  }, [slug]);
  const getServerSnapshot = () => "";

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const cart: Cart = (() => {
    try { return JSON.parse(raw) ?? { items: [] }; }
    catch { return { items: [] }; }
  })();

  // Sync via storage event (multi-tab)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === KEY(slug)) emit();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [slug]);

  const add = useCallback(
    (item: Omit<CartItem, "quantity">, qty = 1) => {
      const c = read(slug);
      const existing = c.items.find((i) => i.productId === item.productId);
      if (existing) existing.quantity += qty;
      else c.items.push({ ...item, quantity: qty });
      write(slug, c);
    },
    [slug],
  );

  const remove = useCallback((productId: string) => {
    const c = read(slug);
    c.items = c.items.filter((i) => i.productId !== productId);
    write(slug, c);
  }, [slug]);

  const setQuantity = useCallback((productId: string, qty: number) => {
    const c = read(slug);
    const item = c.items.find((i) => i.productId === productId);
    if (!item) return;
    if (qty <= 0) c.items = c.items.filter((i) => i.productId !== productId);
    else item.quantity = qty;
    write(slug, c);
  }, [slug]);

  const clear = useCallback(() => write(slug, { items: [] }), [slug]);

  const count = cart.items.reduce((s, i) => s + i.quantity, 0);
  const totalCents = cart.items.reduce((s, i) => s + i.quantity * i.priceCents, 0);

  return { items: cart.items, count, totalCents, add, remove, setQuantity, clear };
}
