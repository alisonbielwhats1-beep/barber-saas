"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { withUser } from "./prisma-tenant";

/**
 * Troca o salão ativo do usuário logado, escrevendo cookie `active_salon`.
 * Verifica que o usuário realmente tem membership nesse salão — sem essa
 * checagem, o cookie viraria vetor pra qualquer um "escolher" qualquer salonId.
 *
 * A checagem roda em `withUser`, não `withTenant`: neste momento o salão
 * ATIVO ainda é o antigo (ou nenhum) — é justamente esta função que decide
 * qual passa a ser. A policy de leitura de `Membership` aceita por usuário
 * OU por salão; aqui só o usuário está disponível.
 */
export async function setActiveSalon(salonId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error("Unauthenticated");

  const membership = await withUser(session.user.id, (tx) =>
    tx.membership.findUnique({
      where: { userId_salonId: { userId: session.user.id, salonId } },
      select: { id: true },
    }),
  );
  if (!membership) throw new Error("Forbidden: not a member of this salon");

  const cookieStore = await cookies();
  cookieStore.set("active_salon", salonId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}
