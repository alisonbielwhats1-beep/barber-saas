"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Eye, EyeOff, MessageSquareText, Star, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ReviewSummary } from "@/lib/reviews";
import { setReviewStatus } from "./actions";

type ModerationReview = {
  id: string;
  rating: number;
  comment: string | null;
  status: string;
  createdAt: string;
  moderatedAt: string | null;
  clientName: string;
  serviceName: string;
  appointmentStartAt: string;
};

function Stars({ rating, size = "h-4 w-4" }: { rating: number; size?: string }) {
  return (
    <span role="img" className="inline-flex items-center gap-0.5" aria-label={`Nota ${rating} de 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={cn(size, index < rating ? "text-foreground" : "text-muted-foreground/50")}
          fill={index < rating ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: timezone }).format(new Date(value));
}

export function ReviewsManager({
  salonName,
  timezone,
  summary,
  reviews,
}: {
  salonName: string;
  timezone: string;
  summary: ReviewSummary;
  reviews: ModerationReview[];
}) {
  const [filter, setFilter] = useState<"ALL" | "PUBLISHED" | "HIDDEN">("ALL");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const publishedCount = reviews.filter((review) => review.status === "PUBLISHED").length;
  const hiddenCount = reviews.filter((review) => review.status === "HIDDEN").length;
  const shown = useMemo(
    () => reviews.filter((review) => filter === "ALL" || review.status === filter),
    [filter, reviews],
  );

  function moderate(review: ModerationReview) {
    const nextStatus = review.status === "PUBLISHED" ? "HIDDEN" : "PUBLISHED";
    setPendingId(review.id);
    startTransition(async () => {
      try {
        await setReviewStatus(review.id, nextStatus);
        toast(nextStatus === "HIDDEN" ? "Avaliação ocultada da vitrine." : "Avaliação publicada novamente.");
        router.refresh();
      } catch (error) {
        toast(error instanceof Error ? error.message : "Não foi possível moderar a avaliação.", "error");
      } finally {
        setPendingId(null);
      }
    });
  }

  const averageText = summary.average.toFixed(1).replace(".", ",");
  const distribution = (
    <div className="flex min-w-0 flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4">
      <div>
        <p className="text-sm font-semibold">Distribuição das notas</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Só avaliações publicadas entram na reputação do {salonName}.</p>
      </div>
      <div className="flex items-center gap-3.5 md:hidden">
        <span className="text-2xl font-semibold tabular-nums">{averageText}</span>
        <div>
          <Stars rating={Math.round(summary.average)} />
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">nota média · {summary.count} publicadas</p>
        </div>
      </div>
      <div className="space-y-2.5">
        {[5, 4, 3, 2, 1].map((rating) => {
          const amount = summary.distribution[rating as 1 | 2 | 3 | 4 | 5];
          const percent = summary.count > 0 ? (amount / summary.count) * 100 : 0;
          return (
            <div key={rating} className="flex items-center gap-3 text-sm">
              <span className="w-[30px] shrink-0 tabular-nums text-muted-foreground">{rating} <span aria-hidden="true">★</span><span className="sr-only">estrelas</span></span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--border))]">
                <div className="h-full rounded-full bg-[hsl(var(--selection-solid))]" style={{ width: `${percent}%` }} />
              </div>
              <span className="w-[22px] shrink-0 text-right tabular-nums text-muted-foreground">{amount}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <section aria-label="Indicadores das avaliações" className="hidden grid-cols-2 gap-4 md:grid lg:grid-cols-4">
        <Kpi icon={Star} tone="brand" label="Nota média" value={averageText} />
        <Kpi icon={Eye} tone="brand" label="Publicadas" value={String(summary.count)} />
        <Kpi icon={EyeOff} tone="neutral" label="Ocultas nesta lista" value={String(hiddenCount)} />
        <Kpi icon={MessageSquareText} tone="neutral" label="Comentários" value={String(reviews.filter((review) => Boolean(review.comment)).length)} />
      </section>

      <section className="hidden items-stretch gap-4 md:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {distribution}

        <div className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4">
          <div>
            <p className="text-sm font-semibold">Moderação</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Avaliações são vinculadas a visitas reais. Ocultar remove da vitrine, sem apagar o registro.</p>
          </div>
          <div role="group" aria-label="Moderação" className="overflow-hidden rounded-[14px] border border-border">
            <FilterButton active={filter === "ALL"} onClick={() => setFilter("ALL")} label={`Todas (${reviews.length})`} />
            <FilterButton active={filter === "PUBLISHED"} onClick={() => setFilter("PUBLISHED")} label={`Publicadas (${publishedCount})`} />
            <FilterButton active={filter === "HIDDEN"} onClick={() => setFilter("HIDDEN")} label={`Ocultas (${hiddenCount})`} />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3 md:hidden">
        <span className="text-sm tabular-nums text-muted-foreground">{summary.count} publicadas</span>
        <select aria-label="Filtrar avaliações" value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="ml-auto min-h-11 min-w-0 rounded-[10px] border border-border-strong bg-card px-3 text-base text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"><option value="ALL">Todas ({reviews.length})</option><option value="PUBLISHED">Publicadas ({publishedCount})</option><option value="HIDDEN">Ocultas ({hiddenCount})</option></select>
      </div>
      <section aria-label="Lista de avaliações" className="space-y-3">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-[14px] border border-dashed border-border-strong px-5 py-8 text-center">
            <span className="grid h-[46px] w-[46px] place-items-center rounded-full bg-muted text-muted-foreground"><MessageSquareText aria-hidden="true" className="h-5 w-5" /></span>
            <p className="text-sm font-medium">Nenhuma avaliação neste filtro</p>
            <p className="text-sm text-muted-foreground">As avaliações aparecem aqui após os primeiros atendimentos concluídos.</p>
          </div>
        ) : shown.map((review) => (
          <article key={review.id} className="flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-border bg-card p-4">
            <div className="flex flex-col gap-2.5 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold [overflow-wrap:anywhere]">{review.clientName}</p>
                  <span className={cn("inline-flex min-h-[22px] items-center rounded-full bg-muted px-2.5 text-xs font-medium", review.status === "PUBLISHED" ? "text-foreground" : "text-muted-foreground")}>
                    {review.status === "PUBLISHED" ? "Visível na vitrine" : "Oculta"}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {review.serviceName} · atendimento de {formatDate(review.appointmentStartAt, timezone)}
                </p>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3">
                <Stars rating={review.rating} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pendingId === review.id}
                  onClick={() => moderate(review)}
                >
                  {review.status === "PUBLISHED" ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                  {pendingId === review.id ? "Salvando…" : review.status === "PUBLISHED" ? "Ocultar" : "Publicar"}
                </Button>
              </div>
            </div>
            {review.comment ? (
              <p className="break-words text-sm leading-relaxed text-muted-foreground">“{review.comment}”</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">Cliente deixou somente a nota.</p>
            )}
          </article>
        ))}
      </section>

      <div className="space-y-3 md:hidden">
        {distribution}
        <p className="text-xs leading-relaxed text-muted-foreground">Avaliações são vinculadas a visitas reais. Ocultar remove da vitrine, sem apagar o registro.</p>
      </div>
    </div>
  );
}

const KPI_TONE = {
  brand: "bg-info/15 text-info",
  neutral: "bg-muted text-muted-foreground",
} as const;

function Kpi({ icon: Icon, tone, label, value }: { icon: LucideIcon; tone: keyof typeof KPI_TONE; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-border bg-card p-4">
      <p className="flex items-start justify-between gap-1.5 text-xs font-medium leading-snug text-muted-foreground">
        {label}
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", KPI_TONE[tone])}><Icon aria-hidden="true" className="h-4 w-4" /></span>
      </p>
      <p className="whitespace-nowrap text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-3.5 text-left text-sm tabular-nums transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "bg-[hsl(var(--border))] font-semibold text-foreground" : "font-medium text-foreground hover:bg-card-hover",
      )}
    >
      {label}
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
