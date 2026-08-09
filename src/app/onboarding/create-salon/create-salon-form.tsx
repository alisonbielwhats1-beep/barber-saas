"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BusinessExperienceIcon } from "@/components/business-experience-icon";
import { getBusinessExperience } from "@/config/business-experience";
import {
  SegmentPicker,
  StarterServicePicker,
  useSegmentSelection,
} from "@/components/segment-service-picker";
import { createSalon } from "./actions";

export function CreateSalonForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [salonName, setSalonName] = useState("");
  const selection = useSegmentSelection();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await createSalon({
        salonName,
        segmentId: selection.segmentId,
        serviceNames: selection.serviceNames,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  const selectedCount = selection.serviceNames.length;
  const experience = getBusinessExperience(selection.segmentId);
  const servicesLabel =
    experience.terminology.services.charAt(0).toUpperCase() +
    experience.terminology.services.slice(1);

  return (
    <form
      onSubmit={onSubmit}
      data-business-experience={experience.id}
      data-experience-direction={experience.visual.direction}
      data-experience-density={experience.visual.density}
      className="experience-scope space-y-8 rounded-[inherit]"
    >
      {/* 1. Tipo de negócio */}
      <section className="experience-context-panel p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="experience-icon-surface grid h-10 w-10 shrink-0 place-items-center rounded-xl border">
            <BusinessExperienceIcon name={experience.icon} className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold">Qual é o seu tipo de negócio?</h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">
              Serve para sugerir seus serviços. Você pode cadastrar qualquer serviço
              depois, independente do que escolher aqui.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <SegmentPicker segmentId={selection.segmentId} onPick={selection.pickSegment} />
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start">
        <div className="experience-surface p-4 sm:p-5">
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
            className="mt-3 min-h-11"
          />
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
            A experiência inicial será preparada para {experience.label}, mas você poderá
            ajustar tudo depois.
          </p>
        </div>

        <div className="experience-context-panel p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold">
            {servicesLabel} para começar
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">
              {selectedCount} selecionado{selectedCount === 1 ? "" : "s"}
            </span>
          </h2>
          <div className="mt-4">
            <StarterServicePicker
              segment={selection.segment}
              isChecked={selection.isChecked}
              onToggle={selection.toggleService}
            />
          </div>
        </div>
      </section>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
          className="min-h-12 w-full rounded-full sm:ml-auto sm:w-auto sm:min-w-64"
        disabled={pending || salonName.trim().length < 2}
      >
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
