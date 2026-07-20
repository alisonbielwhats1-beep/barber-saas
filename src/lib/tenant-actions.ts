"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { prisma } from "./prisma";
import { authOptions } from "./auth";

/**
 * Troca o salão ativo do usuário logado, escrevendo cookie `active_salon`.
 * Verifica que o usuário realmente tem membership nesse salão — sem essa
 * checagem, o cookie viraria vetor pra qualquer um "escolher" qualquer salonId.
 */
export async function setActiveSalon(salonId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error("Unauthenticated");

  const membership = await prisma.membership.findUnique({
    where: { userId_salonId: { userId: session.user.id, salonId } },
    select: { id: true },
  });
  if (!membership) throw new Error("Forbidden: not a member of this salon");

  cookies().set("active_salon", salonId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}
