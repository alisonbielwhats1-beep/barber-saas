import { getClientSession } from "./client-auth";
import { resolveClientSessionInTenant } from "./public-appointment";
import { withApprovedSalon, type Tx } from "./prisma-tenant";
export async function withClientPortal<T>(salonId: string, callback: (tx: Tx, clientId: string) => Promise<T>): Promise<T> {
  const session = await getClientSession();
  if (!session || session.salonId !== salonId) throw new Error("Entre na sua conta deste estabelecimento.");
  const result = await withApprovedSalon(salonId, async tx => {
    const current = await resolveClientSessionInTenant(tx, session, salonId);
    if (!current) throw new Error("Sua sessão expirou. Entre novamente.");
    return callback(tx, current.clientId);
  });
  if (result === null) throw new Error("Estabelecimento indisponível.");
  return result;
}
