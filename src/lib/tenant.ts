import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { withUser } from "./prisma-tenant";
import { FINANCIAL_ROLES } from "./role-permissions";

/**
 * Contexto de tenant resolvido a partir da sessão NextAuth.
 *
 * O `salonId` ativo vem do cookie `active_salon`. Se o usuário tem só 1
 * membership, cai automaticamente nele. Caso contrário, um seletor de salão
 * (a construir) grava o cookie ao trocar.
 *
 * REGRA DE OURO: nenhuma query de tabela tenant-scoped roda sem `salonId`.
 * Nunca faça `findMany()` sem esse filtro — vazaria dados entre salões.
 *
 * Sob RLS (`prisma/sql/rls/01_enable_rls.sql`, ainda não aplicado): esta
 * função é o único lugar do app que precisa ler `Membership` ANTES de saber
 * o salão — é ela quem descobre o salão. Por isso a leitura roda dentro de
 * `withUser`, que seta só a GUC de usuário. Todo o resto do app usa
 * `withTenant`, que já recebe salão e usuário resolvidos por aqui.
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

  const activeSalonId = (await cookies()).get("active_salon")?.value;

  const memberships = await withUser(userId, (tx) =>
    tx.membership.findMany({
      where: { userId },
      select: {
        salonId: true,
        role: true,
        salon: { select: { accessStatus: true } },
      },
    }),
  );

  if (memberships.length === 0) redirect("/onboarding/create-salon");

  const active =
    memberships.find((m) => m.salonId === activeSalonId) ??
    memberships.find((m) => m.salon.accessStatus === "APPROVED") ??
    memberships[0];

  if (active.salon.accessStatus !== "APPROVED") {
    redirect("/onboarding/acesso");
  }

  return { userId, salonId: active.salonId, role: active.role as Role };
}

/** Asserção de role — chame no início de Server Actions sensíveis. */
export function assertRole(ctx: TenantContext, roles: readonly Role[]) {
  if (!roles.includes(ctx.role)) {
    throw new Error(`Forbidden: requires one of ${roles.join(", ")}`);
  }
}

/** Papéis que enxergam dados financeiros do salão inteiro. */
export const FINANCE_ROLES: readonly Role[] = FINANCIAL_ROLES;

/**
 * Guarda de PÁGINA (não de action). Resolve o tenant e, se o papel não estiver
 * autorizado, redireciona em vez de lançar — `throw` numa página cairia no
 * error boundary com "Algo deu errado", que é enganoso para uma negativa de
 * permissão.
 *
 * Existe porque as páginas só liam `salonId` de `getTenantContext()` e
 * descartavam o `role`: as Server Actions barravam a escrita, mas qualquer
 * membro do salão conseguia LER o financeiro completo abrindo a URL direto.
 */
export async function requireRole(roles: readonly Role[]): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!roles.includes(ctx.role)) {
    redirect(ctx.role === "PROFESSIONAL" ? "/agenda" : "/dashboard");
  }
  return ctx;
}

/** Alias mantido pra compatibilidade — remove quando refatorar chamadas antigas. */
export const getTenantContextSafe = getTenantContext;
