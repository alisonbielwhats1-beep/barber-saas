"use client";

import { useState } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import { SEGMENTS, DEFAULT_SEGMENT_ID, type SegmentId } from "@/lib/segments";

const LANDING_SEGMENT_IMAGES: Record<SegmentId, string> = {
  barbearia: "/images/salon-hero-barber-v2-hq.png",
  "salao-beleza": "/images/salon-hero-stylist-v2-hq.png",
  "manicure-nail": "/images/salon-hero-manicure-v1-hq.png",
  "estetica-bemestar": "/images/salon-hero-massage-v2-hq.png",
  "espaco-misto": "/images/salon-hero-aesthetics-v2-hq.png",
};

const LANDING_SEGMENT_LABELS: Partial<Record<SegmentId, string>> = {
  "espaco-misto": "Multisserviços",
};

const LANDING_SEGMENT_POSITIONS: Partial<Record<SegmentId, string>> = {
  barbearia: "object-[64%_center]",
  "salao-beleza": "object-[56%_center]",
  "manicure-nail": "object-center",
  "estetica-bemestar": "object-[55%_center]",
  "espaco-misto": "object-center",
};

/**
 * Seletor "Qual é o seu tipo de negócio?" + recursos por segmento, unidos
 * num só componente client para compartilhar o estado da seleção sem
 * precisar de contexto entre seções distantes da página (server component).
 *
 * Troca de segmento é só apresentação local (useState) — não persiste em
 * lugar nenhum e não limita o que aparece nas demais seções da homepage.
 */
export function SegmentExplorer() {
  const [selectedId, setSelectedId] = useState<SegmentId>(DEFAULT_SEGMENT_ID);
  const selected = SEGMENTS.find((s) => s.id === selectedId) ?? SEGMENTS[0];
  const selectedLabel = LANDING_SEGMENT_LABELS[selected.id] ?? selected.shortLabel;
  const selectedIndex = SEGMENTS.findIndex((segment) => segment.id === selected.id);

  return (
    <div>
      <div className="landing-scrollbar-hidden -mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-3 scroll-px-6 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-5">
        {SEGMENTS.map((seg) => {
          const active = seg.id === selectedId;
          const Icon = seg.icon;
          const displayLabel = LANDING_SEGMENT_LABELS[seg.id] ?? seg.shortLabel;
          return (
            <button
              key={seg.id}
              type="button"
              onClick={() => setSelectedId(seg.id)}
              aria-pressed={active}
              aria-label={`Ver recursos para ${displayLabel}`}
              className={`group relative w-[74vw] max-w-[280px] shrink-0 snap-start overflow-hidden rounded-2xl border bg-card text-left transition-[border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:w-auto md:max-w-none md:shrink md:snap-none ${
                active
                  ? "border-primary/80 shadow-[0_18px_38px_-30px_rgba(22,130,99,0.7)]"
                  : "border-border hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_18px_36px_-30px_rgba(23,32,28,0.45)]"
              }`}
            >
              <div className="relative aspect-[5/4] w-full overflow-hidden md:aspect-[4/5]">
                <Image
                  src={LANDING_SEGMENT_IMAGES[seg.id]}
                  alt={`${displayLabel}: atendimento profissional`}
                  fill
                  quality={95}
                  sizes="(max-width: 767px) 420px, (max-width: 1023px) 600px, 560px"
                  className={`object-cover transition-transform duration-300 group-hover:scale-[1.03] ${LANDING_SEGMENT_POSITIONS[seg.id] ?? "object-center"}`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/5" />
                {active && (
                  <span className="absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-full border border-white/35 bg-primary text-primary-foreground shadow-sm">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-3">
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                <p className="text-sm font-semibold leading-tight text-white md:text-[13px]">
                  {displayLabel}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground md:hidden">
        <span>Deslize para conhecer outros segmentos</span>
        <span className="tabular-nums" aria-live="polite">
          {selectedIndex + 1}/{SEGMENTS.length}
        </span>
      </div>

      {/* Painel do segmento selecionado */}
      <div
        key={selected.id}
        role="region"
        aria-live="polite"
        aria-atomic="true"
        className="animate-segment-panel mt-8 grid gap-8 rounded-3xl border border-border bg-card p-6 shadow-[0_24px_55px_-42px_rgba(29,50,40,0.6)] md:min-h-[286px] md:grid-cols-[0.95fr_1.05fr] md:p-8"
      >
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            Segmento selecionado
          </p>
          <h3 className="flex items-center gap-2 font-display text-2xl tracking-[-0.025em]">
            <selected.icon className="h-4 w-4 text-primary" />
            {selectedLabel}
          </h3>
          <p className="mt-3 max-w-lg leading-relaxed text-muted-foreground">{selected.description}</p>

          <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
            Exemplos de serviço
          </p>
          <div className="flex flex-wrap gap-2">
            {selected.exampleServices.map((s) => (
              <span
                key={s.name}
                className="rounded-full border border-border bg-background/40 px-3 py-1 text-xs text-foreground"
              >
                {s.name}
              </span>
            ))}
          </div>
        </div>

        <div className="md:border-l md:border-border md:pl-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
            O que você organiza em um só lugar
          </p>
          <ul className="space-y-2.5">
            {selected.highlights.map((h) => (
              <li key={h} className="flex items-start gap-2.5 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
