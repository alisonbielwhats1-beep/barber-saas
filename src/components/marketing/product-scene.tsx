"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { AgendaDevices } from "./agenda-devices";
import { RevealHeading } from "./reveal-heading";
import type { MarketingSegmentId } from "./segments";

export function ProductScene({ children, segmentId }: { children: ReactNode; segmentId: MarketingSegmentId }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = root.current;
    if (!section) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    function update() {
      frame = 0;
      if (!section) return;
      const top = section.getBoundingClientRect().top;
      const p = media.matches ? 1 : Math.max(0, Math.min(1, (innerHeight - top) / (innerHeight * 1.15)));
      section.style.setProperty("--product-tilt", `${(1 - p) * 2}deg`);
      section.style.setProperty("--product-rise", `${(1 - p) * 16}px`);
      section.style.setProperty("--product-scale", `${.985 + p * .015}`);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    media.addEventListener("change", schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); media.removeEventListener("change", schedule); };
  }, []);
  return <section ref={root} id="sistema" className="sc-product-section" aria-labelledby="product-title"><div className="mk-wrap">
    <div className="sc-product-heading"><p className="mk-eyebrow">AGENDA E EQUIPE</p><RevealHeading id="product-title" lines={["Saiba quem atende.", "E o que vem a seguir."]} /><p>Siga uma reserva do aplicativo do cliente até o registro financeiro. Clique nas etapas e veja o que muda na operação.</p></div>
    <AgendaDevices segmentId={segmentId} />
    {children}
  </div></section>;
}
