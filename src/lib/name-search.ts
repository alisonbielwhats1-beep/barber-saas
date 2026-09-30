/** Case- and accent-insensitive name matching ("joao" finds "João"). Pure module: callers
 * write the SQL in their own tagged `$queryRaw`, keeping tenant scope, projections and
 * ambiguity handling (several matches still ask):
 *   lower(translate(name, ${FOLD_FROM}, ${FOLD_TO})) LIKE lower(translate(${foldedLikePattern(term)}, ${FOLD_FROM}, ${FOLD_TO})) ESCAPE '\'
 * `translate` runs before `lower`, so the result does not depend on the database locale. */
export const FOLD_FROM = "ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäåéèêëíìîïóòôõöúùûüçñ";
export const FOLD_TO = "AAAAAAEEEEIIIIOOOOOUUUUCNaaaaaaeeeeiiiiooooouuuucn";

/** `%term%` with LIKE wildcards typed by the user matched literally (escape character `\`). */
export function foldedLikePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}

/** Ids from a folded-name query; anything that is not a row id is ignored. */
export function foldedIds(rows: unknown): string[] {
  return Array.isArray(rows) ? rows.flatMap(row => row && typeof (row as { id?: unknown }).id === "string" ? [(row as { id: string }).id] : []) : [];
}

/** Same folding in the application, for comparing names with the user's text. */
export function foldName(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").toLocaleLowerCase("pt-BR");
}

// ---------------------------------------------------------------- tolerant scorer (C3, suggestions only)
// Never resolves an entity: callers show scored rows as options the owner must choose.
const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e"]);
/** Folded name tokens (split on anything that is not a letter or digit), particles dropped. */
export function nameTokens(text: string) {
  return foldName(text).split(/[^\p{L}\p{N}]+/u).filter(token => token && !PARTICLES.has(token));
}
/** Bounded optimal-string-alignment (Damerau) distance; anything above `k` is returned as `k + 1`. */
export function osaDistance(a: string, b: string, k: number) {
  const s = [...a], t = [...b];
  if (Math.abs(s.length - t.length) > k) return k + 1;
  let before: number[] = [], previous = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const row = [i]; let low = i;
    for (let j = 1; j <= t.length; j++) {
      let value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) value = Math.min(value, before[j - 2] + 1);
      row[j] = value; low = Math.min(low, value);
    }
    // Row minima never decrease, so a row above k proves the distance is above k.
    if (low > k) return k + 1;
    before = previous; previous = row;
  }
  return Math.min(previous[t.length], k + 1);
}
/** One query token against one name token: exact 1; a prefix of 3+ characters 0.97; a one-letter
 * initial on a non-first query token 0.9; otherwise 1 - d/max(length) for a bounded OSA distance
 * d <= k (k = 0 up to 3 characters, 1 for 4-7, 2 for 8+); 0 when nothing applies. */
export function tokenSimilarity(query: string, name: string, position = 0) {
  if (query === name) return 1;
  const q = [...query].length, n = [...name].length;
  if (q >= 3 && name.startsWith(query)) return 0.97;
  if (q === 1 && position > 0 && name.startsWith(query)) return 0.9;
  const k = q <= 3 ? 0 : q <= 7 ? 1 : 2;
  if (!k) return 0;
  const d = osaDistance(query, name, k);
  return d > k ? 0 : 1 - d / Math.max(q, n);
}
/** Candidate score: every query token needs its own distinct name token; the score is the minimum
 * similarity of the best such assignment (0 when a query token is left without one). */
