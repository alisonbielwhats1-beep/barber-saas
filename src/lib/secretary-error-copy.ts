/** ERR-COPY: the owner-facing pt-BR text of a stable refusal code, shared by the server actions, the no-plan interpretation
 * failure answered as a turn (salon-secretary.ts) and the practice/free-use harnesses (their transcripts record what the owner
 * would read). Codes only in, pt-BR only out: an exception's own text (database, provider, model or customer data) never reaches
 * the screen; an unknown code or a non-code message gets the neutral refusal. Pure and client-safe (no tenant access). */

/** Flag SALON_SECRETARY_COPY_V2 (default off): with it off every text below, the fallback included, is the historical one. */
export const secretaryCopyV2Enabled = (env: Record<string, string | undefined> = process.env) => env.SALON_SECRETARY_COPY_V2 === "true";

export const secretaryErrorMessages: Readonly<Record<string, string>> = {
  SECRETARY_NOT_AVAILABLE: "A Secretária não está habilitada para este acesso.",
  SECRETARY_DAILY_BUDGET: "A Secretária atingiu o limite de uso de hoje. Amanhã ela volta; até lá, use a agenda normalmente.",
  FORBIDDEN: "Seu acesso não permite esta ação. O plano foi preservado para revisão.",
  CONFIRMATION_STALE: "Esta proposta foi substituída. Revise a versão atual antes de confirmar.",
  CONFIRMATION_BATCH_INVALID: "Confirmação inválida. Nada foi executado. Revise as ações atuais antes de confirmar.",
  REVISION_CONFLICT: "Esta proposta mudou. Prepare e confirme uma nova versão.",
  EXPIRED: "A proposta expirou. Prepare uma nova versão antes de confirmar.",
  PLAN_NOT_READY: "Há informações ou conflitos a revisar antes de confirmar.",
  CONFIRMATION_GROUP_REQUIRED: "Revise e confirme o grupo completo de ações.",
  SESSION_CLOSED: "Esta conversa foi encerrada. Inicie uma nova conversa.",
  ENTITY_MENTION_CONFLICT: "Não foi possível separar com segurança o cliente e o serviço. Informe o nome completo do cliente e, somente se necessário, o serviço em separado. Nenhuma ação foi executada.",
  CONTACT_NOT_ELIGIBLE: "O cliente não possui contato válido para esse canal.",
  RECIPIENT_CHANGED: "O contato mudou. Prepare uma nova proposta antes de confirmar.",
  MESSAGE_CONTENT_REVIEW_REQUIRED: "Informe o texto exato entre aspas ou solicite explicitamente uma sugestão.",
  UNSUPPORTED_COMMUNICATION_DEPENDENCY: "Essa combinação precisa ser esclarecida. Somente cancelamento seguido de mensagem ao mesmo cliente é suportado.",
  DEPENDENCY_RECIPIENT_MISMATCH: "O destinatário deve corresponder ao cliente do cancelamento.",
  COMMUNICATION_LOCAL_ONLY: "Comunicação disponível somente no teste local, sem envio externo.",
  PRODUCT_NOT_FOUND: "Não encontrei esse produto neste salão.",
  PRODUCT_CHANGED: "O produto ou saldo mudou após o rascunho. Nenhuma movimentação foi aplicada. Inicie uma nova conversa para revisar o saldo atual.",
  STOCK_OVERFLOW: "O saldo projetado ultrapassa o limite permitido.",
  "Estoque insuficiente para esta saida": "Estoque insuficiente para esta saída. Nenhuma movimentação foi aplicada.",
  FINANCIAL_READ_ONLY: "Esta consulta financeira é somente leitura e não possui confirmação de escrita.",
  RECEIVABLE_IS_CURRENT_BALANCE: "A receber é o saldo atual de todas as datas. Consulte sem período ou comparação histórica.",
  FINANCIAL_GROUP_UNSUPPORTED: "O ranking disponível é por faturamento de serviços, sem comparação entre períodos. Reformule a consulta.",
  FINANCIAL_RANGE_EXCEEDED: "O valor ultrapassa o limite seguro desta consulta. Nenhum valor estimado foi apresentado.",
  SLOT_CONFLICT: "O horário ficou indisponível. Escolha outro horário e prepare nova proposta.",
  SLOT_TAKEN: "O horário ficou indisponível. Nada foi agendado.",
  SCHEDULE_CHANGED: "Os dados do agendamento mudaram. Prepare uma nova proposta.",
  REASON_REQUIRED: "Informe o motivo real do cancelamento, com pelo menos três caracteres.",
  ALREADY_STARTED_OR_CLOSED: "Esse agendamento já começou ou foi encerrado. Nenhuma alteração foi feita.",
  SCHEDULING_RELATION_NOT_SUPPORTED: "Este agendamento possui produtos ou dependente. Use a agenda para revisar essas relações; a Secretária ainda não as altera.",
  APPOINTMENT_SEARCH_TOO_BROAD: "Muitos agendamentos encontrados. Informe a data e o horário original.",
  PAST_TIME: "Informe um novo horário futuro.",
  PRO_SERVICE_MISMATCH: "O profissional não realiza esse serviço.",
  AMBIGUOUS_DATE: "Informe uma única data inequívoca.",
  INVALID_LOCAL_DATE: "Informe uma data válida.",
  PAID_CALLS_DISABLED: "Chamadas pagas bloqueadas. Aguarde a autorização e configuração do teste real.",
  SECRETARY_CONFIGURATION_REQUIRED: "Configure modelo, chave exclusiva e projeto aprovado no servidor.",
  SECRETARY_TURN_FAILED: "Não foi possível concluir este turno. Nenhum cadastro foi executado. O rascunho válido foi preservado.",
  SESSION_NOT_FOUND: "Sessão indisponível ou expirada. Inicie uma nova conversa.",
  PLAN_NOT_IN_SESSION: "Este pedido não pertence à conversa atual.",
  SUSPENDED_PLAN_LIMIT: "Há cinco pedidos guardados. Retome um deles ou inicie uma nova conversa.",
  SESSION_BUSY: "Há uma operação em andamento. Aguarde antes de tentar novamente.",
  // D1 (persisted state): another call saved this conversation first; nothing of this call was kept as a new approval.
  CONCURRENT_UPDATE: "A conversa foi atualizada em outra aba ou dispositivo. Confira a versão atual antes de continuar.",
  PROPOSAL_MISMATCH: "Proposta inválida, cancelada ou desatualizada. Prepare uma nova proposta.",
  CUSTOMER_CHANGED: "O cadastro mudou após a proposta. Inicie uma nova conversa para revisar os dados.",
  DUPLICATE_CANDIDATE: "Existe cadastro correspondente. Revise antes de continuar.",
  SERVICE_CHANGED: "O serviço mudou após a proposta. Nada foi alterado. Inicie uma nova conversa para revisar o estado atual.",
  SELECTION_INVALID: "Seleção inválida ou desatualizada. Localize o serviço novamente.",
  DISCARD_ALREADY_CONFIRMED: "Esta ação já foi confirmada e não pode ser descartada. Nada foi alterado.",
  DISCARD_ACTION_MISMATCH: "Esta ação não está aberta no pedido atual. Nada foi alterado.",
  ACTION_DISCARDED: "Esta ação foi descartada. Envie um novo pedido para prepará-la de novo.",
  OPERATION_NOT_IN_SESSION: "Esta ação não faz mais parte do pedido atual. Revise a versão atual.",
  OPTION_UNAVAILABLE: "Essa opção não está mais disponível. Escolha uma das opções atuais.",
  // B7: limits and interpretation refusals said in pt-BR (all happen before anything is prepared or executed).
  TURN_LIMIT: "Esta conversa chegou ao limite de mensagens. Inicie uma nova conversa; o que já foi confirmado continua registrado.",
  SESSION_LIMIT: "Há conversas demais abertas agora. Encerre uma conversa ou aguarde alguns minutos antes de iniciar outra.",
  INTERPRETATION_INVALID: "Não consegui entender esse pedido com segurança. Nada foi alterado. Pode repetir de outro jeito?",
  // Request budget: refused before any model call (never over the cap); the text is requestTooLargeMessage.
  SECRETARY_REQUEST_TOO_LARGE: "Esse pedido ficou grande demais para eu processar de uma vez; pode dividir em partes?",
  INTERPRETATION_INCOMPLETE: "Não consegui entender esse pedido por completo. Nada foi alterado. Pode repetir de outro jeito?",
  MODEL_CALL_LIMIT: "Não consegui entender esse pedido com segurança. Nada foi alterado. Pode repetir de outro jeito?",
  CONTINUATION_ACTION_MISMATCH: "Não consegui ligar essa resposta a uma ação aberta. Nada foi alterado. Diga a qual ação ela se refere.",
  APPEND_ACTION_EXISTS: "Essa ação já está no pedido atual. Nada foi duplicado; revise as ações abaixo.",
  CAPABILITY_FIELD_MISMATCH: "Uma parte do pedido trouxe dados que não combinam com a ação. Nada foi alterado. Pode repetir de outro jeito?",
  INVALID_DEPENDENCY_GRAPH: "Não consegui ordenar essas ações com segurança. Nada foi alterado. Pode pedir uma de cada vez?",
  SAME_AS_INVALID: "Não consegui ligar uma ação aos dados de outra com segurança. Nada foi alterado. Informe esses dados diretamente.",
  TEMPORAL_CONTEXT_UNVERIFIED: "Não consegui confirmar a data ou o horário dessa resposta. Nada foi alterado. Informe de novo o dia e o horário.",
  CONVERSATION_ROUTE_CONFLICT: "Não entendi se é uma resposta ao pedido atual ou um pedido novo. Nada foi alterado. Pode deixar isso claro?",
  UNSUPPORTED_BATCH: "Essa combinação de ações ainda não pode ser feita junta. Nada foi alterado. Peça uma ação de cada vez.",
  UNSUPPORTED_DEPENDENCY_ADAPTER: "Essa combinação de ações ainda não pode ser feita junta. Nada foi alterado. Peça uma ação de cada vez.",
  MULTI_ACTION_V2_DISABLED: "Pedidos com várias ações não estão habilitados neste acesso. Peça uma ação de cada vez.",
};
/** The historical fallback (flag off). */
export const legacyRefusalMessage = "Operação recusada. Verifique acesso, configuração e validade da proposta.";
/** Flag on: an unknown refusal before anything ran is said honestly (never the capability menu, never a technical line). */
export const unknownRefusalMessage = "Não consegui concluir esse pedido com segurança. Nada foi alterado. Pode repetir de outro jeito, uma ação por vez?";
/** Flag on: an unknown failure while CONFIRMING never claims that nothing changed; the screen keeps its uncertain state. */
export const unknownExecutionMessage = "Não consegui confirmar o resultado desta ação. Não presuma sucesso. Verifique usando a mesma confirmação.";

/** `executing`: the refusal of a confirmation (its unknown outcome is never "nada foi alterado"). */
export function secretaryErrorMessage(code: string, options: { executing?: boolean; env?: Record<string, string | undefined> } = {}): { code: string; text: string } {
  if (Object.hasOwn(secretaryErrorMessages, code)) return { code, text: secretaryErrorMessages[code] };
  return { code: "BACKEND_FAILURE", text: !secretaryCopyV2Enabled(options.env) ? legacyRefusalMessage : options.executing ? unknownExecutionMessage : unknownRefusalMessage };
}
