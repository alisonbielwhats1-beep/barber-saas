import { z } from "zod";
import type { ClientSession } from "./client-auth";
import { isValidPhoneBR } from "./phone";

const cartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(20),
});

export const publicAppointmentSchema = z
  .object({
    salonId: z.string().min(1),
    serviceId: z.string().min(1),
    professionalId: z.string().min(1),
    startAt: z.string().datetime(),
    clientName: z.string().trim().min(2).max(120).optional(),
    clientPhone: z
      .string()
      .max(32)
      .transform((value) => value.replace(/\D/g, ""))
      .refine(
        (value) =>
          (value.length === 10 || value.length === 11) &&
          isValidPhoneBR(value),
      )
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
