import { schedulingAlteration, type SchedulingFields, type SchedulingServiceChange } from "./scheduling-contract";
import type { SchedulingState } from "./secretary-scheduling";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { listSchedulingProfessionals, listSchedulingServices } from "./scheduling-catalog";
import { alteredServiceIds, locateSchedulingAppointments, schedulingAppointmentServices } from "./scheduling-mutations";
import { formatLocal } from "./secretary-datetime-format";
import { confirmQuestion, detailQuestion, nameSuggestionsEnabled, recordNameCheck, salonDirectoryNames, suggestionQuestion, suggestSchedulingProfessionals, suggestSchedulingServices } from "./entity-suggestions";
import { directorySubsetProof, nameInText, nameTokens, sameName, withoutArticle, withoutHonorific } from "./name-search";
import { entityQuoteDenied, temporalQuoteDenied } from "./scheduling-temporal-source";
import { serviceDirectoryProof, validateSchedulingEntityMentions, withoutCustomerMentions } from "./scheduling-entity-mentions";
import { sameAcceptedQuery } from "./secretary-entity-context";
import { optionId, optionName, writesOptionName, type PublishedOption } from "./secretary-options";
import { literalProofSpans } from "../../packages/salon-secretary/src/literal-match";
import { alterAppointmentEnabled } from "../../packages/salon-secretary/src/alter-appointment";
import { isFirstPersonReference } from "./secretary-first-person";
import { comboParts, coveringServices, joinedServices } from "./secretary-multi-service";
import { multiServiceEnabled } from "../../packages/salon-secretary/src/multi-service";

/** P2a (flag SALON_SECRETARY_ALTER_APPOINTMENT): alter an existing appointment's data on appointment.change — the NEW
 * professional (`target_professional_name`) and the service delta (`service_changes`), keeping the slot unless a new day/time
 * was said. Luna only interprets; this module proves the owner's words, resolves the names (homonyms are a card, never a
 * pick), refuses what cannot be done (a service the appointment does not have, no service left, a professional who does not
 * perform every service) and leaves availability, the proposal and execution to the existing change path
 * (scheduling-mutations: inspectSchedulingMove / schedulingActionSnapshot / requestStaffReschedule after Confirmar). */
