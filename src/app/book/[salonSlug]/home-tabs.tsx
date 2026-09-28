"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type HomeTab = { id: string; label: string; content: ReactNode };

/**
 * Abas da home do cliente. Todos os painéis são renderizados no servidor e
 * ficam no HTML; só a visibilidade muda. Links `#<id>` em qualquer ponto da
 * página (nota, endereço) abrem a aba correspondente sem recarregar.
 */
export function HomeTabs({ tabs }: { tabs: HomeTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const barRef = useRef<HTMLDivElement>(null);
  const tabIds = tabs.map((tab) => tab.id).join(",");

  useEffect(() => {
    const ids = tabIds.split(",");
    const reveal = (id: string) => {
      setActive(id);
      const bar = barRef.current;
      if (!bar) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const top = bar.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(bar).top) || 0);
      window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
    };
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (ids.includes(id)) reveal(id);
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
      const id = link?.getAttribute("href")?.slice(1);
      if (!id || !ids.includes(id)) return;
      event.preventDefault();
      window.history.replaceState(null, "", `#${id}`);
      reveal(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      document.removeEventListener("click", onClick);
    };
  }, [tabIds]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length]!;
    setActive(next.id);
    document.getElementById(`home-tab-${next.id}`)?.focus();
  }

  return (
    <div>
      <div ref={barRef} className="client-home-tabs">
        <div role="tablist" aria-label="Informações do estabelecimento" className="client-home-tablist">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`home-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              aria-controls={`home-panel-${tab.id}`}
              tabIndex={active === tab.id ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn("client-home-tab", active === tab.id && "is-active")}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`home-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`home-tab-${tab.id}`}
          hidden={active !== tab.id}
          className="pt-4"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
