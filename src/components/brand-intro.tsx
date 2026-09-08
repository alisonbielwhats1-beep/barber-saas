"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandLogo } from "./brand";

const SESSION_KEY = "everflair:intro:flair:v2";

/** A short brand entrance, independent of authentication and data loading. */
export function BrandIntro() {
  const pathname = usePathname();
  const clientEntrances = useRef(new Set<string>());
  const clientSlug = pathname?.match(/^\/book\/([^/]+)(?:\/|$)/)?.[1];
  const eligible = Boolean(clientSlug) || pathname === "/login" ||
    /^\/(dashboard|agenda|hoje|clientes|profissionais|servicos|produtos|configuracoes|relatorios|marketing|pacotes|pagamentos)(\/|$)/.test(pathname ?? "");
  const sessionKey = eligible ? `${SESSION_KEY}:${clientSlug ? `client:${clientSlug}` : "admin"}` : null;
  // Render the client entrance in the initial HTML, before hydration can expose
  // the access screen. CSS dismisses it even when JavaScript is unavailable.
  const [visibleKey, setVisibleKey] = useState<string | null>(() => clientSlug ? sessionKey : null);

  useEffect(() => {
    if (!sessionKey) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (clientSlug) {
      // A fresh opening replays the entrance; internal navigation never does.
      if (clientEntrances.current.has(sessionKey)) return;
    } else {
      try {
        if (sessionStorage.getItem(sessionKey)) return;
      } catch {
        return;
      }
    }
    if (motion.matches) { setVisibleKey(null); return; }
    setVisibleKey(sessionKey);
    const dismiss = () => {
      setVisibleKey(null);
      if (clientSlug) clientEntrances.current.add(sessionKey);
      else try { sessionStorage.setItem(sessionKey, "seen"); } catch {}
    };
    const timeout = window.setTimeout(dismiss, clientSlug ? 2200 : 1400);
    window.addEventListener("pointerdown", dismiss, { once: true });
    window.addEventListener("keydown", dismiss, { once: true });
    motion.addEventListener("change", dismiss);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismiss);
      motion.removeEventListener("change", dismiss);
    };
  }, [sessionKey, clientSlug]);

  if (!sessionKey || visibleKey !== sessionKey) return null;
  return <div key={sessionKey} className="ef-intro" data-audience={clientSlug ? "client" : "admin"} aria-hidden="true">
    <div className="ef-intro-light" />
    {clientSlug && <div className="ef-intro-orbit" />}
    <BrandLogo decorative className="ef-intro-logo" />
  </div>;
}
