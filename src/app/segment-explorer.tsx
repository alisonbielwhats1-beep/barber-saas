"use client";

import { useState } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import { SEGMENTS, DEFAULT_SEGMENT_ID, type SegmentId } from "@/lib/segments";

const LANDING_SEGMENT_IMAGES: Record<SegmentId, string> = {
  barbearia: "/images/salon-hero-barber-v2.webp",
  "salao-beleza": "/images/salon-hero-stylist-v2.webp",
  "manicure-nail": "/images/salon-hero-manicure-v1.webp",
  "estetica-bemestar": "/images/salon-hero-massage-v2.webp",
  "espaco-misto": "/images/salon-hero-aesthetics-v2.webp",
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

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SEGMENTS.map((seg) => {
          const active = seg.id === selectedId;
          const Icon = seg.icon;
          return (
            <button
              key={seg.id}
              onClick={() => setSelectedId(seg.id)}
              aria-pressed={active}
              aria-label={`Ver recursos para ${seg.label}`}
              className={`group relative overflow-hidden rounded-2xl border text-left transition-[border-color,box-shadow,transform] duration-300 ${
                active
                  ? "border-primary/70 ring-2 ring-primary/35"
                  : "border-border hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg"
              }`}
            >
              <div className="relative aspect-[4/5] w-full overflow-hidden">
                <Image
                  src={LANDING_SEGMENT_IMAGES[seg.id]}
                  alt={seg.label}
                  fill
                  quality={95}
                  sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px"
                  className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                {active && (
                  <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-3">
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                <p className="text-[13px] font-semibold leading-tight text-white">
                  {seg.shortLabel}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Painel do segmento selecionado */}
      <div
        key={selected.id}
        className="animate-segment-panel mt-8 grid gap-8 rounded-3xl border border-border bg-card p-6 shadow-[0_24px_55px_-42px_rgba(29,50,40,0.6)] md:grid-cols-2 md:p-8"
      >
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <selected.icon className="h-3.5 w-3.5" />
            {selected.label}
          </div>
          <p className="text-muted-foreground">{selected.description}</p>

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

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
            O que a plataforma resolve para esse tipo de negócio
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
