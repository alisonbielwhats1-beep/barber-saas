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
};

export function friendlyError(raw: unknown): string {
  const code = typeof raw === "string" ? raw : "";
  if (ERROR_PT[code]) return ERROR_PT[code];
  // Mensagens já em PT (ex.: "Estoque insuficiente: Pomada") passam direto;
  // códigos desconhecidos ou payloads estranhos viram mensagem genérica.
  if (code && !/^[A-Z_]+$/.test(code)) return code;
  return "Não foi possível concluir. Tente novamente em instantes.";
}
