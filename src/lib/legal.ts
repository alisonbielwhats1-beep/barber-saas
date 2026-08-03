/**
 * Identidade de quem opera o serviço e datas dos documentos legais.
 *
 * Centralizado num arquivo só porque os mesmos dados aparecem nos Termos, na
 * Política de Privacidade e no Contato — sem isso, atualizar um e esquecer os
 * outros deixaria o site com informação contraditória sobre quem é a parte
 * contratante, que é justamente o dado que não pode ficar ambíguo.
 *
 * ── ATENÇÃO AO CPF ──────────────────────────────────────────────────────────
 * Este repositório é PÚBLICO. CPF aqui vira dado permanente no GitHub (o
 * histórico do git guarda mesmo depois de remover) e é vetor de fraude. Não é
 * exigido numa página pública: nome completo identifica a parte contratante, e
 * o CPF se informa no contrato ou quando solicitado. Por isso ele não existe
 * neste arquivo — de propósito.
 */

/** Nome fantasia / marca do serviço. */
export const SERVICE_NAME = "SalonSaaS";

/** Endereço do serviço em produção. */
export const SERVICE_URL = "https://salon-saas-ruby.vercel.app";

/**
 * Nome civil completo de quem opera o serviço (hoje pessoa física).
 * Enquanto estiver com o valor abaixo, as páginas legais exibem um aviso
 * visível — ver `hasPendingLegalIdentity()`.
 */
export const OPERATOR_LEGAL_NAME = "PREENCHER: nome civil completo";

/** Cidade/UF do foro eleito para resolver disputas. */
export const OPERATOR_JURISDICTION = "PREENCHER: cidade/UF";

/** Canal obrigatório da LGPD para exercício de direitos do titular. */
export const PRIVACY_CONTACT_EMAIL = "alisonbsilva1@hotmail.com";

/** Data da última revisão dos documentos. Atualize ao alterar o conteúdo. */
export const LEGAL_LAST_UPDATED = "3 de agosto de 2026";

const PLACEHOLDER_PREFIX = "PREENCHER";

/** Diz se um campo ainda está com o texto-marcador em vez do valor real. */
export function isPlaceholder(value: string): boolean {
  return value.trimStart().startsWith(PLACEHOLDER_PREFIX);
}

/**
 * Diz se ainda há campo de identidade por preencher.
 *
 * Existe para o documento falhar de forma barulhenta em vez de silenciosa:
 * um Termo de Uso que nomeia "PREENCHER: nome civil completo" como parte
 * contratante não vincula ninguém, e esse é o tipo de erro que passa
 * despercebido justamente porque a página "funciona".
 */
export function hasPendingLegalIdentity(): boolean {
  return [OPERATOR_LEGAL_NAME, OPERATOR_JURISDICTION].some(isPlaceholder);
}
