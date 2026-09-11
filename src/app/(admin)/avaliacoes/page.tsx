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
      tx.salon.findUnique({ where: { id: ctx.salonId }, select: { name: true, timezone: true } }),
      getReviewModerationData(tx, ctx.salonId),
    ]);
    return salon ? { salon, reviewData } : null;
  });

  if (!result) return null;

  return (
    <div className="min-w-0 space-y-3 md:space-y-6">
      <PageHeader compact kicker="Reputação" title="Avaliações">
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
          {result.reviewData.summary.average.toFixed(1).replace(".", ",")} · nota média
        </span>
      </PageHeader>
      <p className="hidden md:block max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Veja o que os clientes dizem depois de atendimentos concluídos. Você pode ocultar um comentário inadequado, mas o histórico fica preservado para auditoria.
      </p>
      <ReviewsManager
        salonName={result.salon.name}
        timezone={result.salon.timezone}
        summary={result.reviewData.summary}
        reviews={result.reviewData.reviews}
      />
    </div>
  );
}
