"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { SEGMENTS, DEFAULT_SEGMENT_ID, getSegment, type SegmentId } from "@/lib/segments";

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
}: {
  segmentId: SegmentId;
  onPick: (id: SegmentId) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {SEGMENTS.map((s) => {
        const active = s.id === segmentId;
        const Icon = s.icon;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            aria-pressed={active}
            className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-[13px] font-medium transition ${
              active
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-border-strong"
            }`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : ""}`} />
            {s.shortLabel}
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
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:border-border-strong"
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
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
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
