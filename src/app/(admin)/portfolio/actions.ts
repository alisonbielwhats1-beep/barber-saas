"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { assertAllowedStoredImageUrl } from "@/lib/stored-image-url";

const portfolioInput = z.object({
  imageUrl: z.string().url(),
  caption: z.string().optional().nullable(),
  professionalId: z.string().optional().nullable(),
});

export type PortfolioInput = z.infer<typeof portfolioInput>;

export async function createPortfolioItem(input: PortfolioInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "PROFESSIONAL"]);
  const data = portfolioInput.parse(input);
  assertAllowedStoredImageUrl(data.imageUrl, ctx.salonId);

  await withTenant(ctx, async (tx) => {
    let professionalId = data.professionalId ?? null;

    if (ctx.role === "PROFESSIONAL") {
      const ownProfessional = await tx.professional.findFirst({
        where: { salonId: ctx.salonId, userId: ctx.userId, active: true },
        select: { id: true },
      });
      if (!ownProfessional) throw new Error("Perfil profissional ativo não encontrado");
      if (professionalId && professionalId !== ownProfessional.id) {
        throw new Error("Você só pode publicar trabalhos no seu próprio portfólio");
      }
      professionalId = ownProfessional.id;
    } else if (professionalId) {
      // Valida que o profissional pertence ao tenant, se informado.
      const p = await tx.professional.findFirst({
        where: { id: professionalId, salonId: ctx.salonId },
        select: { id: true },
      });
      if (!p) throw new Error("Profissional inválido");
    }

    await tx.portfolioItem.create({
      data: {
        salonId: ctx.salonId,
        imageUrl: data.imageUrl,
        caption: data.caption ?? null,
        professionalId,
      },
    });
  });
  revalidatePath("/portfolio");
}

export async function deletePortfolioItem(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, (tx) =>
    tx.portfolioItem.deleteMany({ where: { id, salonId: ctx.salonId } }),
  );
  revalidatePath("/portfolio");
}
