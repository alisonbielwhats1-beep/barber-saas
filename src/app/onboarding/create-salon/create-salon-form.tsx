"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      try {
        const res = await createSalon({
          salonName,
          segmentId: selection.segmentId,
          serviceNames: selection.serviceNames,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.push("/onboarding/acesso");
        router.refresh();
      } catch {
        setError("Não foi possível concluir agora. Verifique sua conexão e tente novamente.");
      }
    });
  }

  const selectedCount = selection.serviceNames.length;

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* 1. Tipo de negócio */}
      <section>
        <h2 className="text-[15px] font-semibold">Qual é o seu tipo de negócio?</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Serve para sugerir seus serviços. Você pode cadastrar qualquer serviço
          depois, independente do que escolher aqui.
        </p>
        <div className="mt-4">
          <SegmentPicker segmentId={selection.segmentId} onPick={selection.pickSegment} />
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
        <div className="mt-4">
          <StarterServicePicker
            segment={selection.segment}
            isChecked={selection.isChecked}
            onToggle={selection.toggleService}
          />
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
            <Loader2 className="h-4 w-4 animate-spin" /> Enviando…
          </>
        ) : (
          "Enviar para aprovação"
        )}
      </Button>
    </form>
  );
}
