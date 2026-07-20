import { PrismaClient } from "@prisma/client";
import { getTenantContext } from "./tenant";

/**
 * Prisma client "tenant-aware": abre uma transação por query e seta o GUC
 * `app.current_salon` com o salonId da sessão. As policies RLS do Postgres
 * então filtram automaticamente qualquer SELECT/INSERT/UPDATE/DELETE.
 *
 * USO:
 *   import { getTenantPrisma } from "@/lib/prisma-tenant";
 *   const db = await getTenantPrisma();
 *   const services = await db.service.findMany(); // já filtrado por salão
 *
 * QUANDO USAR ESTE em vez de `@/lib/prisma` direto:
 *   - Depois de aplicar `prisma/migrations/rls/enable_rls.sql`
 *   - Em qualquer query dentro de contexto de tenant (páginas admin, actions)
 *
 * QUANDO CONTINUAR usando o `prisma` puro:
 *   - Login (busca User por email antes de saber o salão)
 *   - Signup (cria User + Salon + Membership)
 *   - Booking público (`/api/appointments`) — o tenant é derivado do slug da URL,
 *     não da sessão; seta o GUC manualmente ou mantém o filtro `salonId`.
 *
 * CUSTO: cada query vira uma transação (dois roundtrips). Aceitável — a
 * segurança vale. Se ficar quente numa rota, dá pra usar `$queryRaw` com o
 * SET no mesmo pacote.
 */

const globalForPrisma = globalThis as unknown as {
  tenantPrisma?: PrismaClient;
};

const base =
  globalForPrisma.tenantPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.tenantPrisma = base;

export async function getTenantPrisma() {
  const { salonId } = await getTenantContext();

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        return base.$transaction(async (tx) => {
          // set_config com is_local=true garante que o GUC vale só nessa tx
          await tx.$executeRawUnsafe(
            `SELECT set_config('app.current_salon', $1, true)`,
            salonId,
          );
          // Re-executa a operação original. Como o extension delega pro
          // client original, a query roda dentro da mesma tx e vê o GUC.
          return query(args);
        });
      },
    },
  });
}
