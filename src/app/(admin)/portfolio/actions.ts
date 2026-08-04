"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";

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

  await withTenant(ctx, async (tx) => {
    // valida que o profissional pertence ao salão, se informado
    if (data.professionalId) {
      const p = await tx.professional.findFirst({
        where: { id: data.professionalId, salonId: ctx.salonId },
        select: { id: true },
      });
      if (!p) throw new Error("Profissional inválido");
    }

    await tx.portfolioItem.create({
      data: {
        salonId: ctx.salonId,
        imageUrl: data.imageUrl,
        caption: data.caption ?? null,
        professionalId: data.professionalId ?? null,
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
