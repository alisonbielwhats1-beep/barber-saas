import type { PresentationHints } from "@everflair/salon-secretary";
import { foldName, nameTokens, sameName } from "./name-search";
import { quoteTemporalFacts } from "./scheduling-temporal-source";
import { sameAcceptedQuery } from "./secretary-entity-context";
import { formatClock, formatLocal } from "./secretary-datetime-format";
import { daypartRulesV2Enabled } from "./scheduling-temporal-reference";
import type { SchedulingState } from "./secretary-scheduling";

/** B4 option choice by identifier. Pure helpers (no tenant access): ids are positional aliases over a
 * list the backend itself published ("opt_1" = first option shown), never entity ids. */
export type SecretaryOption = { option_id: string; label: string };
/** One option of an action's open card with its backend ref (the ref never reaches Luna or the screen). */
export type PublishedOption = SecretaryOption & { ref: string; field: string };
export const optionId = (index: number) => `opt_${index + 1}`;
export function optionIndex(id: string) {
  const match = /^opt_([1-9]\d?)$/.exec(id);
  return match ? Number(match[1]) - 1 : -1;
}
/** Person/item name of a candidate label ("Amanda Souza · (11) *****-0001" → "Amanda Souza"). */
export const optionName = (label: string) => label.split(" · ")[0].trim();

/** Options of every open card, in the order its question lists them (the hint's labels and refs). */
export function hintOptions(hints: PresentationHints): Record<string, PublishedOption[]> {
  const out: Record<string, PublishedOption[]> = {};
  for (const [key, hint] of Object.entries(hints)) {
    const pick = hint.selection;
    if (!pick?.labels.length || pick.refs?.length !== pick.labels.length) continue;
    out[key] = pick.labels.map((label, index) => ({ option_id: optionId(index), label, ref: pick.refs![index], field: pick.field }));
  }
  return out;
}

/** Time-slot alternatives the backend offered for an action's pending destination time (an unavailable
 * slot or an overlap/hard-block review): positional options over that same-day list. A click applies the
 * clock through the deterministic short-answer route; it never confirms or overrides anything. */
export function slotOptions(c: SchedulingState | undefined): (SecretaryOption & { startLocal: string })[] {
  if (!c || c.proposal || c.receipt || c.candidates) return [];
  // UX (flag SALON_SECRETARY_DAYPART_RULES_V2): an open half-day question of the action's own time offers, from the first ask,
  // exactly the backend's open readings (after the interval and tenant-facts filters; a reading ruled out is never pending).
  // Screen only (Luna never gets them as options); a click is the deterministic short answer {time}, never a confirmation. The
  // day part of `startLocal` is only a carrier when the day is still open (the click applies the clock alone).
  const daypart = daypartRulesV2Enabled() && c.waiting_for === "time" && ["appointment.create", "appointment.change", "appointment.cancel", "schedule.block"].includes(c.operation ?? "")
    ? (c.pending_temporal_ambiguities ?? c.draft?.pending_temporal_ambiguities)?.find(item => item.field === "time") : undefined;
  if (daypart) return daypart.candidates.map((clock, index) => ({ option_id: optionId(index), label: c.fields.date ? formatLocal(`${c.fields.date}T${clock}`) : formatClock(clock),
    startLocal: `${c.fields.date ?? "0000-00-00"}T${clock}` }));
  if (!["appointment.create", "appointment.change"].includes(c.operation ?? "")) return [];
  const review = c.draft?.review, day = c.fields.date;
  const offered = review && review.status !== "AVAILABLE" ? review.alternatives : c.waiting_for === "time" ? c.alternatives ?? [] : [];
  return offered.filter(slot => !!day && slot.startLocal.slice(0, 10) === day).slice(0, 20)
    .map((slot, index) => ({ option_id: optionId(index), label: formatLocal(slot.startLocal), startLocal: slot.startLocal }));
}

const scheduling = (operation: string) => operation.startsWith("appointment.") || operation === "availability.get" || operation === "schedule.block";
/** Temporal roles that locate the appointment an appointment option already is (its coordinates). */
export const appointmentEchoRoles = (operation: string) => operation === "appointment.change"
  ? { day: "source_date", clock: "source_time", keys: ["source_date", "source_day_offset", "source_weekday", "source_time"] } as const
  : { day: "date", clock: "time", keys: ["date", "day_offset", "weekday", "time", "period"] } as const;
/** Delta paths that only restate the chosen option (its name, or for an appointment its person,
 * professional, day and clock). They are compared with the option, never applied as new values. */
