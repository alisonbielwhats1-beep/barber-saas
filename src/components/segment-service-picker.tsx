"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Check, ChevronDown } from "lucide-react";
import { SEGMENTS, DEFAULT_SEGMENT_ID, getSegment, type SegmentId } from "@/lib/segments";
import { getBusinessExperience } from "@/config/business-experience";
import { BusinessExperienceIcon } from "@/components/business-experience-icon";
import { cn } from "@/lib/utils";

/**
 * Escolha de segmento e dos serviços iniciais, compartilhada por `/signup` e
 * `/onboarding/create-salon`.
 *
 * As duas telas pedem a mesma coisa, e manter duas cópias da UI foi o que
 * deixou o onboarding com um seletor que ninguém alcançava enquanto o cadastro
 * real não perguntava nada.
 */

export function useSegmentSelection() {
  const [segmentId, setSegmentId] = useState<SegmentId>(DEFAULT_SEGMENT_ID);
  // Guardamos o que foi DESMARCADO: assim as sugestões de um segmento recém
  // escolhido já entram todas marcadas, sem precisar recalcular a lista.
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const segment = getSegment(segmentId);

  const serviceNames = useMemo(
    () => segment.exampleServices.map((s) => s.name).filter((n) => !unchecked.has(n)),
    [segment, unchecked],
  );

  return {
    segmentId,
    segment,
    serviceNames,
    isChecked: (name: string) => !unchecked.has(name),
    pickSegment(id: SegmentId) {
      setSegmentId(id);
      setUnchecked(new Set());
    },
    toggleService(name: string) {
      setUnchecked((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    },
  };
}

export function SegmentPicker({
  segmentId,
  onPick,
  compact = false,
}: {
  segmentId: SegmentId | null;
  onPick: (id: SegmentId) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        compact
          ? "-mx-1 flex min-w-0 max-w-full snap-x gap-3 overflow-x-auto px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5",
      )}
    >
      {SEGMENTS.map((s) => {
        const active = s.id === segmentId;
        const experience = getBusinessExperience(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            aria-pressed={active}
            data-business-experience={s.id}
            className={cn(
              "experience-card-interactive group relative overflow-hidden border bg-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              compact ? "w-40 shrink-0 snap-start" : "min-h-44",
              active ? "experience-card-selected" : "border-border",
            )}
          >
            <span className="relative block aspect-[16/9] overflow-hidden bg-muted lg:aspect-[4/3]">
              <Image
                src={experience.imagery.accentImage}
                alt=""
                fill
                sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 20vw"
                className="object-cover transition duration-300 motion-safe:group-hover:scale-[1.035]"
                style={{ objectPosition: experience.imagery.objectPosition }}
              />
              <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/5" />
              <span className="experience-icon-surface absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-xl border backdrop-blur-md">
                <BusinessExperienceIcon name={experience.icon} className="h-[18px] w-[18px]" />
              </span>
              {active && (
                <span
                  className="experience-accent-bg absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full shadow-lg"
                  aria-hidden="true"
                >
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
              )}
              <span className="absolute inset-x-3 bottom-3">
                <span className="block text-[15px] font-semibold tracking-tight text-white">
                  {s.shortLabel}
                </span>
                {!compact && (
                  <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-white/75">
                    {experience.personality}
                  </span>
                )}
              </span>
            </span>
            {!compact && <span className="flex min-h-12 items-center justify-between gap-2 px-3 py-2.5">
              <span className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                {s.description}
              </span>
              <span
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full border",
                  active
                    ? "experience-accent-bg border-transparent"
                    : "border-border-strong bg-transparent",
                )}
              />
            </span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Lista de serviços sugeridos, pré-marcados.
 *
 * `collapsible` existe para o cadastro: lá o seletor divide espaço com nome,
 * e-mail e senha, e abrir seis linhas de serviço empurraria o botão de enviar
 * para fora da tela. Fechado, o resumo continua declarando o que será criado —
 * o dono confirma ao enviar e pode abrir para ajustar.
 */
export function StarterServicePicker({
  segment,
  isChecked,
  onToggle,
  collapsible = false,
}: {
  segment: ReturnType<typeof getSegment>;
  isChecked: (name: string) => boolean;
  onToggle: (name: string) => void;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const selected = segment.exampleServices.filter((s) => isChecked(s.name)).length;

  return (
    <div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 text-[13px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {selected} serviço{selected === 1 ? "" : "s"} de {segment.shortLabel}
            </span>{" "}
            para começar
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`}
          />
        </button>
      )}

      {open && (
        <>
          <p className={`text-[13px] text-muted-foreground ${collapsible ? "mt-3" : ""}`}>
            Desmarque o que você não faz. Os preços ficam em branco — você define
            cada um depois, em Serviços.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {segment.exampleServices.map((s) => {
              const checked = isChecked(s.name);
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => onToggle(s.name)}
                  aria-pressed={checked}
                  className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    checked ? "border-primary/40 bg-primary/5" : "border-border bg-card opacity-60"
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border-strong"
                    }`}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{s.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {s.durationMin} min
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
