"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { BRAND_LETTERS, BRAND_PETALS, BRAND_SPARK, BrandLogo } from "./brand";

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
    const timeout = window.setTimeout(dismiss, clientSlug ? 2500 : 1400);
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
  if (clientSlug) return <ClientEntrance key={sessionKey} />;
  return <div key={sessionKey} className="ef-intro" data-audience="admin" aria-hidden="true">
    <div className="ef-intro-light" />
    <BrandLogo decorative className="ef-intro-logo" />
  </div>;
}

/**
 * Abertura do cliente, "do ícone ao app": o ícone violeta cresce até ocupar a
 * tela, as pétalas abrem espaço, o nome entra letra a letra, o brilho pousa no
 * "i" e o violeta se recolhe numa íris até o brilho, revelando o app.
 */
function ClientEntrance() {
  const clipId = useId();
  const petals = (
    <>
      <path d={BRAND_PETALS.top} />
      <path className="efx-petal-b" d={BRAND_PETALS.bottom} />
    </>
  );
  return <div className="ef-intro efx" data-audience="client" aria-hidden="true">
    <div className="efx-base" />
    <div className="efx-tile" />
    <div className="efx-iris"><div className="efx-sweep" /></div>
    <svg className="efx-petals efx-ghost efx-ghost-2" viewBox="137.7 161.5 166.4 189.1">{petals}</svg>
    <svg className="efx-petals efx-ghost" viewBox="137.7 161.5 166.4 189.1">{petals}</svg>
    <svg className="efx-petals" viewBox="137.7 161.5 166.4 189.1">{petals}</svg>
    <svg className="efx-word" viewBox="134 158 756 196">
      <defs><clipPath id={clipId}><rect x="340" y="150" width="560" height="162" /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        {BRAND_LETTERS.map((d, index) => <path key={index} className="efx-ltr" style={{ "--i": index } as CSSProperties} d={d} />)}
      </g>
    </svg>
    <svg className="efx-spark" viewBox="134 158 756 196">
      <circle className="efx-ring" cx="820.2" cy="201" r="22" />
      <path className="efx-flash" d={BRAND_SPARK} />
      <g className="efx-star-out"><path className="efx-star" d={BRAND_SPARK} /></g>
    </svg>
  </div>;
}
