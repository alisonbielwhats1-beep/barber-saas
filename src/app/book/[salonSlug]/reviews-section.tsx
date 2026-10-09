import Link from "next/link";
import { Check, CheckCircle2, ChevronRight, MessageSquareQuote, Star } from "lucide-react";
import type { PublicReview, ReviewSummary } from "@/lib/reviews";

export function ReviewStars({ rating, size = "h-4 w-4" }: { rating: number; size?: string }) {
  return (
    <span role="img" className="inline-flex items-center gap-0.5" aria-label={`Nota ${rating} de 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={`${size} ${index < Math.round(rating) ? "text-warning" : "text-muted-foreground/25"}`}
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
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-[10px] font-medium text-success">
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

  const average = summary.average.toFixed(1).replace(".", ",");
  return (
    <section id="avaliacoes" aria-labelledby="reviews-title" className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="reviews-title" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-base font-semibold">
          Avaliações
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold">
            <Star aria-hidden="true" className="h-3.5 w-3.5 text-warning" fill="currentColor" />
            <span className="text-warning">{average}</span>
            <span className="font-normal text-muted-foreground">
              · {summary.count} {summary.count === 1 ? "avaliação verificada" : "avaliações verificadas"}
            </span>
          </span>
        </h2>
        <Link
          href={`/book/${salonSlug}/avaliacoes`}
          className="inline-flex min-h-11 shrink-0 items-center gap-0.5 text-xs font-semibold text-primary"
        >
          Ver todas <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>

      {reviews.length > 0 && (
        <div role="list" aria-label="Avaliações recentes" className="-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
          {reviews.map((review) => (
            <article key={review.id} role="listitem" className="flex w-[82%] max-w-[300px] shrink-0 snap-start flex-col gap-1.5 rounded-2xl border border-border bg-card px-3.5 py-3">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold">{review.clientName}</p>
                <span title="Verificado" className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-success/15 text-success">
                  <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />
                  <span className="sr-only">Avaliação verificada</span>
                </span>
                <span className="ml-auto shrink-0"><ReviewStars rating={review.rating} size="h-3 w-3" /></span>
              </div>
              {review.comment && (
                <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">“{review.comment}”</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {review.serviceName} · {formatReviewDate(review.createdAt)}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

