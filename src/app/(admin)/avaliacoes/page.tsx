import { requireRole } from "@/lib/tenant";
import { MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { getReviewModerationData } from "@/lib/reviews";
import { Star } from "lucide-react";
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
      <div>
        <PageHeader compact title="Avaliações">
          <span className="inline-flex min-h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 text-xs font-medium tabular-nums text-muted-foreground">
            <Star aria-hidden="true" className="h-3.5 w-3.5" />
            {result.reviewData.summary.average.toFixed(1).replace(".", ",")} · nota média
          </span>
        </PageHeader>
        <p className="mt-1 hidden max-w-3xl text-sm leading-relaxed text-muted-foreground md:block">
          Veja o que os clientes dizem depois de atendimentos concluídos. Você pode ocultar um comentário inadequado, mas o histórico fica preservado para auditoria.
        </p>
      </div>
      <ReviewsManager
        salonName={result.salon.name}
        timezone={result.salon.timezone}
        summary={result.reviewData.summary}
        reviews={result.reviewData.reviews}
      />
    </div>
  );
}
