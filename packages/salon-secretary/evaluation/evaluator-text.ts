/** Evaluator-only policy. Never used to normalize a runtime value or EXACT content. */
import { isDeepStrictEqual } from "node:util";

export const EVALUATOR_TEXT_POLICY = "topic14-free-text-v1";
export function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR").replace(/\.$/u, "").trim();
  if (!normalized) return null;
  // Only the explicitly approved, complete phrase. Do not remove arbitrary articles.
  return normalized === "a pedido dela" ? "pedido dela" : normalized;
}
export function equivalentReason(expected: unknown, observed: unknown): boolean {
  const a = normalizeReason(expected), b = normalizeReason(observed);
  return a !== null && b !== null && a === b;
}
export function equivalentField(field: string, expected: unknown, observed: unknown): boolean {
  return field === "reason" || field === "override_reason"
    ? equivalentReason(expected, observed)
    : isDeepStrictEqual(expected, observed);
}
/** Require the affirmative backend warning and its reason, not just a loose substring. */
export function hasOverrideWarning(text: unknown, expectedReason: unknown): boolean {
  if (typeof text !== "string") return false;
  return text.split(/\r?\n/u).some(line => {
    const normalized = line.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");
    const match = /^encaixe: haverá sobreposição\. motivo: (.+)$/u.exec(normalized);
    return Boolean(match && equivalentReason(expectedReason,
      match[1].replace(/ tudo será aplicado na mesma transação\.$/u, "")));
  });
}
