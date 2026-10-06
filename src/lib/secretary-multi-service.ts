import { serviceListOperation, serviceListResolved, type SchedulingFields } from "./scheduling-contract";
import type { SchedulingState } from "./secretary-scheduling";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { listSchedulingServices } from "./scheduling-catalog";
import { detailQuestion, nameSuggestionsEnabled, recordNameCheck, salonDirectoryNames, suggestedRows, suggestionQuestion, suggestSchedulingServices } from "./entity-suggestions";
import { foldName, nameTokens, sameName, withoutArticle } from "./name-search";
import { entityQuoteDenied } from "./scheduling-temporal-source";
import { serviceDirectoryProof, validateSchedulingEntityMentions, withoutCustomerMentions } from "./scheduling-entity-mentions";
import { sameAcceptedQuery } from "./secretary-entity-context";
import { optionId, writesOptionName, type PublishedOption } from "./secretary-options";
import { literalProofSpans } from "../../packages/salon-secretary/src/literal-match";
import { multiServiceEnabled } from "../../packages/salon-secretary/src/multi-service";

/** P2b (flag SALON_SECRETARY_MULTI_SERVICE): ONE appointment.create/availability.get with several services the owner said
 * ("corte e barba", "pé e mão") and ONE professional. Luna only lists the owner's words (`service_names`); this module proves
 * each of them, resolves them one card at a time (a homonym is asked, never picked), asks when a catalog service already
 * joins two or more of them (a combo is never booked beside its own parts), refuses a repeated service, and asks when the
 * owner's words for the action name two or more professionals (a visit split across professionals is out of scope). The
 * professional who attends must perform every service, availability uses the duration the domain sums, and only Confirmar
 * writes (the existing create path: one createVisit group, one appointment). */
