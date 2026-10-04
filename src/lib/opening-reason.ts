/**
 * O motivo da abertura extra é opcional, mas `ProfessionalOpening.reason` é
 * NOT NULL e o banco exige de 3 a 200 caracteres (CHECK
 * `ProfessionalOpening_valid_interval`, migration manual 018). "Sem motivo" é
 * então gravado com este texto fixo e tratado como ausência na auditoria
 * (motivo nulo) e na tela, sem exigir migration.
 */
export const NO_OPENING_REASON = "Sem motivo informado";

/** Prefixo para motivo digitado com menos de 3 caracteres (o CHECK recusaria). */
const SHORT_REASON_PREFIX = "Motivo: ";

/** Texto a gravar na coluna: o motivo digitado ou o marcador de "sem motivo". */
export function storedOpeningReason(raw: string | null | undefined): string {
  const text = raw?.trim();
  if (!text) return NO_OPENING_REASON;
  // "ok" ou "x" não passariam no CHECK de 3 caracteres: guarda o que foi
  // digitado com um prefixo, em vez de falhar no banco.
  return text.length < 3 ? `${SHORT_REASON_PREFIX}${text}` : text;
}

/** Motivo de verdade para exibir ou auditar; `null` quando não foi informado. */
export function openingReasonOrNull(stored: string | null | undefined): string | null {
  const text = stored?.trim();
  return text && text !== NO_OPENING_REASON ? text : null;
}
