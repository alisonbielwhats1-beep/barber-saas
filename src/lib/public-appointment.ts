import { z } from "zod";
import type { ClientSession } from "./client-auth";
import type { Tx } from "./prisma-tenant";
import { resolveClientProfile } from "./client-identity";
import { isValidPhoneBR, normalizePhone } from "./phone";

const cartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(20),
});

export const publicAppointmentSchema = z
  .object({
    salonId: z.string().min(1),
    serviceIds: z.array(z.string().min(1)).min(1).max(10),
    professionalId: z.string().min(1),
    startLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/),
    idempotencyKey: z.string().uuid(),
    clientName: z.string().trim().min(2).max(120).optional(),
    clientPhone: z
      .string()
      .max(32)
      .refine(isValidPhoneBR)
      .transform(normalizePhone)
      .optional(),
    notes: z.string().max(1_000).optional(),
    cartItems: z.array(cartItemSchema).max(30).optional().default([]),
  })
  .strict();

export type PublicAppointmentInput = z.infer<typeof publicAppointmentSchema>;

export type BookingIdentity =
  | { kind: "authenticated"; clientId: string }
  | { kind: "guest" };

export function clientSessionForSalon(
  session: ClientSession | null,
  salonId: string,
): ClientSession | null {
  return session?.salonId === salonId ? session : null;
}

/**
 * Revalida a sessão no tenant e aponta tokens antigos para o cadastro
 * canônico depois de uma mesclagem feita pelo salão.
 *
 * O cookie continua assinado e não é reescrito aqui; a resolução no banco
 * evita que uma sessão legítima volte a criar reservas no perfil de origem.
 */
export async function resolveClientSessionInTenant(
  tx: Tx,
  session: ClientSession | null,
  salonId: string,
): Promise<ClientSession | null> {
  const sessionForSalon = clientSessionForSalon(session, salonId);
  if (!sessionForSalon) return null;

  const profile = await resolveClientProfile(tx, salonId, sessionForSalon.clientId);
  if (!profile) return null;

  return {
    ...sessionForSalon,
    clientId: profile.id,
    name: profile.name,
    email: profile.email ?? sessionForSalon.email,
  };
}

/**
 * O clientId nunca faz parte do payload público. A única identidade
 * autenticada aceita é a sessão assinada do cliente.
 */
export function resolveBookingIdentity(
  session: ClientSession | null,
  salonId: string,
): BookingIdentity {
  const currentSession = clientSessionForSalon(session, salonId);
  if (!currentSession) return { kind: "guest" };
  return { kind: "authenticated", clientId: currentSession.clientId };
}