export type AlterationField = "target_professional_name" | "service_changes";
export const alterationCards = ["target_professional_ref", "service_changes_ref"] as const;
export type AlterationCard = (typeof alterationCards)[number];
/** Draft keys of an alteration (what the adapter holds for it; never resurrected by the journal merge). */
export const alterationDraftKeys = ["target_professional_name", "target_professional_ref", "service_changes", "service_changes_ref"] as const;
export const isAlterationField = (field?: string) => !!field && (field === "target_professional_name" || field === "service_changes" || (alterationCards as readonly string[]).includes(field));
/** Words of the missing-field fallback question (never the presentation-digest map; only reached if a question was not set). */
export const alterationMissingLabels: Record<string, string> = { target_professional_ref: "novo profissional", service_changes_ref: "serviços da alteração" };
const list = (names: readonly string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;

type GroundState = { fields: SchedulingFields; candidates?: SchedulingState["candidates"]; selected_names?: SchedulingState["selected_names"]; resolved_names?: SchedulingState["resolved_names"] };
/** Interpretation step. A value whose every mention is denied in its own clause (or governed by the privative "sem") never
 * becomes an alteration ("não vai ser com a X", "não troca a barba", "sem barba"); a service name the message does not prove is
 * not kept. Either one is asked (`ask`) and the accepted value it would replace is dropped, so no part of the request is executed
 * as if it were the whole. A NEW professional's name the message does not contain (nor single out in the salon's directory) is a
 * model claim (`unproven`): only a click on its card confirms it. Re-echoes of the accepted values (the owner's words, or the
 * registered name resolved for them) keep them and what was resolved for them.
 * Review A: while a service card of the accepted delta is open, a delta that is not a restatement only answers that card
 * (`answer`: the option the owner's own words single out, or not answered: asked again, never a replacement that drops the rest of
 * the delta). With no card open, a new delta that drops an accepted change is ambiguous (restating or narrowing?): asked, nothing
 * kept (`notice`); a restatement of part of it that the message does not contain changes nothing. */
export async function groundAlteration(actor: ServiceActor, c: GroundState, operation: string,
  said: { target_professional_name?: string | null; service_changes?: readonly SchedulingServiceChange[] | null },
  source: string | undefined, names: string | undefined, customer: string | undefined, codes: string[]) {
  const out: { patch: Pick<SchedulingFields, "target_professional_name" | "service_changes">; ask?: AlterationField; unproven?: boolean; notice?: string;
    answer?: { pick?: string; unanswered?: true } } = { patch: {} };
  if (said.target_professional_name == null && said.service_changes == null) return out;
  if (!alterAppointmentEnabled() || operation !== "appointment.change") throw Error("CAPABILITY_FIELD_MISMATCH");
  // The privative "sem" denies only an affirmative part (who attends, a service to include or set); for a REMOVE it agrees.
  const denied = (name: string, affirmative = true) => {
    if (source === undefined) return false;
    const spans = literalProofSpans(source, name);
    return spans.length > 0 && spans.every(([start, end]) => (affirmative ? entityQuoteDenied : temporalQuoteDenied)(source, start, end, "appointment.change"));
  };
  const target = said.target_professional_name?.trim();
  // A re-echo of the accepted name, or of the option the owner chose for it, names no one new.
  const echoedTarget = !!target && (sameAcceptedQuery(target, c.fields.target_professional_name) || !!c.fields.target_professional_ref && sameAcceptedQuery(target, c.selected_names?.target_professional_name));
  // A denied mention is never kept, even as a re-echo of the accepted value ("não, não vai ser com a X").
  if (target && denied(target)) { codes.push("ALTER_TARGET_NEGATED"); out.ask = "target_professional_name"; }
  else if (target && !echoedTarget) {
    out.patch.target_professional_name = target;
    const text = names ?? source;
    if (text !== undefined) {
      const inMessage = nameInText(target, text);
      const echo = !inMessage && c.candidates?.kind === "target_professional_ref" && !c.candidates.source && c.candidates.items.some(item => sameName(item.name, target));
      const proof = !inMessage && !echo && directorySubsetProof(target, await withoutCustomerMentions(actor, source ?? text, customer), await withTenant(actor, tx => salonDirectoryNames(tx, actor, "professional")) ?? []);
      recordNameCheck({ role: "professional", in_message: inMessage, option_echo: echo, ...(proof ? { directory_proof: true as const } : {}) });
      out.unproven = !(inMessage || echo || proof);
    }
  }
  const changes = said.service_changes, accepted = c.fields.service_changes, acceptedRefs = c.fields.service_changes_ref ?? [];
  // A held change is restated by its mode and the owner's words, or the registered name resolved for them (review A).
  const restates = (change: SchedulingServiceChange, index: number) => !!accepted?.[index] && change.mode === accepted[index].mode &&
    (sameAcceptedQuery(change.service_name, accepted[index].service_name) || !!acceptedRefs[index] && sameAcceptedQuery(change.service_name, c.resolved_names?.[acceptedRefs[index]!]));
  const held = (change: SchedulingServiceChange) => !!accepted?.some((_, index) => restates(change, index));
  const echoed = !!changes && !!accepted && changes.length === accepted.length && changes.every(restates);
  if (changes?.some(change => denied(change.service_name, change.mode !== "REMOVE"))) { codes.push("ALTER_SERVICE_NEGATED"); out.ask ??= "service_changes"; }
  else if (changes?.length && !echoed) {
    // Same length and modes: a position-wise rewording (nothing accepted is dropped) when it keeps an accepted change in place (or
    // answers an open card of it); a delta that keeps none of them ("e pezinho" after "barba também": add or replace?) is asked.
    const shape = !!accepted && changes.length === accepted.length && changes.every((change, index) => change.mode === accepted[index].mode);
    const card = accepted && c.candidates?.kind === "service_changes_ref" ? c.candidates : undefined;
    const keepsAll = !accepted || shape && (!!card || changes.some(restates)) || accepted.every((_, index) => changes.some(change => restates(change, index)));
    const answer = card ? serviceCardAnswer(card, accepted!, acceptedRefs, changes, source, restates, shape) : undefined;
    const literal = (change: SchedulingServiceChange) => source !== undefined && literalProofSpans(source, change.service_name).length > 0;
    if (answer === "echo" || !card && !keepsAll && changes.every(held) && !changes.some(literal)) codes.push("ALTER_SERVICE_ECHO");
    else if (answer) { out.answer = answer; if ("unanswered" in answer) codes.push("ALTER_SERVICE_ANSWER_UNRESOLVED"); }
    else if (!keepsAll) {
      codes.push("ALTER_SERVICE_CONFLICT"); out.ask ??= "service_changes";
      out.notice = `O pedido tinha: ${list(accepted!.map(change => `${modeWord[change.mode]} ${change.service_name}`))}. Agora recebi só: ${list(changes.map(change => `${modeWord[change.mode]} ${change.service_name}`))}. Não apliquei nenhuma troca de serviço. Quais serviços devo trocar, acrescentar ou tirar?`;
    }
    else if (source !== undefined && !await servicesProven(actor, source, changes, customer)) { codes.push("ENTITY_MENTION_CONFLICT"); out.ask ??= "service_changes"; }
    else {
      out.patch.service_changes = [];
      for (const change of changes) {
        const own = await ownComboWords(actor, change, source, customer);
        if (own) codes.push("ALTER_COMBO_OWNER_WORDS");
        out.patch.service_changes.push({ mode: change.mode, service_name: own ?? change.service_name.trim() });
      }
    }
  }
  return out;
}
/** FX6 (review, owner rule 9, flag SALON_SECRETARY_MULTI_SERVICE): a combo's registered name Luna wrote for the owner's words (the
 * C7 directory proof: never a literal of the message) is read back as the owner's own words for each of its parts ("Combo
 * hidratação e escova" for "hidratação e escova"), so the catalog decides from what the owner said (resolveAlteration: the combo
 * and the services apart are asked). A part the owner's words do not hold (the owner named the combo itself: "o combo") keeps
 * the name as written. */
async function ownComboWords(actor: ServiceActor, change: SchedulingServiceChange, source: string | undefined, customer: string | undefined) {
  if (!multiServiceEnabled() || change.mode === "REMOVE" || source === undefined || literalProofSpans(source, change.service_name).length) return;
  const parts = comboParts(change.service_name);
  if (parts.length < 2) return;
  const words = new Set(nameTokens(await withoutCustomerMentions(actor, source, customer)));
  const own = parts.map(part => nameTokens(part).filter(token => words.has(token)).join(" "));
  return own.some(part => !part) ? undefined : list(own);
}
const modeWord: Record<SchedulingServiceChange["mode"], string> = { SET: "trocar para", INCLUDE: "acrescentar", REMOVE: "tirar" };
/** Review A: a delta received while a service card of the accepted delta is open. Items that restate an accepted change are
 * carried; the one item left must have the mode of the change the card resolves and name an option the owner's own words single
 * out (writesOptionName, the C3 rule: a click still decides otherwise) — a pick. A same-shape delta that only rewords the carded
 * change with a name no option has is the owner's correction of it (undefined: grounded as a new delta, nothing accepted is
 * dropped). Nothing new: an echo. Anything else is not an answer (asked again with the same card, the accepted delta kept). */
function serviceCardAnswer(card: NonNullable<SchedulingState["candidates"]>, accepted: readonly SchedulingServiceChange[], refs: readonly (string | null)[],
  changes: readonly SchedulingServiceChange[], source: string | undefined, restates: (change: SchedulingServiceChange, index: number) => boolean, shape: boolean):
  { pick: string } | { unanswered: true } | "echo" | undefined {
  const open = accepted.findIndex((_, index) => !refs[index]);
  const fresh = changes.filter(change => !accepted.some((_, index) => restates(change, index)));
  // Only restatements: of the carded change itself, an answer that does not single out an option (said so above the same card).
  if (!fresh.length) return open >= 0 && changes.some(change => restates(change, open)) ? { unanswered: true } : "echo";
  if (open < 0 || fresh.length !== 1 || fresh[0].mode !== accepted[open].mode) return { unanswered: true };
  const published: PublishedOption[] = card.items.map((item, index) => ({ option_id: optionId(index), label: item.name, ref: item.id, field: card.kind }));
  const naming = published.filter(option => sameName(option.label, fresh[0].service_name));
  const named = naming.filter(option => source !== undefined && writesOptionName(source, option, published));
  if (named.length === 1) return { pick: named[0].ref };
  if (!naming.length && shape && changes.every((change, index) => index === open || restates(change, index))) return;
  return { unanswered: true };
}
/** Each service name of the delta is a literal of the message outside the customer's name, or (C7 flag) the directory's
 * single service the owner's tokens single out. */
async function servicesProven(actor: ServiceActor, source: string, changes: readonly SchedulingServiceChange[], customer: string | undefined) {
  for (const change of changes) {
    try { await validateSchedulingEntityMentions(actor, source, { customer_name: customer, service_name: change.service_name }); }
    catch (error) {
      if (!(error instanceof Error && error.message === "ENTITY_MENTION_CONFLICT")) throw error;
      if (!nameSuggestionsEnabled() || !await serviceDirectoryProof(actor, source, change.service_name, customer)) return false;
    }
  }
  return true;
}
/** The question asked instead of an alteration part that was not applied (negated or unproven). */
export const alterationAskQuestion = (field: AlterationField) => field === "target_professional_name"
  ? "Não entendi com segurança para qual profissional passar o agendamento. Quem vai atender?"
  : "Não consegui confirmar na sua mensagem quais serviços mudam. Quais serviços devo trocar, acrescentar ou tirar?";

/** Every name word the owner said (no leading article or honorific) is a whole word of the registered name. */
const wholeWords = (said: string, registered: string) => {
  const named = withoutArticle(said), words = new Set(nameTokens(registered)), tokens = nameTokens(withoutHonorific(named) ?? named);
  return tokens.length > 0 && tokens.every(token => words.has(token));
};
type Resolution = { notice?: string; waiting_for?: AlterationField; candidates?: SchedulingState["candidates"]; codes: string[] };
/** Preparation step (after the appointment is located). Resolves the NEW professional and every service name (one card at a
 * time; a model's unproven name is a confirmation card), then checks the request against the appointment: the resulting list
 * (refused, never guessed: a service to remove it does not have, one to add it already has, none left, more than 10), a no-op,
 * and that the professional who will attend performs EVERY resulting service (otherwise who does is offered, never chosen).
 * Mutates `f` (refs; a refused or redundant part is dropped so it is never proposed). */
export async function resolveAlteration(actor: ServiceActor, c: SchedulingState, f: SchedulingFields): Promise<Resolution> {
  if (!alterAppointmentEnabled()) { for (const key of alterationDraftKeys) delete f[key]; return { codes: ["ALTER_APPOINTMENT_DISABLED"] }; }
  const card = (notice: string, candidates: NonNullable<SchedulingState["candidates"]>, waiting_for: AlterationField, code: string): Resolution => ({ notice, candidates, waiting_for, codes: [code] });
  const ask = (notice: string, waiting_for: AlterationField, code: string): Resolution => ({ notice, waiting_for, codes: [code] });
  const name = f.target_professional_name;
  if (name && !f.target_professional_ref) {
    const rows = await withTenant(actor, tx => listSchedulingProfessionals(tx, actor, { query: name }));
    // E2 (V2, review A): the owner's first person ("passa o Téo pra mim") is their own active registration here (the catalog never
    // searches a name for it): resolved as registered, then checked like any NEW professional; not registered: said, with the
    // team as options (never preselected).
    const self = isFirstPersonReference(name);
    if (self && rows.length !== 1) {
      const team = await withTenant(actor, tx => listSchedulingProfessionals(tx, actor, {}));
      return team.length && team.length <= 20 ? card("Não encontrei seu cadastro como profissional neste salão. Escolha uma opção real.", { kind: "target_professional_ref", items: team }, "target_professional_name", "SELF_NOT_PROFESSIONAL")
        : ask("Não encontrei seu cadastro como profissional neste salão. Quem vai atender?", "target_professional_name", "SELF_NOT_PROFESSIONAL");
    }
    // A pronoun the owner's message does not contain is a model claim too: confirmed by a click, as any unproven name.
    if (c.unproven_names?.includes("target_professional_name"))
      return rows.length && rows.length <= 20 ? card(confirmQuestion("profissional", rows.map(row => row.name)), { kind: "target_professional_ref", source: "confirm", items: rows }, "target_professional_name", "ALTER_TARGET_CONFIRM")
        : ask(rows.length ? "Muitas opções de profissional; informe um nome mais específico." : "Não encontrei esse profissional neste salão. Quem vai atender?", "target_professional_name", "ALTER_TARGET_NOT_FOUND");
    // Review A: who will attend is picked only when every word said is a whole word of that one name ("Bia" is not "Fabiana");
    // a match found only inside a word is confirmed by a click or by the owner writing the name (C3 card).
    if (!self && rows.length === 1 && !wholeWords(name, rows[0].name)) return card(confirmQuestion("profissional", rows.map(row => row.name)), { kind: "target_professional_ref", source: "confirm", items: rows }, "target_professional_name", "ALTER_TARGET_CONFIRM");
    if (rows.length === 1) { f.target_professional_ref = rows[0].id; c.resolved_names = { ...c.resolved_names, [rows[0].id]: rows[0].name }; }
    else if (!rows.length) {
      const found = nameSuggestionsEnabled() ? await withTenant(actor, tx => suggestSchedulingProfessionals(tx, actor, { query: name })) : undefined;
      if (found?.status === "SUGGEST") return card(suggestionQuestion(name, found.rows.map(row => row.name)), { kind: "target_professional_ref", source: "suggest", items: found.rows }, "target_professional_name", "ALTER_TARGET_SUGGEST");
      return ask(found && found.status !== "NONE" ? detailQuestion(name, "profissional") : "Não encontrei esse profissional neste salão. Quem vai atender?", "target_professional_name", "ALTER_TARGET_NOT_FOUND");
    }
    else if (rows.length > 20) return ask("Muitas opções de profissional; informe um nome mais específico.", "target_professional_name", "ALTER_TARGET_TOO_MANY");
    else return card("Para qual profissional devo passar? Selecione uma opção real.", { kind: "target_professional_ref", items: rows }, "target_professional_name", "ALTER_TARGET_AMBIGUOUS");
  }
  let comboCodes: string[] = [];
  if (f.service_changes) {
    const refs = f.service_changes.map((_, index) => f.service_changes_ref?.[index] ?? null);
    const combo = multiServiceEnabled() && f.appointment_ref ? await comboChanges(actor, f, refs) : undefined;
    if (combo && "ask" in combo) { delete f.service_changes; delete f.service_changes_ref; return ask(combo.ask, "service_changes", combo.code); }
    if (combo?.rules.some(Boolean)) comboCodes = ["ALTER_COMBO_PART"];
    for (const [index, change] of f.service_changes.entries()) {
      if (refs[index]) continue;
      const rule = combo?.rules[index];
      // C4 owner rule 9: ONE entry joining services a catalog combo joins ("troca pra hidratação e escova"): that combo alone is used;
      // with those services apart too (or several combos, or a part never said) the combos are a card: never picked by the words' form.
      const joined = !rule && change.mode !== "REMOVE" && multiServiceEnabled() ? await joinedServices(actor, change.service_name) : undefined;
      if (joined && !joined.apart && joined.combos.length === 1 && !joined.unsaid.length) {
        refs[index] = joined.combos[0].id; c.resolved_names = { ...c.resolved_names, [joined.combos[0].id]: joined.combos[0].name }; continue;
      }
      if (joined) {
        f.service_changes_ref = refs;
        const one = joined.combos.length === 1, named = list(joined.combos.map(row => `“${row.name}”`));
        return card(`No catálogo, ${named} já ${one ? "junta" : "juntam"} ${list(joined.parts)}${joined.apart ? ", e esses serviços também existem separados" : ""}${joined.unsaid.length ? `; ${named} inclui também ${list(joined.unsaid)}` : ""}. Selecione ${one ? "esse serviço" : "um deles"} ou diga quais serviços separados devo usar. Nada foi alterado.`,
          { kind: "service_changes_ref", items: joined.combos.map(row => ({ id: row.id, name: row.name })) }, "service_changes", "ALTER_COMBO_ASKED");
      }
      const found = await withTenant(actor, tx => listSchedulingServices(tx, actor, change.service_name));
      // C4 owner rule 9: a part of a combo is a service registered apart (never the combo itself, never another combo). FX6 (review,
      // safety): one whose name holds every word of the part as a whole word ("barba" → "Barba tradicional"); a row found only inside
      // another word ("pé" in "Depilação") is not that part: none left is explained and asked (rule.missing), never picked.
      const rows = rule ? found.filter(row => comboParts(row.name).length < 2 && wholeWords(change.service_name, row.name)) : found;
      if (rows.length === 1) { refs[index] = rows[0].id; c.resolved_names = { ...c.resolved_names, [rows[0].id]: rows[0].name }; continue; }
      f.service_changes_ref = refs;
      const said = change.service_name;
      if (!rows.length && rule) { delete f.service_changes; delete f.service_changes_ref; return ask(rule.missing, "service_changes", "ALTER_COMBO_PART_NOT_REGISTERED"); }
      if (!rows.length) {
        const found = nameSuggestionsEnabled() ? await withTenant(actor, tx => suggestSchedulingServices(tx, actor, said)) : undefined;
        if (found?.status === "SUGGEST") return card(suggestionQuestion(said, found.rows.map(row => row.name)), { kind: "service_changes_ref", source: "suggest", items: found.rows.map(row => ({ id: row.id, name: row.name })) }, "service_changes", "ALTER_SERVICE_SUGGEST");
        return ask(found && found.status !== "NONE" ? detailQuestion(said, "serviço") : `Não encontrei o serviço “${said}” neste salão. Qual serviço você quis dizer?`, "service_changes", "ALTER_SERVICE_NOT_FOUND");
      }
      if (rows.length > 20) return ask(`Muitas opções de serviço para “${said}”; informe um nome mais específico.`, "service_changes", "ALTER_SERVICE_TOO_MANY");
      return card(rule?.question ?? `Qual serviço você quis dizer com “${said}”? Selecione uma opção real.`, { kind: "service_changes_ref", items: rows.map(row => ({ id: row.id, name: row.name })) }, "service_changes", rule ? "ALTER_COMBO_PART_AMBIGUOUS" : "ALTER_SERVICE_AMBIGUOUS");
    }
    f.service_changes_ref = refs;
  }
  if (!f.appointment_ref) return { codes: [] };
  // Review A (E1 amendment): a change naming a locator professional and a different NEW one may carry the roles swapped. When the
  // swapped reading (same customer and origin, the NEW professional's appointments) also finds one, nothing is proposed: the owner
  // picks the appointment on a card of both readings (selectScheduling), and who attends is the other one named. An appointment the
  // owner already picked is theirs.
  if (f.target_professional_ref && f.professional_ref && f.target_professional_ref !== f.professional_ref && c.appointment_chosen !== f.appointment_ref) {
    const [stated, swapped] = await withTenant(actor, tx => Promise.all([locateSchedulingAppointments(tx, actor, f, "appointment.change"),
      locateSchedulingAppointments(tx, actor, { ...f, professional_ref: f.target_professional_ref }, "appointment.change")]));
    if (swapped.length) {
      const rows = [...stated, ...swapped.filter(row => !stated.some(other => other.appointment_ref === row.appointment_ref))];
      c.alter_swap = { professional: { ref: f.professional_ref, name: f.professional_name }, target: { ref: f.target_professional_ref, name: f.target_professional_name } };
      const named = [f.professional_ref, f.target_professional_ref].map(ref => c.resolved_names?.[ref] ?? rows.find(row => row.professional_ref === ref)?.professional_name ?? "o profissional");
      return { notice: `Encontrei agendamentos de ${rows[0].customer_name} com ${named[0]} e com ${named[1]}. Qual deles muda de profissional? Quem vai atender é o outro profissional citado. Selecione uma opção real.`,
        candidates: { kind: "appointment_ref", items: rows.map(row => ({ id: row.appointment_ref, name: `${row.customer_name} — ${formatLocal(row.start_local)} — ${row.professional_name}` })) }, codes: ["ALTER_ROLES_AMBIGUOUS"] };
    }
  }
  const current = await withTenant(actor, tx => schedulingAppointmentServices(tx, actor, f.appointment_ref!));
  const who = current.customer_name, before = current.services.map(service => service.id);
  const serviceName = (id: string) => current.services.find(service => service.id === id)?.name ?? c.resolved_names?.[id] ?? "o serviço";
  let ids = before;
  if (f.service_changes) {
    const plan = alteredServiceIds(before, f.service_changes.map((change, index) => ({ mode: change.mode, ref: f.service_changes_ref![index]! })));
    if ("error" in plan) {
      const named = plan.index !== undefined ? serviceName(f.service_changes_ref![plan.index]!) : "";
      const notice = plan.error === "SERVICE_NOT_IN_APPOINTMENT" ? `O agendamento de ${who} não inclui ${named}; tem ${list(current.services.map(service => service.name))}. Nada foi alterado.`
        : plan.error === "SERVICE_ALREADY_IN_APPOINTMENT" ? `O agendamento de ${who} já inclui ${named}. Nada foi alterado.`
        : plan.error === "SERVICE_CHANGE_EMPTY" ? `Não dá para deixar o agendamento de ${who} sem serviço (${list(current.services.map(service => service.name))}). Nada foi alterado; para desmarcar, peça o cancelamento.`
        : plan.error === "SERVICE_CHANGE_TOO_MANY" ? "Um agendamento pode ter no máximo 10 serviços. Nada foi alterado." : "Não entendi a troca de serviços. Nada foi alterado.";
      delete f.service_changes; delete f.service_changes_ref;
      return ask(`${notice} Quais serviços devo trocar, acrescentar ou tirar?`, "service_changes", `ALTER_${plan.error}`);
    }
    ids = plan.ids;
  }
  const servicesChanged = !(ids.length === before.length && ids.every((id, index) => id === before[index]));
  const destination = !!(f.date || f.time || f.period);
  if (f.service_changes && !servicesChanged) { delete f.service_changes; delete f.service_changes_ref; }
  // The NEW professional is the one already attending: nothing to change about who attends.
  if (f.target_professional_ref === current.professional_ref) { delete f.target_professional_name; delete f.target_professional_ref; }
  if (!servicesChanged && !f.target_professional_ref && !destination)
    return ask(`O agendamento de ${who} já é ${list(ids.map(serviceName))} com ${current.professional_name}. Nada foi alterado.`, name ? "target_professional_name" : "service_changes", "ALTER_NO_CHANGE");
  const professional = f.target_professional_ref ?? current.professional_ref;
  if (servicesChanged || professional !== current.professional_ref) {
    // The one who will attend must perform every service (the domain refuses it too: PRO_SERVICE_MISMATCH).
    const linked = await withTenant(actor, tx => listSchedulingProfessionals(tx, actor, { service_refs: ids }));
    if (!linked.some(row => row.id === professional)) {
      const attending = professional === current.professional_ref ? current.professional_name : c.resolved_names?.[professional] ?? "O profissional escolhido";
      const others = linked.filter(row => row.id !== current.professional_ref || servicesChanged);
      delete f.target_professional_name; delete f.target_professional_ref;
      const notice = `${attending} não faz ${list(ids.map(serviceName))}. ${others.length ? `Quem faz: ${others.map(row => row.name).join(", ")}. Quem vai atender?` : "Ninguém da equipe faz todos esses serviços. Nada foi alterado."}`;
      return others.length && others.length <= 20 ? card(notice, { kind: "target_professional_ref", items: others }, "target_professional_name", "PRO_SERVICE_MISMATCH")
        : ask(notice, others.length ? "target_professional_name" : "service_changes", "PRO_SERVICE_MISMATCH");
    }
  }
  return { codes: comboCodes };
}
/** C4 owner rule 9: the part of a combo's registered name (comboParts) the owner's words name by themselves: every word said is a
 * word of that one part and of no other, and the part's unsaid words name no service registered apart ("Combo" in "Combo
 * hidratação" is a label; "corte" in "Corte degradê" is a service the owner did not say). Undefined: the words name the whole
 * combo, cross parts or leave a service unsaid (the existing path, which asks). */
async function namedComboPart(actor: ServiceActor, said: string, combo: { id: string; name: string }) {
  const parts = comboParts(combo.name), words = nameTokens(withoutArticle(said));
  if (parts.length < 2 || !words.length) return;
  const touched = parts.filter(part => nameTokens(part).some(token => words.includes(token)));
  if (touched.length !== 1) return;
  const own = nameTokens(touched[0]);
  if (!words.every(token => own.includes(token))) return;
  for (const token of own.filter(token => !words.includes(token))) {
    if (token.length < 2) return;
    const rows = await withTenant(actor, tx => listSchedulingServices(tx, actor, token));
    if (rows.some(row => row.id !== combo.id && comboParts(row.name).length < 2)) return;
  }
  return { part: touched[0], rest: parts.filter(part => part !== touched[0]) };
}
type ComboRule = { question: string; missing: string };
/** C4 owner rule 9 (flag SALON_SECRETARY_MULTI_SERVICE): a change naming ONE part of ONE combo the located appointment holds.
 * SET ("só a barba"): the part kept is a service registered apart, never that combo again nor another combo. REMOVE ("tira o
 * degradê"), when the owner's words match that combo alone among the appointment's services: the combo leaves and each part left
 * joins as a service registered apart (an INCLUDE the backend derives from the catalog; the proposal shows before and after and
 * only Confirmar writes). Two or more parts left that another combo also joins are asked (the owner chooses), never picked.
 * Returns, per change index, how its candidates are asked (several: a card; none: explained and asked; never a pick). */
async function comboChanges(actor: ServiceActor, f: SchedulingFields, refs: (string | null)[]): Promise<{ rules: (ComboRule | undefined)[] } | { ask: string; code: string } | undefined> {
  const current = await withTenant(actor, tx => schedulingAppointmentServices(tx, actor, f.appointment_ref!));
  const combos = current.services.filter(service => comboParts(service.name).length > 1), changes = [...f.service_changes!];
  if (!combos.length) return;
  const rules: (ComboRule | undefined)[] = [], quoted = (name: string) => `“${name}”`, more = "Quais serviços devo trocar, acrescentar ou tirar?";
  for (const [index, change] of [...changes.entries()]) {
    if (change.mode === "INCLUDE" || refs[index] && !combos.some(combo => combo.id === refs[index])) continue;
    const named = (await Promise.all(combos.map(async combo => ({ combo, found: await namedComboPart(actor, change.service_name, combo) })))).filter(item => item.found);
    if (named.length !== 1) continue;
    const { combo } = named[0], { part, rest } = named[0].found!, parts = comboParts(combo.name);
    if (change.mode === "SET") {
      if (!refs[index]) rules[index] = { question: `Qual serviço você quis dizer com “${change.service_name}”? Selecione uma opção real.`,
        missing: `${quoted(combo.name)} junta ${list(parts)}; ${part} não está cadastrado como serviço separado neste salão. Nada foi alterado. ${more}` };
      continue;
    }
    if (!refs[index]) {
      if (current.services.filter(service => wholeWords(change.service_name, service.name)).length !== 1) continue;
      if (rest.length > 1) {
        const rows = await Promise.all(rest.map(name => withTenant(actor, tx => listSchedulingServices(tx, actor, name))));
        const others = coveringServices(rest, rows, new Set([combo.id])).filter(entry => rest.every((_, at) => entry.items.includes(at)));
        if (others.length) return { ask: `Tirando ${part} de ${quoted(combo.name)}, ficam ${list(rest)}, e o catálogo também tem ${list(others.map(entry => quoted(entry.row.name)))}. Nada foi alterado. Quais serviços devo deixar no agendamento?`, code: "ALTER_COMBO_PARTS_ASKED" };
      }
      if (changes.length + rest.length > 10 || rest.some(left => left.trim().length < 2 || left.trim().length > 200)) continue;
      refs[index] = combo.id;
    }
    for (const left of rest) {
      let at = changes.findIndex(other => other.mode === "INCLUDE" && sameName(other.service_name, left));
      if (at < 0) { changes.push({ mode: "INCLUDE", service_name: left }); refs.push(null); at = changes.length - 1; }
      if (!refs[at]) rules[at] = { question: `Tirando ${part} de ${quoted(combo.name)}, fica ${left}. Qual serviço? Selecione uma opção real.`,
        missing: `Tirando ${part} de ${quoted(combo.name)}, fica ${left}, que não está cadastrado como serviço separado neste salão. Nada foi alterado. ${more}` };
    }
  }
  if (changes.length !== f.service_changes!.length) f.service_changes = changes;
  return { rules };
}
/** A click (or a verified pick) on an alteration card: only an option the card published, still an active entity of this
 * salon; prepare checks eligibility and availability again. A service pick resolves the first unresolved change. */
export async function selectAlteration(actor: ServiceActor, selection: NonNullable<SchedulingState["candidates"]>, next: SchedulingState, ref: string) {
  const chosen = selection.items.find(item => item.id === ref)!;
  if (selection.kind === "target_professional_ref") {
    const row = await withTenant(actor, tx => tx.professional.findFirst({ where: { id: ref, salonId: actor.salonId, active: true }, select: { user: { select: { name: true } } } }));
    if (!row) throw Error("SELECTION_INVALID");
    next.fields.target_professional_ref = ref;
    next.resolved_names = { ...next.resolved_names, [ref]: row.user.name };
    next.selected_names = { ...next.selected_names, target_professional_name: optionName(chosen.name) };
    // The owner's click is the evidence the model's name lacked.
    if (next.unproven_names) { const left = next.unproven_names.filter(item => item !== "target_professional_name"); next.unproven_names = left.length ? left : undefined; }
    return;
  }
  const changes = next.fields.service_changes, index = changes?.findIndex((_, position) => !next.fields.service_changes_ref?.[position]) ?? -1;
  if (!changes || index < 0) throw Error("SELECTION_INVALID");
  const row = await withTenant(actor, tx => tx.service.findFirst({ where: { id: ref, salonId: actor.salonId, active: true }, select: { name: true } }));
  if (!row) throw Error("SELECTION_INVALID");
  const refs = changes.map((_, position) => next.fields.service_changes_ref?.[position] ?? null); refs[index] = ref;
  next.fields.service_changes_ref = refs;
  next.resolved_names = { ...next.resolved_names, [ref]: row.name };
}
/** Whether a change alters who attends or the services (flag on). */
export const alteringChange = (operation: string | undefined, f: SchedulingFields) => operation === "appointment.change" && alterAppointmentEnabled() && schedulingAlteration(f);
