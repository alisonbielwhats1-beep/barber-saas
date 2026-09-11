import "server-only";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { withUser, type Tx } from "@/lib/prisma-tenant";
import { HqError } from "./validation";

export const isHqEnabled = () => process.env.HQ_ENABLED === "true";
export async function withHq<T>(operation: (tx: Tx, actorId: string) => Promise<T>): Promise<T> {
  const admin = await getPlatformAdminContext();
  if (!isHqEnabled()) throw new HqError("O HQ aguarda ativação após a validação do banco.");
  return withUser(admin.userId, async tx => {
    // Revalida o papel dentro da transação; a RLS aplica a mesma regra.
    const current = await tx.user.findUnique({ where: { id: admin.userId }, select: { platformRole: true } });
    if (current?.platformRole !== "SUPER_ADMIN") throw new HqError("Acesso restrito à administração.");
    await tx.$executeRaw`SELECT set_config('app.hq_access', 'enabled', true)`;
    return operation(tx, admin.userId);
  });
}