export function nameScore(query: readonly string[], name: readonly string[]) {
  if (!query.length || query.length > name.length || query.length > 6 || name.length > 12) return 0;
  const similarity = query.map((token, i) => name.map(other => tokenSimilarity(token, other, i)));
  const used = name.map(() => false);
  let best = 0;
  const walk = (i: number, low: number) => {
    if (low <= best) return;
    if (i === query.length) { best = low; return; }
    for (let j = 0; j < name.length; j++) if (!used[j] && similarity[i][j] > 0) {
      used[j] = true; walk(i + 1, Math.min(low, similarity[i][j])); used[j] = false;
    }
  };
  walk(0, 1);
  return best;
}
export const SUGGESTION_THRESHOLD = 0.8;
export const SUGGESTION_LIMIT = 5;
/** Scores this close at the cut are a tie: ask for more detail instead of truncating. */
export const SUGGESTION_TIE = 0.02;
export type NameSuggestions<T> = { status: "SUGGEST"; rows: T[] } | { status: "DETAIL" | "NONE" };
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Deterministic: score desc, folded name, name, id. The same rows always give the same options. */
export function rankNameSuggestions<T extends { id: string; name: string }>(query: string, rows: readonly T[]): NameSuggestions<T> {
  // C7: neither a leading article nor an honorific is required of a suggested name.
  const named = withoutArticle(query), tokens = nameTokens(withoutHonorific(named) ?? named);
  if (!tokens.length) return { status: "NONE" };
  const seen = new Set<string>();
  const scored = rows.flatMap(row => seen.has(row.id) || !seen.add(row.id) ? [] : [{ row, key: foldName(row.name), score: nameScore(tokens, nameTokens(row.name)) }])
    .filter(item => item.score >= SUGGESTION_THRESHOLD - 1e-9)
    .sort((a, b) => b.score - a.score || order(a.key, b.key) || order(a.row.name, b.row.name) || order(a.row.id, b.row.id));
  if (!scored.length) return { status: "NONE" };
  if (scored.length > SUGGESTION_LIMIT && scored[SUGGESTION_LIMIT - 1].score - scored[SUGGESTION_LIMIT].score <= SUGGESTION_TIE + 1e-9) return { status: "DETAIL" };
  return { status: "SUGGEST", rows: scored.slice(0, SUGGESTION_LIMIT).map(item => item.row) };
}
// ---------------------------------------------------------------- person names: articles and honorifics (C7)
/** A leading article is never part of a person's name ("a carla" is Carla). */
const ARTICLES = new Set(["a", "o"]);
/** Honorifics are kept for search (a record may carry one: "Dona Cida") but never required: a search that finds
 * nothing with one is repeated without it ("dona cida" finds "Cida Souza"). A name never gains one it lacks. */
export const HONORIFICS = new Set(["dona", "seu", "sr", "sra"]);
const leading = (name: string, words: ReadonlySet<string>) => {
  const match = /^\s*([^\s]+)\s+(\S[\s\S]*)$/u.exec(name);
  const rest = match && words.has(foldName(match[1]).replace(/\.$/, "")) ? match[2].trim() : undefined;
  return rest && rest.length >= 2 ? rest : undefined;
};
/** The name without a leading article ("a carla" → "carla"); unchanged when there is none. */
export const withoutArticle = (name: string) => leading(name, ARTICLES) ?? name;
/** The name without a leading honorific ("dona cida" → "cida"), or undefined when it has none. */
export const withoutHonorific = (name: string) => leading(name, HONORIFICS);
/** Whether every token of a name the model emitted is also a token of the user's text (case, accents
 * and particles ignored; a leading article is not part of the name; a digit token is compared with the text's digits). */
export function nameInText(name: string, text: string) {
  const tokens = nameTokens(withoutArticle(name)), words = new Set(nameTokens(text)), digits = text.replace(/\D+/g, "");
  return tokens.length > 0 && tokens.every(token => /^\d+$/.test(token) ? digits.includes(token) : words.has(token));
}
/** Same name ignoring case, accents, punctuation, particles and a leading article. */
export function sameName(a: string, b: string) {
  const x = nameTokens(withoutArticle(a)).join(" ");
  return x.length > 0 && x === nameTokens(withoutArticle(b)).join(" ");
}
/** C7: a directory name Luna expanded from the owner's words ("rodrigo" → "Rodrigo Lima") is proven when the name's
 * tokens the owner wrote (exact folded tokens of `text`, the action's scope) are a subset of exactly ONE entry of the
 * salon directory and that entry is the name itself. A typo or a name the text does not contain proves nothing
 * (it stays a suggestion to confirm); a subset shared by two entries ("Rodrigo Lima", "Rodrigo Alves") never picks. */
export function directorySubsetProof(name: string, text: string, directory: readonly string[]) {
  const words = new Set(nameTokens(text)), said = nameTokens(withoutArticle(name)).filter(token => words.has(token));
  if (!said.length) return false;
  const holders = directory.filter(entry => { const own = new Set(nameTokens(entry)); return said.every(token => own.has(token)); });
  return holders.length === 1 && sameName(holders[0], name);
}
