"use client";
import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";

export function ProductScene({ children }: { children: ReactNode }) {
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
    <div className="sc-product-heading"><p className="mk-eyebrow">O ESPAÇO DO SEU NEGÓCIO</p><h2 id="product-title">Uma rotina mais clara.<br /><span>Em todos os sentidos.</span></h2><p>Encontre seus horários, organize a equipe e acompanhe a operação. Tudo começa com uma boa visão do dia.</p></div>
    <figure className="sc-product-art"><Image src="/images/product-agenda-refined.webp" width={1568} height={1002} alt="Agenda diária ilustrativa com profissionais em colunas, clientes fictícios, serviços, horários e status de atendimento" sizes="(max-width: 700px) 100vw, 1120px" /><figcaption>Prévia ilustrativa da agenda · nomes e valores de demonstração.<a href="/images/product-agenda-refined.webp" target="_blank" rel="noreferrer" aria-label="Ampliar agenda em nova aba">Ampliar agenda ↗</a></figcaption></figure>
    {children}
  </div></section>;
}
