"use client";

import { useEffect, useState } from "react";
import { Check, AlertTriangle, X, Info } from "lucide-react";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; message: string; kind: ToastKind };

let counter = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** Dispara um toast de qualquer client component: `toast("Salvo", "success")`. */
export function toast(message: string, kind: ToastKind = "success") {
  const item = { id: ++counter, message, kind };
  listeners.forEach((l) => l(item));
}

const CFG: Record<ToastKind, { icon: typeof Check; color: string }> = {
  success: { icon: Check, color: "#2ECC8B" },
  error: { icon: AlertTriangle, color: "#EF4444" },
  info: { icon: Info, color: "#3B9EFF" },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const add = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 3500);
    };
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);

  function dismiss(id: number) {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[200] flex w-full max-w-xs flex-col gap-2 print:hidden">
      {items.map((t) => {
        const { icon: Icon, color } = CFG[t.kind];
        return (
          <div key={t.id} className="animate-scale-in pointer-events-auto flex items-start gap-3 rounded-xl border border-border-strong bg-elevated p-3 shadow-premium">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: `${color}1f`, color }}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <p className="flex-1 pt-0.5 text-[13px] leading-snug">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-muted-foreground transition hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
