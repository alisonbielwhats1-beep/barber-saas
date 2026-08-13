/**
 * Telefone BR: máscara de digitação, normalização e validação.
 * Guardamos sempre só dígitos no banco — a máscara é apresentação.
 */

const BRAZILIAN_AREA_CODES = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

const PHONE_FORMAT = /^\+?[0-9()\- ]+$/;

/**
 * Canonicaliza para dígitos nacionais e remove somente o DDI brasileiro.
 * Nunca corta dígitos: comprimento, caracteres e prefixos pertencem ao
 * contrato de `isValidPhoneBR`, que deve anteceder qualquer persistência.
 */
function nationalPhoneDigits(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits.startsWith("55") && digits.length >= 12
    ? digits.slice(2)
    : digits;
}

export function normalizePhone(input: string): string {
  return nationalPhoneDigits(input);
}

/** Formata progressivamente enquanto digita: (11) 91234-5678. */
export function formatPhoneBR(input: string): string {
  const d = normalizePhone(input);
  if (d.length === 0) return "";
  // Não esconda dígitos excedentes: o campo permanece visivelmente
  // inválido e a validação pode bloqueá-lo, sem transformar outro número.
  if (d.length > 11) return d;
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Fixo (10 dígitos) ou celular (11 dígitos), com DDD válido. */
export function isValidPhoneBR(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || !PHONE_FORMAT.test(trimmed)) return false;

  const rawDigits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && !rawDigits.startsWith("55")) return false;

  const d = nationalPhoneDigits(input);
  if (d.length !== 10 && d.length !== 11) return false;
  if (!BRAZILIAN_AREA_CODES.has(d.slice(0, 2))) return false;

  const subscriber = d.slice(2);
  // Contrato estrutural conservador: celular tem nove dígitos e inicia em 9;
  // telefone fixo tem oito dígitos e inicia entre 2 e 5.
  return d.length === 11
    ? /^9\d{8}$/.test(subscriber)
    : /^[2-5]\d{7}$/.test(subscriber);
}
