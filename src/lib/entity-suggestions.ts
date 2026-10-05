import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import type { NameCheck, NameResolution } from "./secretary-router";
import { assertCustomerAccess } from "./customer-catalog";
import { isFirstPersonReference } from "./secretary-first-person";
import { maskPhone } from "./client-identity";
import { FOLD_FROM, FOLD_TO, nameTokens, phoneticNamesEnabled, phoneticPrefixes, rankNameSuggestions, withoutArticle, withoutHonorific, type NameSuggestions } from "./name-search";

/** C3 (rec 16): tolerant name SUGGESTIONS, behind SALON_SECRETARY_NAME_SUGGESTIONS (default off).
 * Used only after the unchanged exact/substring search found no row. A suggestion is never an
 * entity: it is published as options the owner must click, and every select path recomputes the
 * same deterministic set from the same query (tenant scoped, fresh rows) before accepting a ref. */
export function nameSuggestionsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.SALON_SECRETARY_NAME_SUGGESTIONS === "true";
}
/** Rows scored per lookup. Above the pool the name is too common to score: ask for more detail. */
export const SUGGESTION_POOL = { professionals: 100, services: 200, customers: 300 } as const;
export type Suggested<T> = NameSuggestions<T> | { status: "TOO_MANY" };
const query = z.string().trim().min(2).max(200);

/** Customers: SQL prefilter on a name token starting with the query's first two folded letters
 * (same salon, merged profiles hidden), at most 300 rows; the scorer runs on those rows only. */
