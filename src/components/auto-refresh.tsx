"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Fallback sem custo para consistência entre telas enquanto o projeto não
 * possui um cliente Supabase Realtime seguro no navegador.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(refresh, intervalMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [intervalMs, router]);

  return null;
}
