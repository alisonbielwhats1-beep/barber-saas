"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUpRight, Check, Flower2, Hand, Leaf, LayoutGrid, Scissors, Sparkles } from "lucide-react";
import { MARKETING_SEGMENTS, signupHref, type MarketingSegmentId } from "./segments";
import { useScenePlayback } from "./use-scene-playback";
import "./scroll-scene.css";

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
      const travel = Math.max(1, box.height - (stage.current?.offsetHeight ?? innerHeight));
      const p = playback.reduced ? 0 : Math.max(0, Math.min(1, (68 - box.top) / travel));
      scene.style.setProperty("--scene-p", p.toFixed(4));
      scene.dataset.open = String(p > .6); const exit = Math.max(0, Math.min(1, (p - .62) / .38)); scene.style.setProperty("--scene-exit", String(exit * exit * (3 - 2 * exit)));
      scene.style.setProperty("--far-y", `${p * 36}px`);
      scene.style.setProperty("--subject-y", `${p * (mobile ? -235 : -325)}px`);
      scene.style.setProperty("--dock-y", `${p * (mobile ? -260 : -300)}px`);
      scene.style.setProperty("--near-y", `${p * -80}px`);
      scene.style.setProperty("--copy-y", `${p * -115}px`);
      scene.style.setProperty("--copy-opacity", `${Math.max(0, 1 - p * 2.3)}`);
      scene.style.setProperty("--subject-scale", `${1 + p * (mobile ? .08 : .23)}`);
      scene.style.setProperty("--near-scale", `${1 + p * .18}`);
      scene.style.setProperty("--caption-opacity", `${Math.max(0, Math.min(1, (p - .45) * 3))}`);
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
          <h1 id="hero-title">Seu talento merece<br /><span>um novo espaço.</span></h1>
          <p className="sc-lead">Agenda, clientes, equipe e financeiro.<br />Seu negócio em ordem. Seu talento em movimento.</p>
          <div className="sc-actions"><Link href={signupHref(segment.id)} className="mk-button">Criar meu estabelecimento <ArrowUpRight size={18} aria-hidden="true" /></Link><a href="#sistema" className="mk-text-link">Explore o sistema <ArrowDown size={16} aria-hidden="true" /></a></div>
        </div>
        <div className="sc-segment-dock" onMouseEnter={() => playback.setInteracting(true)} onMouseLeave={event => playback.setInteracting(event.currentTarget.contains(document.activeElement))} onFocusCapture={() => playback.setInteracting(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) playback.setInteracting(matchMedia("(hover: hover)").matches && event.currentTarget.matches(":hover")); }}>
          <div className="sc-dock-meta"><span className="sc-segment-prompt" id="segment-label">Encontre o seu ambiente</span><label className="sc-motion-setting"><input type="checkbox" checked={!playback.enabled} onChange={playback.toggle} disabled={!ready} />Pausar movimento</label></div>
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
        <div className="sc-resolved"><span>{segment.label}</span><p>{segment.line}</p><span aria-hidden="true"><ArrowDown size={20} /></span></div>
        <span className="sc-scroll-cue" aria-hidden="true"><ArrowDown size={13} /> ROLE PARA ABRIR SEU ESPAÇO</span>
      </div>
    </section>
  );
}
