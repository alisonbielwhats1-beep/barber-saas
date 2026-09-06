"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandLogo } from "./brand";

const SESSION_KEY = "everflair:intro:v1";

/** A short brand entrance, independent of authentication and data loading. */
export function BrandIntro() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const eligible = pathname?.startsWith("/book/") || pathname === "/login" ||
    /^\/(dashboard|agenda|hoje|clientes|profissionais|servicos|produtos|configuracoes|relatorios|marketing|pacotes|pagamentos)(\/|$)/.test(pathname ?? "");

  useEffect(() => {
    if (!eligible) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      // Storage disabled: do not interrupt the user's navigation with an intro.
      return;
    }
    if (motion.matches) return;
    setVisible(true);
    const dismiss = () => {
      setVisible(false);
      try { sessionStorage.setItem(SESSION_KEY, "seen"); } catch {}
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
  }, [eligible]);

  if (!visible || !eligible) return null;
  return <div className="ef-intro" aria-hidden="true">
    <div className="ef-intro-light" />
    <BrandLogo decorative className="ef-intro-logo" />
  </div>;
}
