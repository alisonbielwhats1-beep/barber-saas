/**
 * Códigos de erro da API de agendamento → mensagens amigáveis em PT.
 * Puro (sem dependências) para ser testável e importável de client e server.
 */

export const ERROR_PT: Record<string, string> = {
  SLOT_TAKEN: "Esse horário acabou de ser reservado 😕 Os horários foram atualizados — escolha outro.",
  SERVICE_INVALID: "Este serviço não está mais disponível.",
  PRO_SERVICE_MISMATCH: "Esse profissional não realiza este serviço.",
  CLIENT_INVALID: "Sua sessão expirou — entre novamente para confirmar.",
  GUEST_DATA_REQUIRED: "Preencha seu nome e WhatsApp para confirmar.",
  AUTH_REQUIRED: "Sua sessão expirou — entre novamente para confirmar.",
  NOT_FOUND: "Reserva não encontrada.",
  FORBIDDEN: "Essa reserva não pertence à sua conta.",
  ALREADY_CLOSED: "Essa reserva já foi encerrada.",
  ALREADY_STARTED: "O atendimento já começou e não pode mais ser alterado.",
  TOO_LATE: "O prazo de cancelamento ou remarcação já terminou.",
  TOO_SOON: "Esse horário está dentro da antecedência mínima do estabelecimento.",
  TOO_FAR: "Esse horário está além do período disponível para agendamento.",
  OUTSIDE_WORKING_HOURS: "O horário está fora da jornada desse profissional.",
  PROFESSIONAL_UNAVAILABLE: "O profissional não está disponível nesse período.",
  SALON_CLOSED: "O estabelecimento está fechado nessa data.",
  INVALID_LOCAL_TIME: "Esse horário não existe ou é ambíguo no fuso do estabelecimento.",
  INVALID_TIMEZONE: "O fuso horário do estabelecimento precisa ser corrigido.",
  VERSION_CONFLICT: "A reserva foi alterada em outra tela. Atualize e tente novamente.",
  IDEMPOTENCY_MISMATCH: "Esta tentativa não corresponde à solicitação original. Revise os dados.",
  TOO_LATE_TO_RESCHEDULE:
    "Não é possível remarcar com tão pouca antecedência. Entre em contato com o salão.",
  ALREADY_WAITING: "Você já está na lista de espera desse horário.",
  WAITLIST_BLOCKED:
    "O horário atual possui fila de espera e não pôde ser liberado. Fale com o estabelecimento.",
};

export function friendlyError(raw: unknown): string {
  const code = typeof raw === "string" ? raw : "";
  if (ERROR_PT[code]) return ERROR_PT[code];
  // Mensagens já em PT (ex.: "Estoque insuficiente: Pomada") passam direto;
  // códigos desconhecidos ou payloads estranhos viram mensagem genérica.
  if (code && !/^[A-Z_]+$/.test(code)) return code;
  return "Não foi possível concluir. Tente novamente em instantes.";
}
