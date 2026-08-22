import { requireRole } from "@/lib/tenant";
import { MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { getReviewModerationData } from "@/lib/reviews";
import { PageHeader } from "@/components/page-header";
import { ReviewsManager } from "./reviews-manager";

export default async function ReviewsPage() {
  const ctx = await requireRole(MANAGEMENT_ROLES);
  const result = await withTenant(ctx, async (tx) => {
    const [salon, reviewData] = await Promise.all([
      tx.salon.findUnique({ where: { id: ctx.salonId }, select: { name: true } }),
      getReviewModerationData(tx, ctx.salonId),
    ]);
    return salon ? { salon, reviewData } : null;
  });

  if (!result) return null;

  return (
    <div className="space-y-6">
      <PageHeader kicker="Reputação" title="Avaliações">
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-300">
          {result.reviewData.summary.average.toFixed(1).replace(".", ",")} · nota média
        </span>
      </PageHeader>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Veja o que os clientes dizem depois de atendimentos concluídos. Você pode ocultar um comentário inadequado, mas o histórico fica preservado para auditoria.
      </p>
      <ReviewsManager
        salonName={result.salon.name}
        summary={result.reviewData.summary}
        reviews={result.reviewData.reviews}
      />
    </div>
  );
}
