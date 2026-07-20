import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "./prisma";
import { authOptions } from "./auth";

/**
 * Contexto de tenant resolvido a partir da sessão NextAuth.
 *
 * O `salonId` ativo vem do cookie `active_salon`. Se o usuário tem só 1
 * membership, cai automaticamente nele. Caso contrário, um seletor de salão
 * (a construir) grava o cookie ao trocar.
 *
 * REGRA DE OURO: nenhuma query de tabela tenant-scoped roda sem `salonId`.
 * Nunca faça `findMany()` sem esse filtro — vazaria dados entre salões.
 */

export type Role =
  | "SUPER_ADMIN"
  | "OWNER"
  | "MANAGER"
  | "PROFESSIONAL"
  | "RECEPTIONIST"
  | "CLIENT";

export type TenantContext = {
  userId: string;
  salonId: string;
  role: Role;
};

export async function getTenantContext(): Promise<TenantContext> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const activeSalonId = cookies().get("active_salon")?.value;

  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: { salonId: true, role: true },
  });

  if (memberships.length === 0) redirect("/onboarding/create-salon");

  const active =
    memberships.find((m) => m.salonId === activeSalonId) ?? memberships[0];

  return { userId, salonId: active.salonId, role: active.role as Role };
}

/** Asserção de role — chame no início de Server Actions sensíveis. */
export function assertRole(ctx: TenantContext, roles: Role[]) {
  if (!roles.includes(ctx.role)) {
    throw new Error(`Forbidden: requires one of ${roles.join(", ")}`);
  }
}

/** Alias mantido pra compatibilidade — remove quando refatorar chamadas antigas. */
export const getTenantContextSafe = getTenantContext;
