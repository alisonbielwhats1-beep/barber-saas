/**
 * O motivo da abertura extra é opcional, mas `ProfessionalOpening.reason` é
 * NOT NULL e o banco exige de 3 a 200 caracteres (CHECK
 * `ProfessionalOpening_valid_interval`, migration manual 018). "Sem motivo" é
 * então gravado com este texto fixo e tratado como ausência na auditoria
 * (motivo nulo) e na tela, sem exigir migration.
 */
export const NO_OPENING_REASON = "Sem motivo informado";

/** Texto a gravar na coluna: o motivo digitado ou o marcador de "sem motivo". */
export function storedOpeningReason(raw: string | null | undefined): string {
  return raw?.trim() || NO_OPENING_REASON;
}

/** Motivo de verdade para exibir ou auditar; `null` quando não foi informado. */
export function openingReasonOrNull(stored: string | null | undefined): string | null {
  const text = stored?.trim();
  return text && text !== NO_OPENING_REASON ? text : null;
}
