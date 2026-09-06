"use client";
import { useEffect, useRef } from "react";

const words = "Do horário reservado ao atendimento concluído. Do cliente que chega ao convite para voltar. Cada etapa merece estar conectada.".split(" ");

export function ScrollNarrative() {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!root.current) return;
      const box = root.current.getBoundingClientRect();
      const progress = media.matches ? 1 : Math.max(0,Math.min(1,(innerHeight * .85 - box.top) / (box.height + innerHeight * .1)));
      root.current.querySelectorAll<HTMLElement>(".sc-word").forEach((el,index) => { el.dataset.lit = String(index / words.length <= progress); });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update(); window.addEventListener("scroll",schedule,{passive:true}); media.addEventListener("change",schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll",schedule); media.removeEventListener("change",schedule); };
  },[]);
  return <section ref={root} className="sc-narrative mk-wrap" aria-label="Uma rotina bem cuidada"><p>{words.map((word,index) => <span key={index} className="sc-word">{word}{" "}</span>)}</p></section>;
}
