"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, MessageSquareText, ShieldCheck, Star } from "lucide-react";
import { toast } from "@/components/ui/toast";
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

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Nota ${rating} de 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={`h-3.5 w-3.5 ${index < rating ? "text-amber-400" : "text-muted-foreground/25"}`}
          fill={index < rating ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

export function ReviewsManager({
  salonName,
  summary,
  reviews,
}: {
  salonName: string;
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

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Nota média" value={summary.average.toFixed(1).replace(".", ",")} accent="text-amber-300" />
        <Kpi label="Publicadas" value={String(summary.count)} accent="text-primary" />
        <Kpi label="Ocultas nesta lista" value={String(hiddenCount)} accent="text-muted-foreground" />
        <Kpi label="Comentários" value={String(reviews.filter((review) => Boolean(review.comment)).length)} accent="text-sky-300" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Distribuição das notas</p>
              <p className="mt-1 text-xs text-muted-foreground">Só avaliações publicadas entram na reputação do {salonName}.</p>
            </div>
            <ShieldCheck aria-hidden="true" className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-5 space-y-2.5">
            {[5, 4, 3, 2, 1].map((rating) => {
              const amount = summary.distribution[rating as 1 | 2 | 3 | 4 | 5];
              const percent = summary.count > 0 ? (amount / summary.count) * 100 : 0;
              return (
                <div key={rating} className="flex items-center gap-3 text-xs">
                  <span className="w-8 text-muted-foreground">{rating} ★</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${percent}%` }} />
                  </div>
                  <span className="w-6 text-right text-muted-foreground">{amount}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-semibold">Moderação</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Avaliações são vinculadas a visitas reais. Ocultar remove da vitrine, sem apagar o registro.</p>
          <div className="mt-4 space-y-2 text-xs">
            <FilterButton active={filter === "ALL"} onClick={() => setFilter("ALL")} label={`Todas (${reviews.length})`} />
            <FilterButton active={filter === "PUBLISHED"} onClick={() => setFilter("PUBLISHED")} label={`Publicadas (${publishedCount})`} />
            <FilterButton active={filter === "HIDDEN"} onClick={() => setFilter("HIDDEN")} label={`Ocultas (${hiddenCount})`} />
          </div>
        </div>
      </section>

      <section aria-label="Lista de avaliações" className="space-y-3">
        {shown.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-10 text-center">
            <MessageSquareText aria-hidden="true" className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Nenhuma avaliação neste filtro</p>
            <p className="mt-1 text-xs text-muted-foreground">As avaliações aparecem aqui após os primeiros atendimentos concluídos.</p>
          </div>
        ) : shown.map((review) => (
          <article key={review.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{review.clientName}</p>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${review.status === "PUBLISHED" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {review.status === "PUBLISHED" ? "Visível na vitrine" : "Oculta"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {review.serviceName} · atendimento de {formatDate(review.appointmentStartAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Stars rating={review.rating} />
                <button
                  type="button"
                  disabled={pendingId === review.id}
                  onClick={() => moderate(review)}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
                >
                  {review.status === "PUBLISHED" ? <EyeOff aria-hidden="true" className="h-3.5 w-3.5" /> : <Eye aria-hidden="true" className="h-3.5 w-3.5" />}
                  {pendingId === review.id ? "Salvando…" : review.status === "PUBLISHED" ? "Ocultar" : "Publicar"}
                </button>
              </div>
            </div>
            {review.comment ? (
              <p className="mt-4 rounded-xl bg-muted/25 p-3 text-sm leading-relaxed text-muted-foreground">“{review.comment}”</p>
            ) : (
              <p className="mt-4 text-xs italic text-muted-foreground">Cliente deixou somente a nota.</p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className={`text-2xl font-semibold tracking-tight ${accent}`}>{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-left transition ${active ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
    >
      {label}
      <span aria-hidden="true">›</span>
    </button>
  );
}
