"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Settings2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { MAX_LAPSED_CLIENT_DAYS, MIN_LAPSED_CLIENT_DAYS } from "@/lib/marketing-settings";
import { updateMarketingSettings } from "./actions";

export function MarketingSettingsForm({
  lapsedClientDays,
  googleReviewUrl,
}: {
  lapsedClientDays: number;
  googleReviewUrl: string | null;
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
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Settings2 className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[14px] font-semibold">Regras de crescimento</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Somente o dono pode alterar. A regra vale no Marketing, CRM e Dashboard.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[180px_1fr_auto] md:items-end">
        <label className="block text-[11px] font-medium text-muted-foreground">
          Cliente vira “sumido” após
          <span className="mt-1 flex h-11 items-center rounded-xl border border-border bg-background px-3">
            <input
              type="number"
              min={MIN_LAPSED_CLIENT_DAYS}
              max={MAX_LAPSED_CLIENT_DAYS}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="w-full bg-transparent text-[14px] font-semibold text-foreground outline-none"
              aria-label="Dias para considerar cliente sumido"
            />
            <span>dias</span>
          </span>
        </label>
        <label className="block text-[11px] font-medium text-muted-foreground">
          Link para avaliação no Google (opcional)
          <input
            type="url"
            value={reviewUrl}
            onChange={(event) => setReviewUrl(event.target.value)}
            placeholder="https://g.page/r/.../review"
            className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={pending || days < MIN_LAPSED_CLIENT_DAYS || days > MAX_LAPSED_CLIENT_DAYS}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Salvar regras
        </button>
      </div>
    </section>
  );
}
