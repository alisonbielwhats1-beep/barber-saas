"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { MAX_LAPSED_CLIENT_DAYS, MIN_LAPSED_CLIENT_DAYS } from "@/lib/marketing-settings";
import { updateMarketingSettings } from "./actions";

export function MarketingSettingsForm({
  lapsedClientDays,
  googleReviewUrl,
  disabled = false,
}: {
  lapsedClientDays: number;
  googleReviewUrl: string | null;
  disabled?: boolean;
}) {
  const [days, setDays] = useState(lapsedClientDays);
  const [reviewUrl, setReviewUrl] = useState(googleReviewUrl ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateMarketingSettings({
        lapsedClientDays: days,
        googleReviewUrl: reviewUrl,
      });
      if (!result.success) {
        toast(result.error, "error");
        return;
      }
      toast("Configurações de marketing salvas");
    });
  }

  return (
    <section className="space-y-3.5 rounded-[14px] border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-muted text-foreground">
          <Settings2 aria-hidden="true" className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Regras de crescimento</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Somente o dono pode alterar. A regra vale no Marketing, CRM e Dashboard.</p>
        </div>
      </div>

      <div className="grid gap-3.5 md:grid-cols-[200px_minmax(0,1fr)_auto] md:items-end md:gap-4">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">Cliente vira “sumido” após</span>
          <span className="flex min-h-11 items-stretch overflow-hidden rounded-[10px] border border-border-strong bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25 lg:min-h-10">
            <input
              type="number"
              min={MIN_LAPSED_CLIENT_DAYS}
              max={MAX_LAPSED_CLIENT_DAYS}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              disabled={disabled}
              className="w-full min-w-0 bg-transparent px-3 text-base font-semibold tabular-nums text-foreground outline-none disabled:opacity-50 lg:text-sm"
              aria-label="Dias para considerar cliente sumido"
            />
            <span aria-hidden="true" className="grid place-items-center border-l border-border-strong px-3 text-sm text-muted-foreground">dias</span>
          </span>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">Link para avaliação no Google (opcional)</span>
          <input
            type="url"
            value={reviewUrl}
            onChange={(event) => setReviewUrl(event.target.value)}
            disabled={disabled}
            placeholder="https://g.page/r/.../review"
            className="min-h-11 w-full min-w-0 rounded-[10px] border border-border-strong bg-background px-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-50 lg:min-h-10 lg:text-sm"
          />
        </label>
        <Button
          type="button"
          onClick={save}
          disabled={disabled || pending || days < MIN_LAPSED_CLIENT_DAYS || days > MAX_LAPSED_CLIENT_DAYS}
          className="lg:min-h-10"
        >
          {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}
          Salvar regras
        </Button>
      </div>
    </section>
  );
}
