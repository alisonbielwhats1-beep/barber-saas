import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

/**
 * Avisos que o estabelecimento dispara ao cliente quando ELE muda o horário ou
 * cancela. O dono não espera aceite: o cliente precisa ficar sabendo na hora,
 * por uma notificação que aparece na tela do celular (não só dentro do app).
 */
export const CLIENT_CHANGE_TEMPLATES = [
  "appointment.cancelled",
  "appointment.rescheduled",
] as const;

export type ClientChangeTemplate = (typeof CLIENT_CHANGE_TEMPLATES)[number];

export function isClientChangeTemplate(value: string): value is ClientChangeTemplate {
  return (CLIENT_CHANGE_TEMPLATES as readonly string[]).includes(value);
}

/** "sábado, 11/10, às 14:30" no fuso do estabelecimento. */
export function changeNoticeWhen(at: Date, timezone: string) {
  const day = formatInTimeZone(at, timezone, "EEEE, dd/MM", { locale: ptBR });
  const time = formatInTimeZone(at, timezone, "HH:mm", { locale: ptBR });
  return `${day}, às ${time}`;
}

export function changeNoticeCopy(input: {
  template: ClientChangeTemplate;
  salonName: string;
  timezone: string;
  /** Horário atual do agendamento (o novo, na remarcação; o cancelado, no cancelamento). */
  startAt: Date;
  /** Horário anterior, só na remarcação. */
  previousStartAt?: Date | null;
}) {
  if (input.template === "appointment.cancelled") {
    return {
      title: "Seu horário foi cancelado",
      body: `${input.salonName} cancelou seu horário de ${changeNoticeWhen(input.startAt, input.timezone)}. Toque para ver suas reservas.`,
    };
  }
  const antes = input.previousStartAt
    ? `de ${changeNoticeWhen(input.previousStartAt, input.timezone)} `
    : "";
  return {
    title: "Seu horário foi alterado",
    body: `${input.salonName} mudou seu horário ${antes}para ${changeNoticeWhen(input.startAt, input.timezone)}. Toque para conferir.`,
  };
}