export async function suggestSalonCustomers(tx: Tx, actor: ServiceActor, input: string): Promise<Suggested<{ id: string; name: string; phone: string | null }>> {
  await assertCustomerAccess(tx, actor);
  // C7: the prefilter reads the name itself: no leading article, no honorific (rankNameSuggestions ignores both too).
  const term = query.parse(input), named = withoutArticle(term), tokens = nameTokens(withoutHonorific(named) ?? named), prefix = tokens[0]?.slice(0, 2) ?? "";
  // Emails and phone numbers keep their exact paths; only ASCII prefixes reach the pattern.
  if (term.includes("@") || /^\d+$/.test(tokens.join("")) || !/^[a-z0-9]{2}$/.test(prefix)) return { status: "NONE" };
  // Owner 05/10 (flag SALON_SECRETARY_PHONETIC_NAMES): also the starts of the same sound ("Walter" reaches "Valter").
  const starts = phoneticNamesEnabled() ? `(?:${phoneticPrefixes(tokens[0]).filter(start => /^[a-z]{2}$/.test(start)).concat(prefix).filter((start, i, all) => all.indexOf(start) === i).join("|")})` : prefix;
  const rows = await tx.$queryRaw<{ id: string; name: string; phone: string | null }[]>`SELECT id, name, phone FROM "ClientProfile" WHERE "salonId"=${actor.salonId} AND "mergedIntoId" IS NULL AND lower(translate(name, ${FOLD_FROM}, ${FOLD_TO})) ~ ${`(^|[^a-z0-9])${starts}`} ORDER BY name, id LIMIT 301`;
  if (!Array.isArray(rows)) return { status: "NONE" };
  if (rows.length > SUGGESTION_POOL.customers) return { status: "TOO_MANY" };
  const ranked = rankNameSuggestions(term, rows.filter(row => typeof row?.id === "string" && typeof row.name === "string"));
  return ranked.status === "SUGGEST" ? { status: "SUGGEST", rows: ranked.rows.map(row => ({ id: row.id, name: row.name, phone: maskPhone(row.phone) })) } : ranked;
}
/** Services: every active service of the salon (at most 200), same projection as listSchedulingServices. */
export async function suggestSchedulingServices(tx: Tx, actor: ServiceActor, input: string) {
  await assertCustomerAccess(tx, actor);
  const term = query.parse(input);
  const rows = await tx.service.findMany({ where: { salonId: actor.salonId, active: true },
    select: { id: true, name: true, durationMin: true, priceCents: true, priceType: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: SUGGESTION_POOL.services + 1 });
  return rows.length > SUGGESTION_POOL.services ? { status: "TOO_MANY" } as const : rankNameSuggestions(term, rows);
}
/** Professionals: every active professional of the salon (eligible for the service when given), at most 100. */
export async function suggestSchedulingProfessionals(tx: Tx, actor: ServiceActor, input: { service_ref?: string; service_refs?: string[]; query: string }): Promise<Suggested<{ id: string; name: string }>> {
  await assertCustomerAccess(tx, actor);
  // P2b: `service_refs`: only professionals linked to EVERY one of these active services (one appointment's service list).
  const p = z.object({ service_ref: z.string().min(1).max(100).optional(), service_refs: z.array(z.string().min(1).max(100)).min(1).max(10).optional(), query }).strict().parse(input);
  // E2 (flag SALON_SECRETARY_REFERENCES_V2): a first-person pronoun is never fuzzy-matched to a name ("meu" → "Mateus").
  if (isFirstPersonReference(p.query)) return { status: "NONE" };
  const rows = await tx.professional.findMany({ where: { salonId: actor.salonId, active: true,
    ...(p.service_ref ? { services: { some: { serviceId: p.service_ref, service: { salonId: actor.salonId, active: true } } } } : {}),
    ...(p.service_refs ? { AND: p.service_refs.map(serviceId => ({ services: { some: { serviceId, service: { salonId: actor.salonId, active: true } } } })) } : {}) },
    select: { id: true, user: { select: { name: true } } }, orderBy: { id: "asc" }, take: SUGGESTION_POOL.professionals + 1 });
  if (rows.length > SUGGESTION_POOL.professionals) return { status: "TOO_MANY" };
  return rankNameSuggestions(p.query, rows.flatMap(row => row.user.name ? [{ id: row.id, name: row.user.name }] : []));
}
/** C7: every active professional or service name of the salon (the directory a subset proof reads, bounded by the
 * same pools), or undefined above the pool (then nothing is proven by the directory). */
export async function salonDirectoryNames(tx: Tx, actor: ServiceActor, kind: "professional" | "service"): Promise<string[] | undefined> {
  await assertCustomerAccess(tx, actor);
  if (kind === "service") {
    const rows = await tx.service.findMany({ where: { salonId: actor.salonId, active: true }, select: { name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: SUGGESTION_POOL.services + 1 });
    return rows.length > SUGGESTION_POOL.services ? undefined : rows.map(row => row.name);
  }
  const rows = await tx.professional.findMany({ where: { salonId: actor.salonId, active: true }, select: { user: { select: { name: true } } }, orderBy: { id: "asc" }, take: SUGGESTION_POOL.professionals + 1 });
  return rows.length > SUGGESTION_POOL.professionals ? undefined : rows.flatMap(row => row.user.name ? [row.user.name] : []);
}
/** Rows a select path may accept for a published suggestion card (empty unless the same set is suggested again). */
export const suggestedRows = <T>(result: Suggested<T>): T[] => result.status === "SUGGEST" ? result.rows : [];

const numbered = (labels: readonly string[]) => labels.map((label, index) => `${index + 1}. ${label}`).join("; ");
/** "Não encontrei “Tatiane”. Você quis dizer: 1. Tatiana Rocha?" The options are buttons; nothing is chosen for the owner. */
export function suggestionQuestion(name: string, labels: readonly string[]) {
  return `Não encontrei “${name.trim()}”. Você quis dizer: ${numbered(labels)}? Selecione uma opção ou escreva o nome completo.`;
}
/** Too many similar names (a tie at the cut, or a pool above its bound): never truncate, ask for detail. */
export function detailQuestion(name: string, kind: "cliente" | "serviço" | "profissional") {
  return `Não encontrei “${name.trim()}” e há vários nomes parecidos. ${kind === "cliente" ? "Informe o sobrenome ou o telefone." : `Informe o nome completo do ${kind}.`}`;
}
/** A name the model wrote differently from the message is only a suggestion: the owner confirms it. */
export function confirmQuestion(kind: "cliente" | "profissional", labels: readonly string[]) {
  return `Confirme o ${kind}: você quis dizer ${numbered(labels)}? Selecione uma opção ou escreva o nome completo.`;
}

// ---------------------------------------------------------------- telemetry (codes and booleans only)
type NameObserver = (entry: { check?: NameCheck; resolution?: NameResolution }) => void;
const observer = new AsyncLocalStorage<NameObserver>();
/** Per-message observer (router trace). Never receives a name, a label or message text. */
export function withNameObserver<T>(sink: NameObserver, task: () => T): T {
  return observer.run(sink, task);
}
export function recordNameCheck(check: NameCheck) {
  try { observer.getStore()?.({ check }); } catch { /* Telemetry never changes the turn. */ }
}
export function recordNameResolution(kind: NameResolution["kind"], outcome: NameResolution["outcome"], n: number) {
  try { observer.getStore()?.({ resolution: { kind, outcome, n } }); } catch { /* Telemetry never changes the turn. */ }
}
