import { addDays, addMinutes } from "date-fns";

/**
 * Regras de horário do salão que valem tanto pro cliente marcando sozinho
 * quanto pra checagem de conflito — extraídas aqui pra não duplicar em cada
 * rota que cria/edita/move um agendamento (availability, appointments,
 * client/reschedule, agenda/actions).
 */
export type SchedulingPolicy = {
  minBookingLeadMinutes: number;
  maxBookingLeadDays: number;
  bufferMinutes: number;
};

export type BookingWindowViolation = "TOO_SOON" | "TOO_FAR";

/** Regra de produto: a agenda pública nunca oferece mais de dois meses. */
export const MAX_PUBLIC_BOOKING_LEAD_DAYS = 60;

/**
 * Confere se `startAt` respeita a antecedência mínima/máxima do salão.
 * Só faz sentido pro caminho do CLIENTE — o admin marcando manualmente na
 * Agenda não é restringido por isso (precisa poder encaixar alguém agora ou
 * planejar um mês à frente sem depender da política pública).
 */
export function checkBookingWindow(
  startAt: Date,
  policy: Pick<SchedulingPolicy, "minBookingLeadMinutes" | "maxBookingLeadDays">,
  now = new Date(),
): BookingWindowViolation | null {
  if (startAt < addMinutes(now, policy.minBookingLeadMinutes)) return "TOO_SOON";
  const maxLeadDays = Math.min(
    MAX_PUBLIC_BOOKING_LEAD_DAYS,
    Math.max(1, policy.maxBookingLeadDays),
  );
  if (startAt > addDays(now, maxLeadDays)) return "TOO_FAR";
  return null;
}

/**
 * Janela de conflito expandida pelo buffer do salão: nenhum outro
 * agendamento do mesmo profissional pode começar ou terminar dentro do
 * intervalo de limpeza/preparo, não só durante o atendimento em si.
 *
 * Usado nas duas pontas — geração de horários livres (availability) e
 * checagem de conflito antes de criar/mover/editar/redimensionar — pra as
 * duas concordarem sobre o que conta como "ocupado". A exclusion constraint
 * do banco (appointment_no_overlap) continua sendo a garantia final contra
 * double-booking exato; o buffer é uma regra de UX mais estrita por cima
 * dela, não substitui — corrida na borda exata ainda cai na constraint.
 */
export function bufferedWindow(
  startAt: Date,
  endAt: Date,
  bufferMinutes: number,
): { from: Date; to: Date } {
  if (bufferMinutes <= 0) return { from: startAt, to: endAt };
  return { from: addMinutes(startAt, -bufferMinutes), to: addMinutes(endAt, bufferMinutes) };
}
