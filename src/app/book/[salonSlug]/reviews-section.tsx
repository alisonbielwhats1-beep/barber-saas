import Link from "next/link";
import { CheckCircle2, ChevronRight, MessageSquareQuote, Star } from "lucide-react";
import type { PublicReview, ReviewSummary } from "@/lib/reviews";

export function ReviewStars({ rating, size = "h-4 w-4" }: { rating: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Nota ${rating} de 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={`${size} ${index < Math.round(rating) ? "text-amber-400" : "text-muted-foreground/25"}`}
          fill={index < Math.round(rating) ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

function formatReviewDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" })
    .format(new Date(value))
    .replace(" de ", " ");
}

export function ReviewCard({ review }: { review: PublicReview }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{review.clientName}</p>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
              <CheckCircle2 aria-hidden="true" className="h-3 w-3" /> Verificado
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {review.serviceName} · {formatReviewDate(review.createdAt)}
          </p>
        </div>
        <ReviewStars rating={review.rating} size="h-3.5 w-3.5" />
      </div>
      {review.comment && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">“{review.comment}”</p>
      )}
    </article>
  );
}

export function ReviewsSection({
  salonSlug,
  summary,
  reviews,
}: {
  salonSlug: string;
  summary: ReviewSummary;
  reviews: PublicReview[];
}) {
  if (summary.count === 0) {
    return (
      <section id="avaliacoes" aria-labelledby="reviews-title" className="space-y-2">
        <h2 id="reviews-title" className="text-base font-semibold">Avaliações</h2>
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
          <MessageSquareQuote aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ainda sem avaliações — aparecem aqui após o primeiro atendimento concluído.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="avaliacoes" aria-labelledby="reviews-title" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-400">
            Experiências reais
          </p>
          <h2 id="reviews-title" className="text-base font-semibold">Avaliações</h2>
        </div>
        <Link
          href={`/book/${salonSlug}/avaliacoes`}
          className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary"
        >
          Ver todas <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="rounded-3xl border border-amber-400/20 bg-gradient-to-br from-amber-400/10 via-card to-card p-5">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-amber-400/15 text-2xl font-semibold text-amber-300">
            {summary.average.toFixed(1).replace(".", ",")}
          </div>
          <div>
            <ReviewStars rating={summary.average} />
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.count} {summary.count === 1 ? "avaliação" : "avaliações"} verificadas
            </p>
          </div>
          <MessageSquareQuote aria-hidden="true" className="ml-auto h-5 w-5 text-amber-400/70" />
        </div>
      </div>

      {reviews.length > 0 && (
        <div className="space-y-3">
          {reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
        </div>
      )}
    </section>
  );
}
