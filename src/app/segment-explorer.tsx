"use client";

import { useState } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import { SEGMENTS, DEFAULT_SEGMENT_ID, type SegmentId } from "@/lib/segments";
import { getBusinessExperience } from "@/config/business-experience";

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
  const experience = getBusinessExperience(selectedId);

  return (
    <div
      data-business-experience={selectedId}
      data-experience-direction={experience.visual.direction}
      data-experience-density={experience.visual.density}
      className="experience-scope"
    >
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
              className={`experience-card-interactive group relative min-h-44 cursor-pointer overflow-hidden border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                active
                  ? "experience-card-selected"
                  : "border-white/10 opacity-80 hover:opacity-100"
              }`}
            >
              <div className="relative aspect-[4/5] w-full overflow-hidden">
                <Image
                  src={seg.accentImage}
                  alt={seg.label}
                  fill
                  sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px"
                  className="object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                {active && (
                  <span className="experience-accent-bg absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-3">
                <Icon className="experience-accent-text h-3.5 w-3.5 shrink-0" />
                <p className="text-[13px] font-semibold leading-tight text-white">
                  {seg.shortLabel}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Painel do segmento selecionado */}
      <div className="experience-context-panel mt-8 grid gap-8 p-6 md:grid-cols-2 md:p-8">
        <div>
          <div className="experience-icon-surface mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
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
                <Check className="experience-accent-text mt-0.5 h-4 w-4 shrink-0" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
