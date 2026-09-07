"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandLogo } from "./brand";

const SESSION_KEY = "everflair:intro:flair:v2";

/** A short brand entrance, independent of authentication and data loading. */
export function BrandIntro() {
  const pathname = usePathname();
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  const clientSlug = pathname?.match(/^\/book\/([^/]+)(?:\/|$)/)?.[1];
  const eligible = Boolean(clientSlug) || pathname === "/login" ||
    /^\/(dashboard|agenda|hoje|clientes|profissionais|servicos|produtos|configuracoes|relatorios|marketing|pacotes|pagamentos)(\/|$)/.test(pathname ?? "");
  const sessionKey = eligible ? `${SESSION_KEY}:${clientSlug ? `client:${clientSlug}` : "admin"}` : null;

  useEffect(() => {
    if (!sessionKey) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    try {
      if (sessionStorage.getItem(sessionKey)) return;
    } catch {
      // Storage disabled: do not interrupt the user's navigation with an intro.
      return;
    }
    if (motion.matches) return;
    setVisibleKey(sessionKey);
    const dismiss = () => {
      setVisibleKey(null);
      try { sessionStorage.setItem(sessionKey, "seen"); } catch {}
    };
    const timeout = window.setTimeout(dismiss, 1400);
    window.addEventListener("pointerdown", dismiss, { once: true });
    window.addEventListener("keydown", dismiss, { once: true });
    motion.addEventListener("change", dismiss);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismiss);
      motion.removeEventListener("change", dismiss);
    };
  }, [sessionKey]);

  if (!sessionKey || visibleKey !== sessionKey) return null;
  return <div key={sessionKey} className="ef-intro" data-audience={clientSlug ? "client" : "admin"} aria-hidden="true">
    <div className="ef-intro-light" />
    <BrandLogo decorative className="ef-intro-logo" />
  </div>;
}
