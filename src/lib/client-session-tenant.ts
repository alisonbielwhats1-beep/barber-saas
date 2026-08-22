import {
  getClientSession,
  type ClientSession,
} from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";

/**
 * Retorna a sessão somente quando ela pertence ao salão presente na URL.
 *
 * A sessão do aplicativo do cliente usa um cookie compartilhado no domínio.
 * Portanto, existir uma sessão não significa que ela seja válida para qualquer
 * `/book/[salonSlug]`. Resolver o slug sob o helper tenant-scoped impede tanto
 * acesso cruzado quanto loops entre login/cadastro e páginas protegidas.
 */
export async function getClientSessionForSalonSlug(
  salonSlug: string,
): Promise<ClientSession | null> {
  const session = await getClientSession();
  if (!session) return null;

  return withSalonBySlug(salonSlug, async (tx, salonId) =>
    resolveClientSessionInTenant(tx, session, salonId),
  );
}
