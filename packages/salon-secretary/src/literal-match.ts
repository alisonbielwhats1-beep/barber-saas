/** Representation-tolerant literal proof. Phone keyboards and dictation change case,
 * accents, spacing and quote/dash glyphs, never the words themselves. A quote is
 * present when a whole-token span of the ORIGINAL message folds to the same text.
 * Offsets always refer to the original string, never to a folded copy. This only
 * locates a quote; every caller still re-parses the user's span for its value. */
const typographic: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "´": "'", "`": "'",
  "“": "\"", "”": "\"", "„": "\"", "‟": "\"", "«": "\"", "»": "\"", "″": "\"",
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
};
type Unit = { char: string; start: number };
/** One folded unit per output code point with the original offset of its source code
 * point. Combining marks fold to nothing and stay inside their base grapheme; a run of
 * whitespace is a single unit. */
function foldedUnits(text: string): Unit[] {
  const units: Unit[] = [];
  for (let at = 0; at < text.length;) {
    const part = String.fromCodePoint(text.codePointAt(at)!);
    const folded = /\s/u.test(part) ? " " : typographic[part] ?? part.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
    for (const char of folded) if (char !== " " || units.at(-1)?.char !== " ") units.push({ char, start: at });
    at += part.length;
  }
  return units;
}
const trimmed = (units: Unit[]) => { while (units[0]?.char === " ") units.shift(); while (units.at(-1)?.char === " ") units.pop(); return units; };
const word = (unit: Unit | undefined) => !!unit && /[\p{L}\p{N}]/u.test(unit.char);
/** Original end of a unit: the start of the next source code point (trailing marks included). */
function endOf(units: readonly Unit[], index: number, length: number) {
  for (let next = index + 1; next < units.length; next++) if (units[next].start > units[index].start) return units[next].start;
  return length;
}

/** Folded comparison key of a literal (pt-BR case, accents, spacing, typographic glyphs). */
export const foldedLiteral = (text: string) => trimmed(foldedUnits(text)).map(unit => unit.char).join("");

/** Every span [start,end) of the ORIGINAL message whose folded form equals the folded
 * literal, with whole-token boundaries at both ends ('10' never inside '100', 'ana'
 * never inside 'mariana'). An empty or blank literal proves nothing. */
export function literalSpans(message: string, literal: string, wholeTokens = true): [number, number][] {
  const source = foldedUnits(message), needle = trimmed(foldedUnits(literal)), spans: [number, number][] = [];
  if (!needle.length) return spans;
  for (let at = 0; at + needle.length <= source.length; at++) {
    if (!needle.every((unit, k) => source[at + k].char === unit.char)) continue;
    const last = at + needle.length - 1;
    if (wholeTokens && (word(needle[0]) && word(source[at - 1]) || word(needle.at(-1)) && word(source[last + 1]))) continue;
    spans.push([source[at].start, endOf(source, last, message.length)]);
  }
  return spans;
}

/** Tolerant spans, narrowed to byte-exact copies when Luna copied the bytes: an exact
 * occurrence identifies the quote better than a folded one. Folding only widens a
 * proof that would otherwise be absent. */
export function literalProofSpans(message: string, literal: string): [number, number][] {
  const spans = literalSpans(message, literal), exact = spans.filter(([start, end]) => message.slice(start, end) === literal.trim());
  return exact.length ? exact : spans;
}

/** Offsets between an original string and a per-code-point normalization of it (for
 * example NFD without marks + lowercase, which may drop code units). Undefined when
 * the per-code-point result differs from the caller's whole-string normalization. */
export function normalizedOffsets(original: string, normalize: (text: string) => string) {
  const starts: number[] = [];let text = "";
  for (let at = 0; at < original.length;) {
    const part = String.fromCodePoint(original.codePointAt(at)!), folded = normalize(part);
    for (let k = 0; k < folded.length; k++) starts.push(at);
    text += folded; at += part.length;
  }
  if (text !== normalize(original)) return;
  const toOriginal = (offset: number) => offset < starts.length ? starts[offset] : original.length;
  const toNormalized = (offset: number) => {
    let low = 0, high = starts.length;
    while (low < high) { const middle = (low + high) >> 1; if (starts[middle] < offset) low = middle + 1; else high = middle; }
    return low;
  };
  return { text, toOriginal, toNormalized };
}
