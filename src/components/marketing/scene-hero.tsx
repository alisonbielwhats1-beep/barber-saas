"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUpRight, Check, Flower2, Hand, Leaf, LayoutGrid, Scissors, Sparkles } from "lucide-react";
import { MARKETING_SEGMENTS, signupHref, type MarketingSegmentId } from "./segments";
import { useScenePlayback } from "./use-scene-playback";
import { RevealHeading } from "./reveal-heading";
import "./scroll-scene.css";
import "./gentle-scene.css";

const icons = [Flower2, Scissors, Hand, Sparkles, Leaf, LayoutGrid];
type Props = { segment: typeof MARKETING_SEGMENTS[number]; ready: boolean; onSelect: (id: MarketingSegmentId) => void };

export function SceneHero({ segment, ready, onSelect }: Props) {
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const playback = useScenePlayback(segment.id, onSelect, ready, stage);

  useEffect(() => {
    const scene = root.current;
    if (!scene) return;
    let frame = 0;
    function update() {
      frame = 0;
      if (!scene) return;
      const box = scene.getBoundingClientRect();
      const mobile = window.innerWidth <= 700;
      const travel = Math.max(1, box.height);
      const p = playback.reduced ? 0 : Math.max(0, Math.min(1, -box.top / travel));
      scene.style.setProperty("--scene-p", p.toFixed(4));
      scene.style.setProperty("--far-y", `${p * (mobile ? 10 : 24)}px`);
      scene.style.setProperty("--subject-y", `${p * (mobile ? -4 : -10)}px`);
      scene.style.setProperty("--near-y", `${p * (mobile ? -6 : -16)}px`);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [playback.reduced]);

  useEffect(() => {
    const media = video.current;
    if (!media) return;
    if (!playback.reduced && playback.enabled && playback.visible && !playback.hidden) {
      if (!media.getAttribute("src")) { media.src = "/images/atelier-motion.webm"; media.load(); }
      void media.play().catch(() => { /* Poster and depth remain usable when autoplay is blocked. */ });
    } else media.pause();
  }, [playback.reduced, playback.enabled, playback.visible, playback.hidden]);

  return (
    <section ref={root} className="sc-hero" aria-labelledby="hero-title" data-motion={playback.reduced ? "reduced" : "full"} data-playing={playback.enabled}>
      <div ref={stage} className="sc-stage">
        <div className="sc-environment" data-depth="far" aria-hidden="true"><Image src="/images/atelier-plate.webp" alt="" fill sizes="100vw" priority quality={85} /></div>
        <video ref={video} className="sc-atmosphere" aria-hidden="true" muted loop playsInline preload="none" tabIndex={-1} />
        <div className="sc-veil" aria-hidden="true" />
        <div className="sc-copy mk-wrap" data-depth="type">
          <p className="mk-eyebrow"><span className="mk-status-dot" /> GESTÃO PARA BELEZA E BEM-ESTAR</p>
          <RevealHeading as="h1" id="hero-title" intro lines={["Seu negócio em ordem.", "Do horário ao financeiro."]} />
          <p className="sc-lead">Agenda, equipe e financeiro em um só lugar. <br />Seu cliente agenda online. Você acompanha cada atendimento.</p>
          <div className="sc-actions"><Link href={signupHref(segment.id)} className="mk-button">Criar meu espaço <ArrowUpRight size={18} aria-hidden="true" /></Link><a href="#sistema" className="mk-text-link">Experimentar a rotina <ArrowDown size={16} aria-hidden="true" /></a></div>
          <p className="sc-quick-note"><span>Comece grátis · 1 agenda · 30 agendamentos/mês</span><a href="#planos">Comparar planos</a></p>
        </div>
        <div className="sc-segment-dock" onMouseEnter={() => playback.setInteracting(true)} onMouseLeave={event => playback.setInteracting(event.currentTarget.contains(document.activeElement))} onFocusCapture={() => playback.setInteracting(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) playback.setInteracting(matchMedia("(hover: hover)").matches && event.currentTarget.matches(":hover")); }}>
          <div className="sc-dock-meta"><span className="sc-segment-prompt" id="segment-label">Encontre o seu ambiente</span></div>
          <div className="sc-segment-row">
            <div role="group" aria-labelledby="segment-label" className="sc-segment-controls">
              {MARKETING_SEGMENTS.map((item, index) => { const Icon = icons[index]; return <button key={item.id} type="button" disabled={!ready} aria-label={item.label} aria-pressed={segment.id === item.id} onClick={() => playback.pick(item.id)}><Icon size={15} aria-hidden="true" /><span>{item.id === "salao" ? "Salão" : item.label}</span><Check size={12} className="sc-choice-check" aria-hidden="true" /></button>; })}
            </div>

          </div>
          <span className="sr-only" aria-live={playback.active ? "off" : "polite"}>{segment.label} selecionado. Atmosfera {segment.id === "barbearia" ? "escura" : "clara"}.</span>
        </div>
        <div className="sc-photo-portal" data-depth="subject">
          {MARKETING_SEGMENTS.map(item => <div key={item.id} className="sc-photo" data-active={item.id === segment.id} aria-hidden={item.id !== segment.id}><Image src={item.image} alt={item.id === segment.id ? item.alt : ""} fill sizes="(max-width: 700px) 100vw, 1000px" priority={item.id === "salao"} quality={85} style={{ objectPosition: item.position }} /></div>)}
          <div className="sc-photo-shade" aria-hidden="true" />
        </div>
        <div className="sc-foreground" data-depth="near" aria-hidden="true"><Image src="/images/atelier-glass.webp" alt="" fill sizes="100vw" priority quality={85} /></div>
        <div className="sc-floor" aria-hidden="true" />
      </div>
    </section>
  );
}