export const serviceListCards = ["service_list_ref", "service_combo_ref"] as const;
export type ServiceListCard = (typeof serviceListCards)[number];
/** The option of a combo card that keeps the owner's services separate (never an entity ref). */
export const SEPARATE_SERVICES_REF = "services-separate";
/** Words of the missing-field fallback question (never the presentation-digest map). */
export const serviceListMissingLabels: Record<string, string> = { service_list_ref: "serviços" };
export const isServiceListField = (field?: string) => field === "service_names" || (serviceListCards as readonly string[]).includes(field ?? "");
const joined = (names: readonly string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
const quoted = (name: string) => `“${name}”`;
export const severalProfessionalsQuestion = "Um agendamento com vários serviços fica com um só profissional, e você citou mais de um. Com quem fica o atendimento? Para profissionais diferentes, peça um agendamento para cada um.";
/** The professional who attends must perform every service of the list (never one per service). */
export const notPerformingAll = "O profissional informado não faz todos esses serviços. Escolha um profissional que faça todos.";
export const nobodyPerformsAll = "Nenhum profissional faz todos esses serviços no mesmo atendimento. Para profissionais diferentes, peça um agendamento para cada um.";
/** An answer that does not resolve the open service card: said above the same card, never a silent re-ask. */
export const unansweredServiceCard = "Não consegui associar essa resposta com segurança a um dos serviços.";
const askServices = "Quais serviços devo marcar?";

type GroundState = { fields: SchedulingFields; selected_names?: SchedulingState["selected_names"]; resolved_names?: SchedulingState["resolved_names"]; candidates?: SchedulingState["candidates"];
  service_combo_declined?: SchedulingState["service_combo_declined"]; references?: SchedulingState["references"] };
export type ListGrounding = { names?: string[]; refs?: (string | null)[]; single?: string; dropSingle?: boolean; ask?: "service_names" | "professional_name"; notice?: string };
/** C4 owner rule 9 (flag on): the catalog decides a combo, never the form Luna chose for the owner's words. One service_name that
 * joins two or more services with the closed class of joining words (comboParts) is read as the owner's list when ONE catalog
 * service joins every one of them, so resolveServiceList decides as for a list: that combo alone is used, the combo and the
 * services apart are asked (never picked). Only the owner's own words this turn (a literal of the message): never an echo of the
 * accepted service, the answer to an open service card, a held list or a create in a released slot. Anything else (no catalog
 * service joins them all: "corte com navalha") keeps the single-service path: the backend never splits a name by itself.
 * A combo's registered name Luna wrote for the owner's words (the C7 directory proof: "hidratação e escova" → "Combo hidratação e
 * escova") is read by the owner's own words for each of its parts; when a part has none (the owner named the combo itself: "o
 * combo"), it keeps the single-service path.
 * FX6 (review, safety): a create in a released slot books ONE service (never a list): it keeps the single-service path, where a
 * combo that its parts' own registrations make a choice is a card (singleServiceCombo); a combo's registered name Luna wrote for
 * the owner's words is read back as those words (`rewrite`), so the card is never skipped as if the owner had named the combo. */
async function coordinatedServices(actor: ServiceActor, c: GroundState, operation: string, single: string | undefined, source: string | undefined, customer: string | undefined): Promise<string[] | "echo" | { rewrite: string } | undefined> {
  if (!multiServiceEnabled() || single == null || source === undefined || !serviceListOperation(operation) || c.fields.service_names) return;
  if (c.candidates && (c.candidates.kind === "service_ref" || (serviceListCards as readonly string[]).includes(c.candidates.kind))) return;
  const ref = c.fields.service_ref;
  if (sameAcceptedQuery(single, c.fields.service_name) || !!ref && (sameAcceptedQuery(single, c.selected_names?.service_name) || sameAcceptedQuery(single, c.resolved_names?.[ref]))) return;
  if (c.references?.released) {
    if (literalProofSpans(source, single).length || !nameSuggestionsEnabled() || comboParts(single).length < 2 || !await serviceDirectoryProof(actor, source, single, customer)) return;
    const words = new Set(nameTokens(await withoutCustomerMentions(actor, source, customer)));
    const own = comboParts(single).map(part => nameTokens(part).filter(token => words.has(token)).join(" "));
    if (own.some(part => !part)) return;
    const said = joined(own), cover = await comboCover(tenantLister(actor), said);
    return cover && (cover.apart || cover.combos.length > 1 || cover.unsaid.length) ? { rewrite: said } : undefined;
  }
  let said = comboParts(single);
  if (!literalProofSpans(source, single).length) {
    if (!nameSuggestionsEnabled() || said.length < 2 || !await serviceDirectoryProof(actor, source, single, customer)) return;
    const words = new Set(nameTokens(await withoutCustomerMentions(actor, source, customer)));
    said = said.map(part => nameTokens(part).filter(token => words.has(token)).join(" "));
    if (said.some(part => !part)) return;
  }
  const parts: string[] = [];
  for (const part of said) if (!parts.some(item => sameAcceptedQuery(part, item))) parts.push(part);
  if (parts.length < 2 || parts.length > 10 || parts.some(part => part.trim().length < 2)) return;
  const rows = await Promise.all(parts.map(name => withTenant(actor, tx => listSchedulingServices(tx, actor, name))));
  const whole = coveringServices(parts, rows, new Set(c.service_combo_declined ?? [])).filter(entry => parts.every((_, index) => entry.items.includes(index)));
  // The combo already accepted for this action, restated in the owner's words, is not a new request: kept as it is.
  return !whole.length ? undefined : whole.some(entry => entry.row.id === ref) ? "echo" as const : parts;
}
/** Interpretation step. `said`: the services Luna listed; `single`: its service_name. Fold-equal repeats are one service; one
 * service left is the single-service path (proved and resolved as today). A service_name beside the list must be one of its
 * services (else the two readings contradict: asked). A service whose every mention is denied in its own clause is never
 * booked, and one the message does not prove (literal, or the C7 directory proof) is not kept: either asks the services and
 * keeps none of them. Re-echoes of the accepted services need no new proof and keep what was resolved for them. */
export async function groundServiceList(actor: ServiceActor, c: GroundState, operation: string, said: readonly string[] | null | undefined, single: string | undefined,
  source: string | undefined, customer: string | undefined, codes: string[]): Promise<ListGrounding> {
  const items: string[] = [];
  for (const value of said ?? []) { const name = value.trim(); if (!items.some(item => sameAcceptedQuery(name, item))) items.push(name); }
  // C4 owner rule 9: ONE service (the service_name, or a one-item list agreeing with it) that joins services a catalog service joins.
  const one = said == null ? single : items.length === 1 && (single == null || sameAcceptedQuery(single, items[0])) ? items[0] : undefined;
  const coordinated = one === undefined ? undefined : await coordinatedServices(actor, c, operation, one, source, customer);
  if (coordinated === "echo") { codes.push("MULTI_SERVICE_COMBO_ECHO"); return { dropSingle: true }; }
  if (coordinated && "rewrite" in coordinated) { codes.push("MULTI_SERVICE_RELEASED_COMBO_WORDS"); return { single: coordinated.rewrite }; }
  const form = coordinated;
  if (said == null && !form) return {};
  if (!multiServiceEnabled() || !serviceListOperation(operation)) throw Error("CAPABILITY_FIELD_MISMATCH");
  if (single != null && said != null && !items.some(item => sameAcceptedQuery(single, item))) {
    codes.push("MULTI_SERVICE_CONFLICT");
    return { ask: "service_names", notice: `Recebi indicações diferentes para os serviços e não escolhi nenhuma. ${askServices}` };
  }
  if (form) { codes.push("MULTI_SERVICE_COORDINATED"); items.splice(0, items.length, ...form); }
  const dropSingle = single != null;
  if (items.length === 1) return { single: items[0] };
  if (source !== undefined) for (const item of items) {
    const spans = literalProofSpans(source, item);
    if (spans.length && spans.every(([start, end]) => entityQuoteDenied(source, start, end, operation))) {
      codes.push("MULTI_SERVICE_NEGATED");
      return { ask: "service_names", notice: `Na sua mensagem ${quoted(item)} aparece com negação, então não marquei nenhum serviço. ${askServices}` };
    }
  }
  const accepted = c.fields.service_names ?? (c.fields.service_name ? [c.fields.service_name] : []);
  if (c.fields.service_names && items.length === accepted.length && items.every((item, index) => sameAcceptedQuery(item, accepted[index]))) return { dropSingle };
  const acceptedRefs = c.fields.service_names ? c.fields.service_list_ref ?? [] : c.fields.service_ref ? [c.fields.service_ref] : [];
  const chosen = c.fields.service_ref ? c.selected_names?.service_name : undefined;
  // A re-echo of an accepted service: the owner's earlier words, the option they chose, or its registered name.
  const carried = (item: string) => {
    const at = accepted.findIndex((name, index) => sameAcceptedQuery(item, name) || !!acceptedRefs[index] && sameAcceptedQuery(item, c.resolved_names?.[acceptedRefs[index]!]));
    return at >= 0 ? { ref: acceptedRefs[at] ?? null } : chosen && sameAcceptedQuery(item, chosen) ? { ref: c.fields.service_ref! } : undefined;
  };
  const refs: (string | null)[] = [];
  for (const item of items) {
    const kept = carried(item);
    refs.push(kept?.ref ?? null);
    if (kept || source === undefined || await serviceProven(actor, source, item, customer)) continue;
    codes.push("ENTITY_MENTION_CONFLICT");
    return { ask: "service_names", notice: `Não consegui confirmar ${quoted(item)} na sua mensagem, então não marquei nenhum serviço. ${askServices}` };
  }
  if (source !== undefined && await namesSeveralProfessionals(actor, source, customer, items)) {
    codes.push("MULTI_SERVICE_PROFESSIONALS");
    return { names: items, refs, dropSingle, ask: "professional_name", notice: severalProfessionalsQuestion };
  }
  return { names: items, refs, dropSingle };
}
/** A service literal of the message outside the customer's name, or (C7 flag) the directory's single service the owner's
 * tokens single out. */
async function serviceProven(actor: ServiceActor, source: string, name: string, customer: string | undefined) {
  try { await validateSchedulingEntityMentions(actor, source, { customer_name: customer, service_name: name }); return true; }
  catch (error) {
    if (!(error instanceof Error && error.message === "ENTITY_MENTION_CONFLICT")) throw error;
    if (!nameSuggestionsEnabled()) return false;
    const proof = await serviceDirectoryProof(actor, source, name, customer);
    recordNameCheck({ role: "service", in_message: false, option_echo: false, ...(proof ? { directory_proof: true as const } : {}) });
    return proof;
  }
}
/** Whether the owner's words for this action name two or more of the salon's professionals: the salon directory's name tokens
 * the text holds outside the customer's name and the services said, when no single professional of the directory holds them
 * all ("com o Caio … com a Lia" names two; "com a Ana Paula" names one). A directory above the pool proves nothing. */
export async function namesSeveralProfessionals(actor: ServiceActor, source: string, customer: string | undefined, services: readonly string[]) {
  const directory = await withTenant(actor, tx => salonDirectoryNames(tx, actor, "professional"));
  if (!directory?.length) return false;
  let text = await withoutCustomerMentions(actor, source, customer);
  for (const service of services) {
    const folded = foldName(service.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (folded) text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${folded}(?![\\p{L}\\p{N}])`, "gu"), match => " ".repeat(match.length));
  }
  const words = new Set(nameTokens(text)), entries = directory.map(name => new Set(nameTokens(withoutArticle(name))));
  const named = [...new Set(entries.flatMap(tokens => [...tokens].filter(token => words.has(token))))];
  return named.length > 1 && !entries.some(tokens => named.every(token => tokens.has(token)));
}
/** A single service Luna emitted while the action holds a list (service_name, or a one-item service_names; no list this turn).
 * While a service card of the list is open it can only answer that card: Luna restates an option whose name the owner's own words
 * single out (a pick), or it is not an answer (asked again, never a replacement that would drop the other services). Otherwise a
 * restatement of one of the list's services (its words, or the registered name resolved for it) that the owner's message does not
 * contain changes nothing. Review A: anything else — one of them the owner's words name (restating it, or narrowing the list to
 * it?), or another service (adding it, or replacing the list?) — is never a silent replacement: `conflict` asks the services and
 * keeps none of them (the next answer starts clean; the proposal never drops a service by itself). */
export function listAnswer(c: GroundState, single: string | undefined, source: string | undefined): { echo?: true; pick?: string; unanswered?: true; conflict?: string } | undefined {
  const names = c.fields.service_names;
  if (!names || single == null) return;
  const card = c.candidates;
  if (card && (serviceListCards as readonly string[]).includes(card.kind)) {
    const published: PublishedOption[] = card.items.map((item, index) => ({ option_id: optionId(index), label: item.name, ref: item.id, field: card.kind }));
    const named = published.filter(option => option.ref !== SEPARATE_SERVICES_REF && sameName(option.label, single) && source !== undefined && writesOptionName(source, option, published));
    return named.length === 1 ? { pick: named[0].ref } : { unanswered: true };
  }
  const refs = c.fields.service_list_ref ?? [];
  const restated = names.some((name, index) => sameAcceptedQuery(single, name) || !!refs[index] && sameAcceptedQuery(single, c.resolved_names?.[refs[index]!]));
  if (restated && !(source !== undefined && literalProofSpans(source, single).length)) return { echo: true };
  return { conflict: `O pedido tinha ${joined(names.map(quoted))} e agora recebi só ${quoted(single.trim())}; não marquei nenhum serviço. ${askServices}` };
}

type Resolution = { notice?: string; waiting_for?: string; candidates?: SchedulingState["candidates"]; codes: string[] };
type Row = { id: string; name: string };
/** A catalog service found for two or more of the owner's services (that are not words of one another): it may already be
 * what the owner asked for as one service. */
export function coveringServices(names: readonly string[], rows: readonly (readonly Row[])[], declined: ReadonlySet<string>) {
  const found = new Map<string, { row: Row; items: number[] }>();
  rows.forEach((list, index) => list.forEach(row => { const entry = found.get(row.id) ?? { row, items: [] }; entry.items.push(index); found.set(row.id, entry); }));
  const apart = (a: number, b: number) => !foldName(names[a]).includes(foldName(names[b])) && !foldName(names[b]).includes(foldName(names[a]));
  return [...found.values()].filter(entry => !declined.has(entry.row.id) && entry.items.some((a, i) => entry.items.slice(i + 1).some(b => apart(a, b))));
}
/** The parts a catalog name joins with the closed class of joining words and signs (the coordinating "e", the comitative "com",
 * "+" and the comma), as registered; one part when it joins nothing ("Corte infantil"). */
export const comboParts = (name: string) => name.split(/\s*[+,]\s*|\s+(?:e|com)\s+/iu).map(part => withoutArticle(part.trim())).filter(part => nameTokens(part).length);
/** The salon's service search for one name (the tenant's own rows; a transaction already open, or one per call). */
export type ServiceLister = (name: string) => Promise<readonly Row[]>;
const tenantLister = (actor: ServiceActor): ServiceLister => name => withTenant(actor, tx => listSchedulingServices(tx, actor, name));
/** Review A: the parts of a combo that none of the owner's services names in full (each part's name tokens within one said
 * service's). A combo is the request by itself only when it books nothing the owner did not say. FX6 (review, the label rule of
 * the alteration's namedComboPart): a word of a part that names no service registered on its own ("Combo", "Kit") is the combo's
 * label, never a service the owner left unsaid. */
async function unsaidParts(name: string, said: readonly string[], list: ServiceLister) {
  const out: string[] = [], labels = new Map<string, boolean>();
  const label = async (token: string) => {
    if (!labels.has(token)) labels.set(token, token.length >= 2 && !(await list(token)).some(row => comboParts(row.name).length < 2));
    return labels.get(token)!;
  };
  for (const part of comboParts(name)) {
    const tokens = nameTokens(part);
    let named = false;
    for (const service of said) {
      const words = new Set(nameTokens(service)), rest = tokens.filter(token => !words.has(token));
      if (rest.length === tokens.length) continue;
      named = true;
      for (const token of rest) if (!await label(token)) { named = false; break; }
      if (named) break;
    }
    if (!named) out.push(part);
  }
  return out;
}
/** C4 owner rule 9 for ONE service text that joins services (comboParts): the catalog combos that join every one of them, whether
 * those services also exist apart, and the parts a single combo holds beyond them. Undefined: no combo. */
export async function comboCover(list: ServiceLister, said: string) {
  const parts = comboParts(said);
  if (parts.length < 2 || parts.length > 10 || parts.some(part => part.trim().length < 2)) return;
  const rows = await Promise.all(parts.map(list));
  const whole = coveringServices(parts, rows, new Set()).filter(entry => parts.every((_, index) => entry.items.includes(index)));
  if (!whole.length) return;
  const ids = new Set(whole.map(entry => entry.row.id));
  return { parts, combos: whole.map(entry => entry.row), apart: parts.every((_, index) => rows[index].some(row => !ids.has(row.id))),
    unsaid: whole.length === 1 ? await unsaidParts(whole[0].row.name, parts, list) : [] };
}
/** C4 owner rule 9 for ONE service entry of an alteration (the tenant's search). */
export const joinedServices = (actor: ServiceActor, said: string) => comboCover(tenantLister(actor), said);
/** The end of singleServiceCombo's question (the plan asks with the adapter's own text when a card's message ends with it). */
export const SINGLE_COMBO_TAIL = "para os serviços separados, peça esse agendamento à parte. Nada foi marcado.";
export const isSingleComboQuestion = (message: string | undefined) => !!message?.endsWith(SINGLE_COMBO_TAIL);
/** Every word of a name as written, in order (case, accents and a leading article aside; "e"/"com" kept). */
const fullName = (name: string) => foldName(withoutArticle(name.trim())).split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
/** FX6 (review, owner rule 9, safety; flag SALON_SECRETARY_MULTI_SERVICE): ONE service text a single-service path would resolve to
 * the one row its search found (`rows`: a create in the slot a move or a cancellation frees, where one service is booked; a text
 * the list reading did not take). When that row is a catalog combo joining the services the text joins (comboParts) and those
 * services also exist apart (or several combos join them, or the combo holds a part never said), the combo is never picked by the
 * words' form: a card of the combo(s) the search found, and the question says why (these paths book one service: the services
 * apart are a request of their own). Undefined: flag off, nothing joined, the text IS a combo's registered name (every word), or
 * the one combo IS the request (rule 9, case 1: used). */
export async function singleServiceCombo(list: ServiceLister, query: string, rows: readonly Row[]) {
  if (!multiServiceEnabled() || rows.length !== 1 || comboParts(query).length < 2) return;
  const cover = await comboCover(list, query), items = cover?.combos.filter(row => rows.some(found => found.id === row.id)) ?? [];
  if (!cover || !items.length || items.some(row => fullName(row.name) === fullName(query))) return;
  if (!cover.apart && cover.combos.length === 1 && !cover.unsaid.length) return;
  const named = joined(items.map(row => quoted(row.name))), one = items.length === 1;
  return { notice: `No catálogo, ${named} já ${one ? "junta" : "juntam"} ${joined(cover.parts)}${cover.apart ? ", e esses serviços também existem separados" : ""}${cover.unsaid.length ? `; ${named} inclui também ${joined(cover.unsaid)}` : ""}. Selecione ${one ? "esse serviço" : "um deles"} para usar aqui; ${SINGLE_COMBO_TAIL}`,
    items: items.map(row => ({ id: row.id, name: row.name })) };
}
/** The owner's services a combo replaces become that one catalog service, at the first one's position (one service left: the
 * single-service form, with the combo as the chosen option). The professional is resolved again for the new services. */
function applyCombo(c: SchedulingState, f: SchedulingFields, entry: { row: Row; items: readonly number[] }) {
  const first = Math.min(...entry.items), names: string[] = [], refs: (string | null)[] = [];
  f.service_names!.forEach((name, index) => {
    if (index === first) { names.push(entry.row.name); refs.push(entry.row.id); }
    else if (!entry.items.includes(index)) { names.push(name); refs.push(f.service_list_ref?.[index] ?? null); }
  });
  c.resolved_names = { ...c.resolved_names, [entry.row.id]: entry.row.name };
  delete f.professional_ref;
  if (c.selected_names) delete c.selected_names.professional_name;
  if (names.length > 1) { f.service_names = names; f.service_list_ref = refs; return; }
  delete f.service_names; delete f.service_list_ref;
  f.service_name = entry.row.name; f.service_ref = entry.row.id;
  c.selected_names = { ...c.selected_names, service_name: entry.row.name };
}
/** Preparation step. Flag off: a list kept from before is dropped (the service is asked; it never executes). Otherwise, while
 * any service is unresolved: a catalog combo of two or more of them is asked first (the combo, or the services apart; when no
 * said service exists apart, the single combo IS the request and is used), then each service by the same search as a single one
 * (one match: resolved; homonyms: a card; none: said, or suggestions with SALON_SECRETARY_NAME_SUGGESTIONS). A service
 * repeated in the list is refused. Mutates `f` (refs) and `c` (names, declined combos). */
export async function resolveServiceList(actor: ServiceActor, c: SchedulingState, f: SchedulingFields): Promise<Resolution> {
  if (!multiServiceEnabled()) { delete f.service_names; delete f.service_list_ref; return { codes: ["MULTI_SERVICE_DISABLED"] }; }
  const ask = (notice: string, code: string): Resolution => ({ notice, waiting_for: "service_names", codes: [code] });
  const card = (notice: string, candidates: NonNullable<SchedulingState["candidates"]>, code: string): Resolution => ({ notice, candidates, waiting_for: "service_names", codes: [code] });
  const codes: string[] = [];
  if (!serviceListResolved(f)) {
    const names = f.service_names!, refs = names.map((_, index) => f.service_list_ref?.[index] ?? null);
    const rows = await Promise.all(names.map(name => withTenant(actor, tx => listSchedulingServices(tx, actor, name))));
    const declined = new Set(c.service_combo_declined ?? []), covering = coveringServices(names, rows, declined);
    if (covering.length) {
      const coveringIds = new Set(covering.map(entry => entry.row.id)), covered = [...new Set(covering.flatMap(entry => entry.items))].sort((a, b) => a - b);
      const apart = covered.every(index => rows[index].some(row => !coveringIds.has(row.id) && !declined.has(row.id)));
      // Review A: a combo that also holds a part the owner never said is never booked by itself (asked, click or its name).
      const unsaid = !apart && covering.length === 1 ? await unsaidParts(covering[0].row.name, names, tenantLister(actor)) : [];
      if (!apart && covering.length === 1 && !unsaid.length) {
        // No said service exists apart: the one combo is what was asked for (the list shrinks, so this ends).
        applyCombo(c, f, covering[0]);
        const rest = f.service_names ? await resolveServiceList(actor, c, f) : { codes: [] };
        return { ...rest, codes: ["MULTI_SERVICE_COMBO_ONLY", ...rest.codes] };
      } else {
        const words = covered.map(index => names[index]);
        const alone = covered.filter(index => !rows[index].some(row => !coveringIds.has(row.id) && !declined.has(row.id))).map(index => quoted(names[index]));
        const extra = unsaid.length ? `${joined(alone)} não ${alone.length > 1 ? "existem" : "existe"} separado, e ${quoted(covering[0].row.name)} inclui também ${joined(unsaid)}. Marco esse serviço?` : undefined;
        return card(`No catálogo, ${joined(covering.map(entry => quoted(entry.row.name)))} já ${covering.length > 1 ? "juntam" : "junta"} ${joined(words)}. ${apart ? "Marco esse serviço ou os serviços separados?" : extra ?? "Qual deles?"} Selecione uma opção real.`,
          { kind: "service_combo_ref", items: [...covering.map(entry => ({ id: entry.row.id, name: entry.row.name })), ...(apart ? [{ id: SEPARATE_SERVICES_REF, name: `Separados: ${words.join(" + ")}` }] : [])] },
          extra ? "MULTI_SERVICE_COMBO_UNSAID" : "MULTI_SERVICE_COMBO");
      }
    }
    for (const [index, name] of names.entries()) {
      if (refs[index]) continue;
      const found = rows[index].filter(row => !declined.has(row.id));
      if (found.length === 1) { refs[index] = found[0].id; c.resolved_names = { ...c.resolved_names, [found[0].id]: found[0].name }; continue; }
      f.service_list_ref = refs;
      if (!found.length) {
        const suggested = nameSuggestionsEnabled() ? await withTenant(actor, tx => suggestSchedulingServices(tx, actor, name)) : undefined;
        const offered = suggestedRows(suggested ?? { status: "NONE" as const }).filter(row => !declined.has(row.id));
        if (offered.length) return card(suggestionQuestion(name, offered.map(row => row.name)), { kind: "service_list_ref", source: "suggest", items: offered.map(row => ({ id: row.id, name: row.name })) }, "MULTI_SERVICE_SUGGEST");
        return ask(suggested && suggested.status !== "NONE" && suggested.status !== "SUGGEST" ? detailQuestion(name, "serviço") : `Não encontrei o serviço ${quoted(name)}${declined.size ? " separado" : ""} neste salão. ${askServices}`, "MULTI_SERVICE_NOT_FOUND");
      }
      if (found.length > 20) return ask(`Muitas opções de serviço para ${quoted(name)}; informe um nome mais específico.`, "MULTI_SERVICE_TOO_MANY");
      return card(`Qual serviço você quis dizer com ${quoted(name)}? Selecione uma opção real.`, { kind: "service_list_ref", items: found.map(row => ({ id: row.id, name: row.name })) }, "MULTI_SERVICE_AMBIGUOUS");
    }
    f.service_list_ref = refs;
  }
  // One appointment never holds the same catalog service twice.
  const seen = new Set<string>();
  for (const [index, ref] of (f.service_list_ref as string[]).entries()) {
    if (!seen.has(ref)) { seen.add(ref); continue; }
    const name = c.resolved_names?.[ref] ?? f.service_names![index];
    delete f.service_names; delete f.service_list_ref;
    return ask(`${name} apareceu mais de uma vez no mesmo atendimento. ${askServices}`, "MULTI_SERVICE_DUPLICATE");
  }
  // Review A: nor a catalog combo beside one of its own parts ("Corte e barba" + "Barba"), however the list was worded.
  const registered = (f.service_list_ref as string[]).map((ref, index) => c.resolved_names?.[ref] ?? f.service_names![index]);
  for (const [index, name] of registered.entries()) {
    const parts = comboParts(name), part = parts.length > 1 ? registered.find((other, at) => at !== index && parts.some(piece => sameName(piece, other))) : undefined;
    if (!part) continue;
    delete f.service_names; delete f.service_list_ref;
    return ask(`${name} já inclui ${part}; o mesmo serviço não entra duas vezes no atendimento. ${askServices}`, "MULTI_SERVICE_COMBO_PART");
  }
  return { codes };
}
/** A click (or a verified pick) on a service-list card: only an option the card published, rechecked by the same search that
 * published it (fresh tenant rows). A combo pick replaces the services it joins; "separados" declines the card's combos for
 * this action; a service pick resolves the first unresolved service. Prepare checks everything again. */
export async function selectServiceList(actor: ServiceActor, selection: NonNullable<SchedulingState["candidates"]>, next: SchedulingState, ref: string) {
  const names = next.fields.service_names;
  if (!names) throw Error("SELECTION_INVALID");
  if (selection.kind === "service_combo_ref") {
    const combos = selection.items.filter(item => item.id !== SEPARATE_SERVICES_REF).map(item => item.id);
    if (ref === SEPARATE_SERVICES_REF) { next.service_combo_declined = [...new Set([...(next.service_combo_declined ?? []), ...combos])]; return; }
    const rows = await Promise.all(names.map(name => withTenant(actor, tx => listSchedulingServices(tx, actor, name))));
    const entry = coveringServices(names, rows, new Set(next.service_combo_declined ?? [])).find(item => item.row.id === ref);
    if (!entry) throw Error("SELECTION_INVALID");
    applyCombo(next, next.fields, entry);
    return;
  }
  const index = names.findIndex((_, position) => !next.fields.service_list_ref?.[position]);
  if (index < 0 || next.service_combo_declined?.includes(ref)) throw Error("SELECTION_INVALID");
  const current: Row[] = await withTenant(actor, async tx => selection.source === "suggest" ? suggestedRows(await suggestSchedulingServices(tx, actor, names[index])) : listSchedulingServices(tx, actor, names[index]));
  const row = current.find(item => item.id === ref);
  if (!row) throw Error("SELECTION_INVALID");
  const refs = names.map((_, position) => next.fields.service_list_ref?.[position] ?? null); refs[index] = ref;
  next.fields.service_list_ref = refs;
  next.resolved_names = { ...next.resolved_names, [ref]: row.name };
}
/** The services of a resolved list as the salon registered them ("Corte + Barba"); undefined for a single service. */
export const serviceListLabel = (c: Pick<SchedulingState, "resolved_names">, f: SchedulingFields) =>
  f.service_names ? f.service_names.map((name, index) => c.resolved_names?.[f.service_list_ref?.[index] ?? ""] ?? name).join(" + ") : undefined;
