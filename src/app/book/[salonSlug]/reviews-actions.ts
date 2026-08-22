"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { clientReviewInputSchema } from "@/lib/reviews";

export type ReviewActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitClientReview(
  salonSlug: string,
  input: unknown,
): Promise<ReviewActionResult> {
  const parsed = clientReviewInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Escolha uma nota de 1 a 5 e revise o comentário." };
  }

  const session = await getClientSession();
  if (!session) return { ok: false, error: "Sua sessão expirou. Entre novamente para avaliar." };

  try {
    const result = await withSalonBySlug(salonSlug, async (tx, salonId) => {
      const effectiveSession = await resolveClientSessionInTenant(tx, session, salonId);
      if (!effectiveSession) {
        return { ok: false as const, error: "Não foi possível confirmar este cliente neste salão." };
      }

      const appointment = await tx.appointment.findFirst({
        where: {
          id: parsed.data.appointmentId,
          salonId,
          clientId: effectiveSession.clientId,
          status: "COMPLETED",
        },
        select: { id: true },
      });
      if (!appointment) {
        return {
          ok: false as const,
          error: "Só é possível avaliar um atendimento concluído do seu histórico.",
        };
      }

      await tx.clientReview.create({
        data: {
          salonId,
          appointmentId: appointment.id,
          clientId: effectiveSession.clientId,
          rating: parsed.data.rating,
          comment: parsed.data.comment,
          status: "PUBLISHED",
        },
      });
      return { ok: true as const };
    });

    if (!result) return { ok: false, error: "Estabelecimento não encontrado." };
    if (!result.ok) return result;

    revalidatePath(`/book/${salonSlug}`, "layout");
    revalidatePath(`/book/${salonSlug}/minhas`);
    revalidatePath(`/book/${salonSlug}/avaliacoes`);
    return { ok: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "Você já avaliou este atendimento." };
    }
    throw error;
  }
}
