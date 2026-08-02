"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEGMENTS, DEFAULT_SEGMENT_ID, type SegmentId } from "@/lib/segments";
import { createSalon } from "./actions";

export function CreateSalonForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState<SegmentId>(DEFAULT_SEGMENT_ID);
  const [salonName, setSalonName] = useState("");

  const segment = SEGMENTS.find((s) => s.id === segmentId) ?? SEGMENTS[0];

  // Sugestões vêm pré-marcadas, mas o dono decide o que entra: o briefing é
  // explícito em não cadastrar serviço sem autorização dele.
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const isChecked = (name: string) => !unchecked.has(name);

  function toggle(name: string) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function pickSegment(id: SegmentId) {
    setSegmentId(id);
    setUnchecked(new Set()); // sugestões do novo segmento entram todas marcadas
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const serviceNames = segment.exampleServices
      .map((s) => s.name)
      .filter(isChecked);

    startTransition(async () => {
      const res = await createSalon({ salonName, segmentId, serviceNames });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  const selectedCount = segment.exampleServices.filter((s) => isChecked(s.name)).length;

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* 1. Tipo de negócio */}
      <section>
        <h2 className="text-[15px] font-semibold">Qual é o seu tipo de negócio?</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Serve para sugerir seus serviços. Você pode cadastrar qualquer serviço
          depois, independente do que escolher aqui.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SEGMENTS.map((s) => {
            const active = s.id === segmentId;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => pickSegment(s.id)}
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
      </section>

      {/* 2. Nome */}
      <section>
        <label htmlFor="salonName" className="text-[15px] font-semibold">
          Nome do estabelecimento
        </label>
        <Input
          id="salonName"
          value={salonName}
          onChange={(e) => setSalonName(e.target.value)}
          placeholder="Studio Martinelli"
          required
          minLength={2}
          className="mt-3"
        />
      </section>

      {/* 3. Serviços sugeridos */}
      <section>
        <h2 className="text-[15px] font-semibold">
          Serviços para começar
          <span className="ml-2 text-[12px] font-normal text-muted-foreground">
            {selectedCount} selecionado{selectedCount === 1 ? "" : "s"}
          </span>
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Desmarque o que você não faz. Os preços ficam em branco — você define
          cada um depois, em Serviços.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {segment.exampleServices.map((s) => {
            const checked = isChecked(s.name);
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => toggle(s.name)}
                aria-pressed={checked}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                  checked
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card opacity-60"
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
      </section>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending || salonName.trim().length < 2}>
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Criando…
          </>
        ) : (
          "Criar estabelecimento"
        )}
      </Button>
    </form>
  );
}
