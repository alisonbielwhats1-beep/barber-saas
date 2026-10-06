import type { CapabilitySelection } from "@everflair/salon-secretary";

/** Closed product copy. State only what the capability category establishes;
 * it does not identify a person or establishment. Model prose is never a receipt. */
export function unavailableCapabilityMessage(capability: CapabilitySelection["unavailable_capability"]) {
  const messages = {
    professional_management: "Ainda não consigo cadastrar ou alterar profissionais pela Secretária.",
    product_management: "Ainda não consigo cadastrar ou alterar produtos pela Secretária. Posso consultar e movimentar o estoque dos produtos cadastrados.",
    financial_mutation: "Pela Secretária, posso consultar o financeiro. Ainda não consigo registrar ou alterar pagamentos.",
    salon_hours: "Ainda não consigo configurar horários de trabalho pela Secretária.",
    external_communication: "O envio de mensagens externas não está disponível pela Secretária.",
    other: "Essa capacidade ainda não está disponível pela Secretária. Nenhuma ação foi preparada.",
  };
  return messages[capability ?? "other"];
}
