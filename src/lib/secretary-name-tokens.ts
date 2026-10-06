import { foldedLikePattern, nameTokens } from "./name-search";

/** C5 (flag SALON_SECRETARY_WHOLE_NAME_MATCH, default off; V4 MV01, MV20, MV25): a person search (customers, professionals) matches a
 * registered name only when EVERY token of the query is a whole token of that name: case, accents and the particles
 * "da/de/do/das/dos/e" aside, hyphens and other punctuation split ("hee jin" is "Hee-Jin"), in any order. Part of a token never
 * matches ("Nara" is not "Tainara"; "Ana" is neither "Mariana" nor "Anabela"); every homonym matches, so several rows still ask.
 * Callers keep their tenant scope, projection, order and bound: the database only prefilters (a whole token is always a
 * substring) and this module decides. Service searches keep their historical substring (a catalog phrase, not a person).
 * The switch name never contains TOKEN/KEY/SECRET: the evaluation flag snapshot drops such names as credentials (C5 review). */
export const nameTokensEnabled = () => process.env.SALON_SECRETARY_WHOLE_NAME_MATCH === "true";
/** Prefiltered rows read per search. Above it nothing is decided on a truncated set: the caller keeps its historical search. */
export const NAME_TOKEN_SCAN = 1000;
export type NameTokenQuery = { tokens: string[]; patterns: string[] };
/** The query's folded whole tokens (particles dropped) and, for the prefilter, one escaped `%token%` pattern per written token
 * (combining marks stay inside a token, as the folding strips them). */
export function nameTokenQuery(query: string): NameTokenQuery {
  const pairs = query.normalize("NFC").split(/[^\p{L}\p{M}\p{N}]+/u).flatMap(raw => nameTokens(raw).map(token => ({ raw, token })));
  return { tokens: [...new Set(pairs.map(pair => pair.token))], patterns: [...new Set(pairs.map(pair => foldedLikePattern(pair.raw)))] };
}
/** Whether every query token is a whole token of `name` (never true without tokens or without a name). */
export function nameHasTokens(tokens: readonly string[], name: unknown) {
  if (!tokens.length || typeof name !== "string") return false;
  const own = new Set(nameTokens(name));
  return tokens.every(token => own.has(token));
}
/** Ids of prefiltered rows whose name holds every token, in the prefilter's order; undefined when the rows are not a list or
 * more than `scan` came back (the caller then keeps its historical search: a truncated set never proves a single match). */
export function tokenMatchedIds(tokens: readonly string[], rows: unknown, scan = NAME_TOKEN_SCAN): string[] | undefined {
  if (!Array.isArray(rows) || rows.length > scan) return undefined;
  return rows.flatMap(row => row && typeof row.id === "string" && nameHasTokens(tokens, row.name) ? [row.id as string] : []);
}
