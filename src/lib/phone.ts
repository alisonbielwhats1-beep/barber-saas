/**
 * Telefone BR: máscara de digitação, normalização e validação.
 * Guardamos sempre só dígitos no banco — a máscara é apresentação.
 */

/** Remove tudo que não é dígito. */
export function normalizePhone(input: string): string {
  return input.replace(/\D/g, "").slice(0, 11);
}

/** Formata progressivamente enquanto digita: (11) 91234-5678. */
export function formatPhoneBR(input: string): string {
  const d = normalizePhone(input);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Fixo (10 dígitos) ou celular (11 dígitos), com DDD válido. */
export function isValidPhoneBR(input: string): boolean {
  const d = normalizePhone(input);
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  // Celular (11 dígitos) começa com 9 depois do DDD
  if (d.length === 11 && d[2] !== "9") return false;
  return true;
}
