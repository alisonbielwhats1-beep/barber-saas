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
  INVALID_SLOT: "Esse horário não é válido. Escolha outro horário disponível.",
  PAST_TIME: "Esse horário já passou. Escolha uma nova data.",
  OUTSIDE_SALON_HOURS: "Esse horário fica fora do funcionamento do salão.",
  OUTSIDE_WORKING_HOURS: "O profissional não atende nesse horário.",
  PROFESSIONAL_UNAVAILABLE:
    "O profissional está indisponível nesse período. Escolha outro horário.",
};

export function friendlyError(raw: unknown): string {
  const code = typeof raw === "string" ? raw : "";
  if (ERROR_PT[code]) return ERROR_PT[code];
  // Mensagens já em PT (ex.: "Estoque insuficiente: Pomada") passam direto;
  // códigos desconhecidos ou payloads estranhos viram mensagem genérica.
  if (code && !/^[A-Z_]+$/.test(code)) return code;
  return "Não foi possível concluir. Tente novamente em instantes.";
}
