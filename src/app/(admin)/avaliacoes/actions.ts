"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { withTenant } from "@/lib/prisma-tenant";
import { assertRole, getTenantContext } from "@/lib/tenant";

const reviewStatusSchema = z.enum(["PUBLISHED", "HIDDEN"]);

export async function setReviewStatus(reviewId: string, nextStatus: "PUBLISHED" | "HIDDEN") {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const status = reviewStatusSchema.parse(nextStatus);

  const result = await withTenant(ctx, async (tx) => {
    const [review, actor, salon] = await Promise.all([
      tx.clientReview.findFirst({
        where: { id: reviewId, salonId: ctx.salonId },
        select: { id: true, status: true, client: { select: { name: true } } },
      }),
      tx.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }),
      tx.salon.findUnique({ where: { id: ctx.salonId }, select: { slug: true } }),
    ]);
    if (!review || !salon) throw new Error("Avaliação não encontrada neste estabelecimento.");
    if (review.status === status) return salon;

    await tx.clientReview.updateMany({
      where: { id: review.id, salonId: ctx.salonId },
      data: { status, moderatedAt: new Date() },
    });
    await writeAuditLog(tx, {
      salonId: ctx.salonId,
      userId: ctx.userId,
      actorName: actor?.name ?? "Usuário",
      action: status === "HIDDEN" ? "REVIEW_HIDDEN" : "REVIEW_PUBLISHED",
      entityType: "ClientReview",
      entityId: review.id,
      reason: status === "HIDDEN" ? "Ocultada pelo estabelecimento" : "Publicada novamente pelo estabelecimento",
      metadata: { clientName: review.client.name },
    });
    return salon;
  });

  revalidatePath("/avaliacoes");
  revalidatePath(`/book/${result.slug}`, "layout");
  revalidatePath(`/book/${result.slug}/avaliacoes`);
}