export function choiceEchoPaths(field: string, operation: string): string[] {
  if (!scheduling(operation)) return operation === "customer.message" ? ["communication.recipient_name"] : field === "product_name" ? ["inventory.product_name"] : ["target_name"];
  if (field === "customer_ref") return ["customer_name"];
  if (field === "service_ref") return ["service_name"];
  if (field === "professional_ref") return ["professional_name"];
  // P2a: the NEW professional's card is restated by its own name (never the locator professional_name).
  if (field === "target_professional_ref") return ["target_professional_name"];
  // Review A: a service card of a delta or of a list is restated by the field its question advertises (clarification
  // response_fields) or by a single name: compared with the option, never applied as a new delta or list after the pick.
  if (field === "service_changes_ref") return ["service_changes"];
  if (field === "service_list_ref" || field === "service_combo_ref") return ["service_name", "service_names"];
  return field === "appointment_ref" ? ["customer_name", "service_name", "professional_name", ...appointmentEchoRoles(operation).keys] : [];
}
const read = (value: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((node, key) => node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined, value);
/** Splits a choice delta into its echo (non-null values at echo paths) and the rest that still
 * applies after the selection. Temporal evidence of the option's own roles moves with the echo. */
export function splitChoiceDelta<T extends Record<string, unknown>>(delta: T, option: PublishedOption, operation: string) {
  const paths = choiceEchoPaths(option.field, operation), echo: Record<string, unknown> = {}, rest: Record<string, unknown> = structuredClone(delta);
  for (const path of paths) {
    const value = read(delta, path);
    if (value == null) continue;
    echo[path] = value;
    const [head, tail] = path.split(".");
    if (tail) (rest[head] as Record<string, unknown>)[tail] = null; else rest[head] = null;
  }
  const roles = option.field === "appointment_ref" && scheduling(operation) ? [appointmentEchoRoles(operation).day, appointmentEchoRoles(operation).clock] as string[] : [];
  const evidence = Array.isArray(delta.temporal_evidence) ? delta.temporal_evidence as { field: string; text: string }[] : [];
  const echoEvidence = evidence.filter(entry => roles.includes(entry.field));
  if (echoEvidence.length) rest.temporal_evidence = evidence.filter(entry => !roles.includes(entry.field));
  return { echo, echoEvidence, rest: rest as T };
}
/** A name echo agrees when it restates the accepted query or names the chosen option itself. */
export function nameEchoAgrees(path: string, value: unknown, option: PublishedOption, current: Record<string, unknown>) {
  if (path === "service_changes" || path === "service_names" || path === "service_name" && Array.isArray(current.service_names)) return listEchoAgrees(path, value, option, current);
  if (typeof value !== "string") return false;
  const parts = option.label.split(" — ");
  const expected = option.field !== "appointment_ref" ? optionName(option.label) : path === "customer_name" ? parts[0] : path === "professional_name" && parts.length > 2 ? parts.at(-1) : undefined;
  const accepted = read(current, path);
  return sameAcceptedQuery(value, typeof accepted === "string" ? accepted : undefined) || (!!expected && sameName(value, expected));
}
/** Review A: the echo of a service card of a delta (P2a `service_changes`) or of a list (P2b `service_names`, or one
 * `service_name` while the action holds a list). Every item must restate what the action already holds (the owner's words for
 * it; for a delta, with the same mode) or name the chosen option itself (for a delta, with the mode of the change the card is
 * resolving). Anything else disagrees: the card is asked again, nothing is picked and nothing replaces the delta or the list. */
function listEchoAgrees(path: string, value: unknown, option: PublishedOption, current: Record<string, unknown>) {
  const chosen = optionName(option.label);
  if (path === "service_changes") {
    const accepted = Array.isArray(current.service_changes) ? current.service_changes as { mode: string; service_name: string }[] : [];
    const refs = Array.isArray(current.service_changes_ref) ? current.service_changes_ref as (string | null)[] : [];
    const open = accepted.findIndex((_, index) => !refs[index]);
    if (!Array.isArray(value) || !value.length || open < 0) return false;
    return value.every(item => {
      const change = (item ?? {}) as { mode?: unknown; service_name?: unknown };
      if (typeof change.service_name !== "string") return false;
      const said = change.service_name;
      return accepted.some(known => known.mode === change.mode && sameAcceptedQuery(said, known.service_name)) || change.mode === accepted[open].mode && sameName(said, chosen);
    });
  }
  const accepted = Array.isArray(current.service_names) ? current.service_names as string[] : [];
  const items: unknown[] = path === "service_name" ? [value] : Array.isArray(value) ? value : [];
  return items.length > 0 && items.every(item => typeof item === "string" && (accepted.some(known => sameAcceptedQuery(item, known)) || sameName(item, chosen)));
}
/** C7: whether a reply only restates options of an open card: every value it carries is the card role's name of a
 * published option (a customer, service or professional card: the option's name; an appointment card: its person or
 * professional), and it carries nothing else. Such a pick is not temporal evidence ("a segunda" = the second option). */
export function onlyRestatesOptions(field: string, labels: readonly string[], values: object) {
  const roles = field === "customer_ref" ? ["customer_name"] : field === "service_ref" ? ["service_name"] : field === "professional_ref" ? ["professional_name"]
    : field === "appointment_ref" ? ["customer_name", "professional_name"] : [];
  const names = (label: string, key: string) => { if (field !== "appointment_ref") return [optionName(label)]; const parts = label.split(" — ");
    return key === "customer_name" ? [parts[0]] : parts.length > 2 ? [parts.at(-1)!] : []; };
  const said = Object.entries(values).filter(([, value]) => value !== undefined && value !== null);
  return said.length > 0 && said.every(([key, value]) => roles.includes(key) && typeof value === "string" && labels.some(label => names(label, key).some(name => sameName(name, value))));
}
/** C7 (review): whether the OWNER's words are only a pick of the open card, whatever Luna restated. With the chosen
 * option's name tokens masked, the reply holds no negator and no temporal atom except one lone ordinal that also reads
 * as a weekday ("a segunda" = the second option). A negation or a new date Luna left out ("a Amanda Souza, mas não
 * amanhã") keeps the full grounding, so the value the owner negated is never kept. */
export function replyOnlyPicks(message: string, chosen: readonly string[]) {
  let text = foldName(message);
  for (const token of new Set(chosen.flatMap(name => nameTokens(optionName(name)))))
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu"), match => " ".repeat(match.length));
  if (/(?<![\p{L}\p{N}])(?:nao|nunca|jamais|nem)(?![\p{L}\p{N}])/u.test(text)) return false;
  const facts = quoteTemporalFacts(text, "UTC", new Date());
  return !facts.invalid && !facts.dates.length && !facts.days.length && !facts.clocks.length && !facts.period &&
    facts.weekdays.length <= 1 && facts.weekdays.every(item => item.bare);
}
/** C3 parity: an option of a suggestion/confirmation card (a name the owner did not write) is taken only
 * when the owner's words name that option — a name token of it that no other option of the card shares.
 * "sim", "essa" or an ordinal alone never resolve such a card (a click still does). */
export function writesOptionName(literal: string, option: PublishedOption, card: readonly PublishedOption[]) {
  const own = new Set(nameTokens(optionName(option.label))), said = nameTokens(literal).filter(token => own.has(token));
  return said.length > 0 && !card.some(other => other.option_id !== option.option_id && said.every(token => nameTokens(optionName(other.label)).includes(token)));
}
/** Name tokens of an option: an appointment's person and professional (never its date), otherwise the name before the phone. */
function optionNameTokens(option: PublishedOption) {
  if (option.field !== "appointment_ref") return nameTokens(optionName(option.label));
  const parts = option.label.split(" — ");
  return [...nameTokens(parts[0]), ...(parts.length > 2 ? nameTokens(parts.at(-1)!) : [])];
}
const phoneGroups = (option: PublishedOption) => option.field === "appointment_ref" ? [] : (option.label.split(" · ")[1] ?? "").match(/\d+/g) ?? [];
const ordinalWords: Record<string, number> = { primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5,
  sexto: 6, sexta: 6, setimo: 7, setima: 7, oitavo: 8, oitava: 8, nono: 9, nona: 9, decimo: 10, decima: 10 };
/** Positions (1-based) a quote names: ordinal words, "2º"/"2ª", "opção 2"/"número 2" and, where no clock reading
 * exists (`bareNumber`), a quote that is only a number. `weekdayWord`: the ordinal was also a weekday name. */
function statedPositions(tokens: readonly string[], size: number, bareNumber: boolean) {
  const out: { position: number; weekdayWord: boolean }[] = [];
  tokens.forEach((token, index) => {
    if (ordinalWords[token]) out.push({ position: ordinalWords[token], weekdayWord: ["segunda", "quarta", "quinta", "sexta"].includes(token) });
    else if (token === "ultimo" || token === "ultima") out.push({ position: size, weekdayWord: false });
    else if (/^\d{1,2}[oaºª]$/.test(token)) out.push({ position: Number(token.slice(0, -1)), weekdayWord: false });
    else if (/^\d{1,2}$/.test(token) && ["opcao", "numero", "n", "nº", "no"].includes(tokens[index - 1] ?? "")) out.push({ position: Number(token), weekdayWord: false });
  });
  const content = tokens.filter(token => !["a", "o", "e", "opcao", "numero"].includes(token));
  if (!out.length && bareNumber && content.length === 1 && /^\d{1,2}$/.test(content[0])) out.push({ position: Number(content[0]), weekdayWord: false });
  return out;
}
/** An appointment option's local coordinates (from a fresh tenant read). */
export type OptionCoordinates = { day: string; clock: string } | undefined;
/** Temporal facts of the quote (scheduling-temporal-source quoteTemporalFacts). */
export type OptionQuoteFacts = { dates: string[]; days: number[]; weekdays: { weekday: number; bare: boolean }[]; clocks: string[];
  period?: "morning" | "afternoon" | "evening"; invalid: boolean };
const inPeriod = (clock: string, period: NonNullable<OptionQuoteFacts["period"]>) => {
  const minute = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  return period === "morning" ? minute < 720 : period === "afternoon" ? minute >= 720 && minute < 1080 : minute >= 1080;
};
/** B4, every card: the owner's own words (the choice literal) must single out the chosen option. Each thing the
 * quote states is a constraint over the card: its name tokens (every option that has them all), a phone ending,
 * a position, and on appointment cards each day, weekday, clock (or its half-day reading) and daypart it states.
 * A word that is both an ordinal and a weekday ("a segunda") is either reading. A constraint the chosen option
 * fails contradicts the choice (OPTION_ECHO_MISMATCH); constraints that leave another option too, or no
 * constraint at all ("sim", "essa", a name shared by every option), do not choose (OPTION_NAME_REQUIRED). A card
 * of one option needs no distinguishing words, only no contradiction. Pure: coordinates come from the caller. */
export function choiceVerdict(literal: string, option: PublishedOption, card: readonly PublishedOption[], coordinates?: readonly OptionCoordinates[],
  facts?: OptionQuoteFacts): "OK" | "OPTION_NAME_REQUIRED" | "OPTION_ECHO_MISMATCH" {
  const ids = card.map(item => item.option_id), tokens = nameTokens(literal), constraints: Set<string>[] = [];
  const where = (test: (index: number) => boolean) => new Set(ids.filter((_, index) => test(index)));
  const names = card.map(item => new Set(optionNameTokens(item))), said = [...new Set(tokens.filter(token => names.some(set => set.has(token))))];
  if (said.length) constraints.push(where(index => said.every(token => names[index].has(token))));
  const phones = card.map(phoneGroups);
  if (phones.some(groups => groups.length)) for (const run of literal.match(/\d{2,}/g) ?? []) constraints.push(where(index => phones[index].some(group => group.endsWith(run))));
  const temporal = coordinates && facts ? { coordinates, facts } : undefined;
  const positions = statedPositions(tokens, card.length, !temporal);
  const at = (position: number) => where(index => index === position - 1);
  if (temporal) {
    const { coordinates: coords, facts: stated } = temporal, day = (index: number) => coords[index]?.day, clock = (index: number) => coords[index]?.clock;
    const weekdayOf = (index: number) => { const value = day(index); return value ? new Date(`${value}T12:00:00Z`).getUTCDay() : -1; };
    if (stated.invalid) constraints.push(new Set());
    for (const date of stated.dates) constraints.push(where(index => day(index) === date));
    for (const dayOfMonth of stated.days) constraints.push(where(index => Number(day(index)?.slice(8, 10)) === dayOfMonth));
    for (const clockSaid of stated.clocks) {
      const hour = Number(clockSaid.slice(0, 2)), readings = [clockSaid, ...(!stated.period && hour >= 1 && hour <= 12 ? [`${String((hour + 12) % 24).padStart(2, "0")}${clockSaid.slice(2)}`] : [])];
      constraints.push(where(index => readings.includes(clock(index) ?? "")));
    }
    if (stated.period) constraints.push(where(index => !!clock(index) && inPeriod(clock(index)!, stated.period!)));
    for (const { weekday, bare } of stated.weekdays) {
      const onDay = where(index => weekdayOf(index) === weekday), ordinal = bare ? positions.find(item => item.weekdayWord && ordinalWords[["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"][weekday]] === item.position) : undefined;
      constraints.push(ordinal ? new Set([...onDay, ...at(ordinal.position)]) : onDay);
    }
    for (const item of positions) if (!item.weekdayWord) constraints.push(at(item.position));
  } else for (const item of positions) constraints.push(at(item.position));
  if (!constraints.length) return card.length === 1 ? "OK" : "OPTION_NAME_REQUIRED";
  if (constraints.some(set => !set.has(option.option_id))) return "OPTION_ECHO_MISMATCH";
  return ids.filter(id => constraints.every(set => set.has(id))).length === 1 ? "OK" : "OPTION_NAME_REQUIRED";
}
const meta = new Set(["item_key", "operation", "depends_on", "released_slot_of", "source_scope", "choice"]);
const content = (value: unknown): boolean => value != null && value !== "" && (Array.isArray(value) ? value.length > 0 : typeof value === "object" ? Object.values(value as object).some(content) : true);
/** Whether a delta still says anything after its echo was removed (a value, a quote or a request). */
export const deltaHasContent = (delta: Record<string, unknown>) => Object.entries(delta).some(([key, value]) => !meta.has(key) && content(value));
