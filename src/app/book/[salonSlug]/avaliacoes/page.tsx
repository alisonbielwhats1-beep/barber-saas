import { notFound } from "next/navigation";
import { ArrowLeft, Star } from "lucide-react";
import Link from "next/link";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { getPublicReviewData } from "@/lib/reviews";
import { ReviewCard, ReviewStars } from "../reviews-section";

export default async function PublicReviewsPage({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  const result = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    const [salon, reviewData] = await Promise.all([
      tx.salon.findUnique({ where: { id: salonId }, select: { name: true } }),
      getPublicReviewData(tx, salonId, 20),
    ]);
    return salon ? { salon, reviewData } : null;
  });
  if (!result) notFound();

  return (
    <main className="animate-fade-in space-y-6 px-5 pb-28 pt-6">
      <Link
        href={`/book/${salonSlug}`}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Voltar para o salão
      </Link>
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{result.salon.name}</p>
        <h1 className="mt-1 text-2xl font-semibold">Avaliações dos clientes</h1>
        <div className="mt-3 flex items-center gap-3">
          <ReviewStars rating={result.reviewData.summary.average} />
          <span className="text-sm font-semibold">
            {result.reviewData.summary.average.toFixed(1).replace(".", ",")}
          </span>
          <span className="text-sm text-muted-foreground">
            · {result.reviewData.summary.count} {result.reviewData.summary.count === 1 ? "avaliação" : "avaliações"}
          </span>
        </div>
      </header>

      {result.reviewData.reviews.length > 0 ? (
        <section aria-label="Comentários verificados" className="space-y-3">
          {result.reviewData.reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
        </section>
      ) : (
        <div className="rounded-3xl border border-border bg-card p-8 text-center">
          <Star aria-hidden="true" className="mx-auto h-8 w-8 text-amber-400" />
          <p className="mt-3 font-medium">Ainda não há avaliações</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Depois dos primeiros atendimentos concluídos, os comentários aparecerão nesta página.
          </p>
        </div>
      )}
    </main>
  );
}
