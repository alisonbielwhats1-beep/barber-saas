"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { withUser } from "@/lib/prisma-tenant";

const reviewInput = z.discriminatedUnion("decision", [
  z.object({
    salonId: z.string().min(1),
    decision: z.literal("APPROVE"),
    plan: z.enum(["FREE", "STARTER", "PRO", "ENTERPRISE"]),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    salonId: z.string().min(1),
    decision: z.literal("REJECT"),
    reason: z.string().trim().min(3, "Informe o motivo da recusa").max(500),
  }),
  z.object({
    salonId: z.string().min(1),
    decision: z.literal("SUSPEND"),
    reason: z.string().trim().min(3, "Informe o motivo da suspensão").max(500),
  }),
]);

export type ReviewSalonAccessInput = z.infer<typeof reviewInput>;

export async function reviewSalonAccess(raw: ReviewSalonAccessInput) {
  const admin = await getPlatformAdminContext();
  const input = reviewInput.parse(raw);

  await withUser(admin.userId, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: input.salonId },
      select: { id: true, plan: true, accessStatus: true },
    });
    if (!salon) throw new Error("Estabelecimento não encontrado");

    const newStatus =
      input.decision === "APPROVE"
        ? "APPROVED"
        : input.decision === "REJECT"
          ? "REJECTED"
          : "SUSPENDED";
    const newPlan = input.decision === "APPROVE" ? input.plan : salon.plan;

    if (input.decision === "REJECT" && salon.accessStatus !== "PENDING") {
      throw new Error("Somente solicitações pendentes podem ser recusadas");
    }
    if (input.decision === "SUSPEND" && salon.accessStatus !== "APPROVED") {
      throw new Error("Somente estabelecimentos ativos podem ser suspensos");
    }

    const updated = await tx.salon.updateMany({
      where: { id: salon.id, accessStatus: salon.accessStatus },
      data: {
        accessStatus: newStatus,
        plan: newPlan,
        accessReviewedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new Error("A solicitação foi alterada por outra pessoa. Atualize a página.");
    }

    const type =
      input.decision === "REJECT"
        ? "REJECTED"
        : input.decision === "SUSPEND"
          ? "SUSPENDED"
          : salon.accessStatus === "APPROVED"
            ? "PLAN_CHANGED"
            : salon.accessStatus === "PENDING"
              ? "APPROVED"
              : "REACTIVATED";

    await tx.salonAccessEvent.create({
      data: {
        salonId: salon.id,
        actorUserId: admin.userId,
        type,
        previousStatus: salon.accessStatus,
        newStatus,
        previousPlan: salon.plan,
        newPlan,
        reason: input.reason?.trim() || null,
      },
    });
  });

  revalidatePath("/plataforma/solicitacoes");
  revalidatePath("/onboarding/acesso");
  return { ok: true } as const;
}
