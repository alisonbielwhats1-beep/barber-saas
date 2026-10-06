/** A* premise probe (docs/c5-spike/13-sonda-premissa-astar.md §5-§9; Adendo 12): the instrumentation. Reads the blind cases file (§5), calls the real
 * Luna 6 through the guarded paid path with the VARIANT request (pilot-astar-prompt.ts), decodes it (one format repair at most), proves on arrival
 * whether the evidence and the cited mention are in the case message (pilotMentionIn, the existing primitive), computes the readings and the decision
 * with the pure module (src/lib/secretary-pilot-anchor.ts) from the case facts, scores each case (§6; §9.1: an answer that is no offset is scored by what
 * the product does with it, through the E2-B resolver of that operator) and STOPS at the first safety code (§7, §9.2) with no further call. Before each
 * call the run's real spent plus the worst case of that call must fit the cap (US$ 0.04, the owner's run cap), else the run stops and the cases left
 * are reported. Verdicts (§9.3, §9.8): REPROVADA at a safety code; SEGURA only when the run ended or reached the cap with at least one offset scored
 * and no case failed for infrastructure (FAILED_INFRA; the product's safe failures, FAILED_SAFE, are only reported); INCONCLUSIVA otherwise. stdout: one JSON line of codes per case and a summary (ids, enums, booleans, decisions, latency, tokens, cost; never a message,
 * an evidence or a name); the texts and the raw outputs go only to <folder of the cases file>/runs/<timestamp>/, refused inside a checkout. The dry-run
 * makes no network call: it validates the file, compares the module's readings and decision under the IDEAL claim (built from the truth) with what each
 * case expects, runs the evidence self-test and gates each case's real request with the worst documented text (§9.4), codes only. Paid mode refuses
 * unless PILOT_ANCHOR_PROBE_APPROVED=true, both pre-registered shas (the cases file and the variant contract+prompt) match, the dry-run is clean and the
 * tree is clean (§9.5). The probe never touches the real flow, the E2-B, the C3, the C4 or the frozen Agent. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import OpenAI from "openai";
import { OpenAIProvider, type Model } from "@openai/agents";
import { agentRequestBody } from "../src/agent-loop";
import { secretaryGuardedFetch } from "../src/openai-cost-guard";
import { pilotCatalogNames, PILOT_REQUEST_CAP, type PilotRequestContext } from "../src/pilot-reschedule-prompt";
import type { PilotTempoDia, PilotTempoHora } from "../src/pilot-reschedule-contract";
import { astarParameters, astarTool, PILOT_ASTAR_MENTION_DESCRIPTIONS, type AstarClockShift, type AstarDayShift, type AstarInterpretation } from "../src/pilot-astar-contract";
import { astarRequest, runAstarInterpretation, PILOT_ASTAR_CONTRACT_SHA256, PILOT_ASTAR_MODEL, PILOT_ASTAR_PROMPT, PILOT_ASTAR_PROMPT_EXAMPLE_NAMES,
  PILOT_ASTAR_REPAIR_RULES } from "../src/pilot-astar-prompt";
import { acquireProofLease, assertProgramHeadroom, guardPaidFetch, programSpendLabel, programSpendLedgerPath, programSpendTotals, releaseProofLease, responsesEstimator,
  runSpendCapReached, worstCaseMicroUsd, type ProofLease } from "./program-spend";
import { ANCHOR, ANCHOR_FIELD, ASK_REASON, BASIS, CITED_KIND, CLAIM_STATE, CONSISTENT, DROP, EVIDENCE, OUTCOME, PERIOD, QUALIFIER, UNIT, dayParts, decideAnchor, localDay,
  type AnchorClaim, type AnchorDecision, type AnchorInput, type CitedClockFact, type CitedDayFact, type EvidenceCode, type WorkingWindow } from "../../../src/lib/secretary-pilot-anchor";
import { pilotClockReadings, pilotClockShiftReadings, pilotFold, pilotMentionIn, pilotNowLocal, pilotWeekdayNumber, resolveClockDay, resolveTargetDate, resolveTargetTime,
  type PilotReader } from "../../../src/lib/secretary-pilot-resolver";
import { isValidTimeZone, toLocalDateTime } from "../../../src/lib/time";
import { lintFold, lintGrams, lintSources, lintTokens } from "../../../src/test/secretary-agent-lint";

/** The paid ceiling of a probe run: the owner's run cap (raised to US$ 0.04 after spec 13 was written; --cap-usd may only lower it). */
export const PROBE_CAP_USD = 0.04;
/** The approvals of a paid run: the owner switch and the two pre-registered shas. */
export const PROBE_ENV = Object.freeze({ approved: "PILOT_ANCHOR_PROBE_APPROVED", casesSha: "PILOT_ANCHOR_PROBE_CASES_SHA256", contractSha: "PILOT_ANCHOR_PROBE_CONTRACT_SHA256" });
/** Spec 13 §4.4 and §9.4: each case's real request keeps at least this much under the cost-guard cap. */
export const PROBE_PAYLOAD_REQUIRED = 2048;
/** §9.4: the worst documented text (spec 12 §11.8): 1000 accented characters, two UTF-8 bytes each. */
export const PROBE_WORST_TEXT = "ã".repeat(1000);
/** §9.4: the repair note of the gated shape: every rule of the variant and one schema code (the construction of the E2-B payload proof). */
const WORST_REPAIR = [...Object.keys(PILOT_ASTAR_REPAIR_RULES), "SCHEMA:invalid_type@tipo"];
/** §9.5: the files whose sha256 every summary records (paths from the checkout root). */
export const PROBE_TRACED_FILES = Object.freeze(["src/lib/secretary-pilot-anchor.ts", "packages/salon-secretary/evaluation/pilot-anchor-probe.ts", "src/lib/secretary-pilot-resolver.ts",
  "packages/salon-secretary/src/pilot-astar-contract.ts", "packages/salon-secretary/src/pilot-astar-prompt.ts"] as const);
const RESPONSES_URL = "https://api.openai.com/v1/responses";
/** Informative only (dry-run projection): the E2-B battery cost US$ 0.044017 for 39 calls (protocol, Resultado da E2-B). */
const HISTORICAL_CALL_MICRO_USD = Math.round(44_017 / 39);

// ---------------------------------------------------------------- the cases file (spec 13 §5)
type Pair = [string, string];
export type ProbeCase = {
  id: string; priority: number; twin: string | null; covers: string[]; receivedAt: string; timezone: string;
  salon: { name: string; hours: { default: Pair[]; byDate?: Record<string, Pair[]> }; team: { name: string; services: string[] }[]; catalog: string[] };
  appointment: { customer: string; date: string; time: string; durationMin: number; service: string; professional: string };
  message: string; target: "date" | "time"; destinationDay: string | null;
  truth: { offset: { days?: number; weeks?: number; minutes?: number }; startPointNamed: boolean; anchor: "ORIGIN" | "PRESENT" | "CITED" | "AMBIGUOUS"; evidenceSpans: string[];
    evidenceTypes: ("nomeia" | "deitico" | "desloca")[]; cited: { day: unknown; clock: unknown }; citedMentions: string[] };
  expected: { readings: { ORIGIN?: string[]; PRESENT?: string[]; CITED?: string[] }; decision: "USE" | "ASK"; value: string | null; options: string[] | null; rationale: string };
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const ID = /^[A-Z]{2}\d{2,3}$/, DATE_KEY = /^\d{4}-\d{2}-\d{2}$/, CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/, WINDOW_END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const ANCHOR_NAMES = ["ORIGIN", "PRESENT", "CITED", "AMBIGUOUS"] as const, TYPE_NAMES = ["nomeia", "deitico", "desloca"] as const;
const strings = (value: unknown, nonEmpty = true) => Array.isArray(value) && value.every(item => typeof item === "string" && (!nonEmpty || item.trim().length > 0));
const dayOfKey = (key: string): number | null => DATE_KEY.test(key) ? localDay(Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))) : null;
const keyOfDay = (day: number) => { const { year, month, day: date } = dayParts(day); return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`; };
const minuteOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const clockOfMinute = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const pairs = (value: unknown) => Array.isArray(value) && value.every(pair => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string" && typeof pair[1] === "string"
  && CLOCK.test(pair[0]) && WINDOW_END.test(pair[1]) && minuteOf(pair[0]) < minuteOf(pair[1]));
const integer = (value: unknown, low: number, high: number) => Number.isInteger(value) && (value as number) >= low && (value as number) <= high;
const WEEKDAYS_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const CITED_DAY_KEYS = new Set(["tipo", "kind", "dia", "day", "mes", "month", "dia_semana", "weekday", "qualificador", "qualifier", "meses", "months", "mencao", "mention"]);
const CITED_CLOCK_KEYS = new Set(["hora", "hour", "minuto", "minute", "periodo", "period", "mencao", "mention"]);
/** A cited day as typed values (the contract forms, or the same with English keys); null when absent; undefined when it is not a valid form. */
export function citedDayFact(raw: unknown): CitedDayFact | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw) || Object.keys(raw).some(key => !CITED_DAY_KEYS.has(key))) return undefined;
  const kind = raw.tipo ?? raw.kind, day = raw.dia ?? raw.day;
  if (kind === undefined || kind === "data" || kind === "dia") {
    const month = "mes" in raw ? raw.mes : "month" in raw ? raw.month : null;
    return integer(day, 1, 31) && (month === null || integer(month, 1, 12)) ? { kind: CITED_KIND.DAY_NUMBER, day: day as number, month: month as number | null } : undefined;
  }
  if (kind === "dia_semana" || kind === "weekday") {
    const name = raw.dia_semana ?? raw.weekday, qualifier = raw.qualificador ?? raw.qualifier ?? null;
    const weekday = pilotWeekdayNumber(name) ?? (typeof name === "string" && WEEKDAYS_EN.includes(name) ? WEEKDAYS_EN.indexOf(name) : undefined);
    const code = qualifier === null ? QUALIFIER.NONE : qualifier === "este" ? QUALIFIER.ESTE : qualifier === "proximo" ? QUALIFIER.PROXIMO : undefined;
    return weekday === undefined || code === undefined ? undefined : { kind: CITED_KIND.WEEKDAY, weekday, qualifier: code };
  }
  if (kind === "mes_relativo" || kind === "relative_month") {
    const months = raw.meses ?? raw.months;
    return integer(day, 1, 31) && integer(months, 0, 12) ? { kind: CITED_KIND.RELATIVE_MONTH, day: day as number, months: months as number } : undefined;
  }
  return undefined;
}
const PERIODS: Record<string, CitedClockFact["period"]> = { manha: PERIOD.MANHA, tarde: PERIOD.TARDE, noite: PERIOD.NOITE, morning: PERIOD.MANHA, afternoon: PERIOD.TARDE, night: PERIOD.NOITE };
/** A cited clock as typed values ({hora, minuto, periodo}, or the same with English keys); null when absent; undefined when invalid. */
export function citedClockFact(raw: unknown): CitedClockFact | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw) || Object.keys(raw).some(key => !CITED_CLOCK_KEYS.has(key))) return undefined;
  const hour = raw.hora ?? raw.hour, minute = raw.minuto ?? raw.minute ?? 0, period = raw.periodo ?? raw.period ?? null;
  const code = period === null ? PERIOD.NONE : typeof period === "string" && Object.prototype.hasOwnProperty.call(PERIODS, period) ? PERIODS[period] : undefined;
  return integer(hour, 0, 23) && integer(minute, 0, 59) && code !== undefined ? { hour: hour as number, minute: minute as number, period: code } : undefined;
}
/** The codes of one case (the path of each field that fails, never its value). */
function caseCodes(item: unknown): string[] {
  if (!isRecord(item)) return ["SCHEMA:case"];
  const codes: string[] = [], bad = (path: string) => codes.push(`SCHEMA:${path}`);
  if (typeof item.id !== "string" || !ID.test(item.id)) bad("id");
  if (!integer(item.priority, 1, 10_000)) bad("priority");
  if (item.twin !== null && (typeof item.twin !== "string" || !ID.test(item.twin))) bad("twin");
  if (!strings(item.covers)) bad("covers");
  if (typeof item.receivedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(item.receivedAt) || Number.isNaN(Date.parse(item.receivedAt))) bad("receivedAt");
  if (typeof item.timezone !== "string" || !isValidTimeZone(item.timezone)) bad("timezone");
  const salon = item.salon;
  if (!isRecord(salon)) bad("salon");
  else {
    if (typeof salon.name !== "string") bad("salon.name");
    if (!isRecord(salon.hours) || !pairs(salon.hours.default)) bad("salon.hours.default");
    else if (salon.hours.byDate !== undefined && (!isRecord(salon.hours.byDate) || Object.entries(salon.hours.byDate).some(([key, value]) => dayOfKey(key) === null || !pairs(value)))) bad("salon.hours.byDate");
    if (!Array.isArray(salon.team) || salon.team.some(member => !isRecord(member) || typeof member.name !== "string" || !member.name.trim() || !strings(member.services))) bad("salon.team");
    if (!strings(salon.catalog)) bad("salon.catalog");
  }
  const appointment = item.appointment;
  if (!isRecord(appointment)) bad("appointment");
  else {
    for (const key of ["customer", "service", "professional"]) if (typeof appointment[key] !== "string" || !(appointment[key] as string).trim()) bad(`appointment.${key}`);
    if (typeof appointment.date !== "string" || dayOfKey(appointment.date) === null) bad("appointment.date");
    if (typeof appointment.time !== "string" || !CLOCK.test(appointment.time)) bad("appointment.time");
    if (!integer(appointment.durationMin, 1, 1440)) bad("appointment.durationMin");
  }
  if (typeof item.message !== "string" || !item.message.trim() || [...item.message].length > 1000) bad("message");
  const target = item.target;
  if (target !== "date" && target !== "time") bad("target");
  if (target === "time" ? typeof item.destinationDay !== "string" || dayOfKey(item.destinationDay) === null : item.destinationDay !== null) bad("destinationDay");
  const value = (text: unknown) => typeof text === "string" && (target === "time" ? CLOCK.test(text) : dayOfKey(text) !== null);
  const truth = item.truth;
  if (!isRecord(truth)) bad("truth");
  else {
    const offset = truth.offset, keys = isRecord(offset) ? Object.keys(offset) : [];
    const offsetOk = isRecord(offset) && keys.length === 1 && (target === "time" ? integer(offset.minutes, -1440, 1440) : integer(offset.days, -366, 366) || integer(offset.weeks, -366, 366));
    if (!offsetOk) bad("truth.offset");
    if (typeof truth.startPointNamed !== "boolean") bad("truth.startPointNamed");
    if (!(ANCHOR_NAMES as readonly unknown[]).includes(truth.anchor)) bad("truth.anchor");
    if (!strings(truth.evidenceSpans) || (truth.startPointNamed === true && !(truth.evidenceSpans as unknown[]).length)) bad("truth.evidenceSpans");
    if (!Array.isArray(truth.evidenceTypes) || truth.evidenceTypes.some(type => !(TYPE_NAMES as readonly unknown[]).includes(type)) || (truth.startPointNamed === true && !truth.evidenceTypes.length))
      bad("truth.evidenceTypes");
    if (!isRecord(truth.cited)) bad("truth.cited");
    else {
      if (citedDayFact(truth.cited.day) === undefined) bad("truth.cited.day");
      if (citedClockFact(truth.cited.clock) === undefined) bad("truth.cited.clock");
    }
    if (!strings(truth.citedMentions)) bad("truth.citedMentions");
  }
  const expected = item.expected;
  if (!isRecord(expected)) bad("expected");
  else {
    const readings = expected.readings;
    if (!isRecord(readings) || Object.entries(readings).some(([key, list]) => !["ORIGIN", "PRESENT", "CITED"].includes(key) || !Array.isArray(list) || !list.every(value))) bad("expected.readings");
    if (expected.decision !== "USE" && expected.decision !== "ASK") bad("expected.decision");
    if (expected.decision === "USE" ? !value(expected.value) : expected.value !== null) bad("expected.value");
    if (expected.options !== null && (expected.decision !== "ASK" || !Array.isArray(expected.options) || !expected.options.every(value))) bad("expected.options");
    if (typeof expected.rationale !== "string") bad("expected.rationale");
  }
  return codes;
}
/** The cases of a file (an array, or { cases: [...] }), valid ones in priority order, and the codes of each invalid one (by id, or #index). */
export function validateProbeCases(raw: unknown): { cases: ProbeCase[]; errors: { id: string; codes: string[] }[] } {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.cases) ? raw.cases : null;
  if (!list) return { cases: [], errors: [{ id: "#file", codes: ["SCHEMA:file"] }] };
  const ids = new Set(list.flatMap(item => isRecord(item) && typeof item.id === "string" ? [item.id] : []));
  const seenIds = new Set<string>(), seenPriorities = new Set<number>(), errors: { id: string; codes: string[] }[] = [], cases: ProbeCase[] = [];
  list.forEach((item, index) => {
    const codes = caseCodes(item), record = isRecord(item) ? item : {};
    const id = typeof record.id === "string" && ID.test(record.id) ? record.id : `#${index}`;
    if (typeof record.id === "string") { if (seenIds.has(record.id)) codes.push("SCHEMA:id.duplicate"); seenIds.add(record.id); }
    if (Number.isInteger(record.priority)) { if (seenPriorities.has(record.priority as number)) codes.push("SCHEMA:priority.duplicate"); seenPriorities.add(record.priority as number); }
    if (typeof record.twin === "string" && !ids.has(record.twin)) codes.push("SCHEMA:twin.unknown");
    if (codes.length) errors.push({ id, codes }); else cases.push(item as ProbeCase);
  });
  return { cases: cases.sort((a, b) => a.priority - b.priority), errors };
}

// ---------------------------------------------------------------- facts, claims and the module input
const DAY_ANCHOR: Record<string, AnchorClaim["anchor"]> = { origem: ANCHOR.ORIGIN, hoje: ANCHOR.PRESENT, data_citada: ANCHOR.CITED };
const TIME_ANCHOR: Record<string, AnchorClaim["anchor"]> = { origem: ANCHOR.ORIGIN, agora: ANCHOR.PRESENT, hora_citada: ANCHOR.CITED };
const EVIDENCE_OF: Record<string, EvidenceCode> = { nomeia: EVIDENCE.NOMEIA, deitico: EVIDENCE.DEITICO, desloca: EVIDENCE.DESLOCA, outro: EVIDENCE.OUTRO };
const TRUTH_ANCHOR: Record<string, AnchorClaim["anchor"]> = { ORIGIN: ANCHOR.ORIGIN, PRESENT: ANCHOR.PRESENT, CITED: ANCHOR.CITED };
/** The name of a numeric code of the module (its own key), for the codes-only output. */
const nameOf = (table: Readonly<Record<string, number>>, code: number | null | undefined) => code === null || code === undefined ? null : Object.keys(table).find(key => table[key] === code) ?? "UNKNOWN";
/** The local instant of received_at in the case timezone, the appointment, the destination day and its working windows (integers only). */
export function probeFacts(c: ProbeCase) {
  const local = toLocalDateTime(new Date(c.receivedAt), c.timezone);
  const now = { day: dayOfKey(local.slice(0, 10)) as number, minute: minuteOf(local.slice(11, 16)) };
  const origin = { day: dayOfKey(c.appointment.date) as number, minute: minuteOf(c.appointment.time) };
  const destinationDay = c.destinationDay === null ? null : dayOfKey(c.destinationDay);
  const windows: WorkingWindow[] = c.destinationDay === null ? [] : (c.salon.hours.byDate?.[c.destinationDay] ?? c.salon.hours.default).map(([start, end]) => ({ start: minuteOf(start), end: minuteOf(end) }));
  return { now, origin, destinationDay, windows, today: local.slice(0, 10) };
}
/** The request context of a case: the local date and weekday of received_at, the timezone, the team and the catalog (no customer, no open plan). */
export function probeRequestContext(c: ProbeCase): PilotRequestContext {
  const today = probeFacts(c).today;
  return { today: { date: today, weekday: new Date(`${today}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" }), timezone: c.timezone },
    team: [...new Set(c.salon.team.map(member => member.name).filter(Boolean))], services: pilotCatalogNames(c.salon.catalog).names };
}
type LunaAnchor = { evidencia: string; tipo_evidencia: string; tipo: string };
/** What Luna claimed, typed, with the one fact the code proves about the evidence: whether it is in the message (pilotMentionIn). */
export function probeClaim(message: string, ancora: LunaAnchor | null, target: "date" | "time"): { claim: AnchorClaim | null; evidence: string | null; empty: boolean } {
  if (!ancora) return { claim: null, evidence: null, empty: false };
  const anchor = (target === "date" ? DAY_ANCHOR : TIME_ANCHOR)[ancora.tipo], evidenceType = EVIDENCE_OF[ancora.tipo_evidencia];
  return { claim: { anchor, evidenceType, contained: pilotMentionIn(message, ancora.evidencia) }, evidence: ancora.evidencia, empty: ancora.evidencia.trim().length === 0 };
}
type LunaRead = { offset: false } | { offset: true; input: AnchorInput; claim: ReturnType<typeof probeClaim>; cited: { fact: CitedDayFact | CitedClockFact; mention: string; contained: boolean } | null;
  operation: number };
/** The module input from Luna's destination offset of the case's field (or no offset there). */
export function lunaRead(c: ProbeCase, interpretation: AstarInterpretation): LunaRead {
  const facts = probeFacts(c), shift = c.target === "date" ? interpretation.destino.dia : interpretation.destino.hora;
  if (!shift || shift.tipo !== "deslocamento") return { offset: false };
  if (c.target === "date") {
    const day = shift as AstarDayShift, fact = day.data_citada ? citedDayFact(day.data_citada) ?? null : null;
    const cited = day.data_citada && fact ? { fact, mention: day.data_citada.mencao, contained: pilotMentionIn(c.message, day.data_citada.mencao) } : null;
    const claim = probeClaim(c.message, day.ancora, "date");
    return { offset: true, claim, cited, operation: day.quantidade * (day.unidade === "semanas" ? 7 : 1),
      input: { field: ANCHOR_FIELD.DATE, quantity: day.quantidade, unit: day.unidade === "semanas" ? UNIT.WEEKS : UNIT.DAYS, claim: claim.claim, citedContained: !!cited?.contained,
        cited: (cited?.fact as CitedDayFact | undefined) ?? null, now: facts.now, origin: facts.origin } };
  }
  const clock = shift as AstarClockShift, fact = clock.hora_citada ? citedClockFact(clock.hora_citada) ?? null : null;
  const cited = clock.hora_citada && fact ? { fact, mention: clock.hora_citada.mencao, contained: pilotMentionIn(c.message, clock.hora_citada.mencao) } : null;
  const claim = probeClaim(c.message, clock.ancora, "time");
  return { offset: true, claim, cited, operation: clock.minutos,
    input: { field: ANCHOR_FIELD.TIME, minutes: clock.minutos, claim: claim.claim, citedContained: !!cited?.contained, cited: (cited?.fact as CitedClockFact | undefined) ?? null,
      now: facts.now, origin: facts.origin, destinationDay: facts.destinationDay as number, windows: facts.windows } };
}
const truthCited = (c: ProbeCase) => c.target === "date" ? citedDayFact(c.truth.cited.day) ?? null : citedClockFact(c.truth.cited.clock) ?? null;
const truthOperation = (c: ProbeCase) => c.truth.offset.minutes ?? c.truth.offset.days ?? (c.truth.offset.weeks ?? 0) * 7;
/** The module input under the IDEAL claim, built from the truth (what a perfect Luna would hand over). */
export function idealInput(c: ProbeCase): AnchorInput {
  const facts = probeFacts(c), named = c.truth.startPointNamed && c.truth.anchor !== "AMBIGUOUS", anchor = TRUTH_ANCHOR[c.truth.anchor];
  const types = c.truth.evidenceTypes.map(type => EVIDENCE_OF[type]), type = types.find(code => CONSISTENT[code].includes(anchor)) ?? types[0] ?? EVIDENCE.OUTRO;
  const claim = named ? { anchor, evidenceType: type, contained: c.truth.evidenceSpans.some(span => pilotMentionIn(c.message, span)) } : null;
  const cited = truthCited(c), citedContained = !!cited && c.truth.citedMentions.some(mention => pilotMentionIn(c.message, mention));
  if (c.target === "date") {
    const weeks = c.truth.offset.weeks !== undefined;
    return { field: ANCHOR_FIELD.DATE, quantity: weeks ? c.truth.offset.weeks as number : c.truth.offset.days as number, unit: weeks ? UNIT.WEEKS : UNIT.DAYS, claim, citedContained,
      cited: cited as CitedDayFact | null, now: facts.now, origin: facts.origin };
  }
  return { field: ANCHOR_FIELD.TIME, minutes: c.truth.offset.minutes as number, claim, citedContained, cited: cited as CitedClockFact | null, now: facts.now, origin: facts.origin,
    destinationDay: facts.destinationDay as number, windows: facts.windows };
}
const LUNA_ANCHOR = { date: { ORIGIN: "origem", PRESENT: "hoje", CITED: "data_citada" }, time: { ORIGIN: "origem", PRESENT: "agora", CITED: "hora_citada" } } as const;
const WEEKDAY_NAMES = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] as const;
const PERIOD_NAMES: Record<number, "manha" | "tarde" | "noite" | null> = { [PERIOD.NONE]: null, [PERIOD.MANHA]: "manha", [PERIOD.TARDE]: "tarde", [PERIOD.NOITE]: "noite" };
/** The answer a perfect Luna would give for the case's destination field (the truth's operation, anchor, type and cited reference), copying `evidence`
 * as its evidence: the dry-run self-test feeds each truth span back through the real scorer. */
export function idealInterpretation(c: ProbeCase, evidence: string): AstarInterpretation {
  const anchor = c.truth.anchor === "AMBIGUOUS" ? "ORIGIN" : c.truth.anchor, code = TRUTH_ANCHOR[anchor];
  const type = c.truth.evidenceTypes.find(name => CONSISTENT[EVIDENCE_OF[name]].includes(code)) ?? c.truth.evidenceTypes[0] ?? "outro";
  const ancora = { evidencia: evidence, tipo_evidencia: type, tipo: LUNA_ANCHOR[c.target][anchor] }, mention = c.truth.citedMentions[0] ?? evidence, cited = truthCited(c);
  let dia: unknown = null, hora: unknown = null;
  if (c.target === "date") {
    const fact = cited as CitedDayFact | null, weeks = c.truth.offset.weeks !== undefined;
    const data_citada = !fact ? null : fact.kind === CITED_KIND.DAY_NUMBER ? { dia: fact.day, mes: fact.month, mencao: mention }
      : fact.kind === CITED_KIND.WEEKDAY ? { tipo: "dia_semana", dia_semana: WEEKDAY_NAMES[fact.weekday],
        qualificador: fact.qualifier === QUALIFIER.ESTE ? "este" : fact.qualifier === QUALIFIER.PROXIMO ? "proximo" : null, mencao: mention }
        : { tipo: "mes_relativo", dia: fact.day, meses: fact.months, mencao: mention };
    dia = { tipo: "deslocamento", quantidade: weeks ? c.truth.offset.weeks : c.truth.offset.days, unidade: weeks ? "semanas" : "dias", data_citada, ancora, mencao: evidence };
  } else {
    const fact = cited as CitedClockFact | null;
    hora = { tipo: "deslocamento", minutos: c.truth.offset.minutes, hora_citada: fact ? { hora: fact.hour, minuto: fact.minute, periodo: PERIOD_NAMES[fact.period], mencao: mention } : null,
      ancora, mencao: evidence };
  }
  return { tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null, cliente: { mencao: null },
    origem: { dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null }, destino: { dia, hora, profissional: { modo: null, mencao: null, excluidos: [] } },
    observacoes: [], fora_do_escopo: [] } as unknown as AstarInterpretation;
}
const shown = (c: ProbeCase, value: number) => c.target === "date" ? keyOfDay(value) : clockOfMinute(value);
const sameList = (a: readonly string[], b: readonly string[]) => { const x = [...new Set(a)].sort(), y = [...new Set(b)].sort(); return x.length === y.length && x.every((item, index) => item === y[index]); };
/** The decision as codes and readable values (date keys or clocks of the destination day; never a text of the case). */
function decisionView(c: ProbeCase, decision: AnchorDecision) {
  return decision.outcome === OUTCOME.USE
    ? { outcome: "USE" as const, value: shown(c, decision.value), basis: nameOf(BASIS, decision.basis), reason: null, options: null, claim: nameOf(CLAIM_STATE, decision.claim) }
    : { outcome: "ASK" as const, value: null, basis: null, reason: nameOf(ASK_REASON, decision.reason), options: decision.options.map(value => shown(c, value)),
      drops: decision.drops.map(drop => nameOf(DROP, drop)), claim: nameOf(CLAIM_STATE, decision.claim) };
}
/** The feasible readings of each factual anchor, readable. */
function readingsView(c: ProbeCase, decision: AnchorDecision) {
  const out: Record<string, string[]> = { ORIGIN: [], PRESENT: [], CITED: [] };
  for (const list of decision.readings) out[nameOf(ANCHOR, list.anchor) as string] = [...new Set(list.readings.filter(reading => reading.drop === null).map(reading => shown(c, reading.value as number)))].sort();
  return out;
}

// ---------------------------------------------------------------- scoring (spec 13 §6, §7 and §9)
export const SAFETY_CODES = ["S1_WRONG_ANCHOR_ACCEPTED", "S2_NONEXISTENT_EVIDENCE_ACCEPTED", "S3_SILENT_AMBIGUITY", "S4_WRONG_VALUE_WITHOUT_ASK"] as const;
/** A decision as the output shows it: the module's (an offset) or the product's (§9.1, an answer that is no offset; `operator` names its tipo). */
type DecisionShown = { outcome: "USE" | "ASK"; value: string | null; basis: string | null; reason: string | null; options: string[] | null; drops?: (string | null)[]; claim: string | null;
  operator?: string };
export type ProbeScore = { status: "SCORED" | "NOT_OFFSET" | "NO_ANSWER"; claim: { state: string | null; anchor: string | null; type: string | null; contained: boolean; empty: boolean };
  cited: { given: boolean; contained: boolean; typedEqual: boolean | null }; decision: DecisionShown | { outcome: "NONE" }; readings: Record<string, string[]> | null;
  metrics: { EVIDENCE_OK: boolean; TYPE_OK: boolean; ANCHOR_OK: boolean; CITED_OK: boolean; DECISION_OK: boolean }; optionsOk: boolean | null; operationOk: boolean | null;
  safety: string[]; warnings: string[]; falseAsk: boolean; ambiguityAsked: boolean | null; nullOrOutro: boolean;
  detail: { evidence: string | null; citedMention: string | null; input: AnchorInput | null; decision: AnchorDecision | null } };
/** Spec 13 §6 as amended before any run (f10f0f8, bdd3e6b): the evidence is in the message and, normalized as pilotMentionIn normalizes (pilotFold: no
 * accents, lower case, runs of non-letters one space, whole words; both sides alike), CONTAINS a whole truth span, each span being the minimal naming
 * core (one way only: a fragment of the core, a direction word or a name inside a larger span is never enough). */
const evidenceMatches = (c: ProbeCase, evidence: string) => pilotMentionIn(c.message, evidence)
  && c.truth.evidenceSpans.some(span => pilotFold(evidence).includes(pilotFold(span)));
/** §9.2: what decides S3, S4 and W3, from the case data and the ideal decision (never from Luna). A real ambiguity is an AMBIGUOUS truth whose expected
 * readings diverge and whose expected decision is a question; `ownValue` is the true anchor's own reading when the expected question comes only from a
 * competing cited reference (the ideal decision is LITERAL_COMPETES). */
function expectation(c: ProbeCase) {
  const readings = c.expected.readings, divergent = new Set([...(readings.ORIGIN ?? []), ...(readings.PRESENT ?? []), ...(readings.CITED ?? [])]).size >= 2;
  const realAmbiguity = c.truth.anchor === "AMBIGUOUS" && c.expected.decision === "ASK" && divergent;
  const ideal = decideAnchor(idealInput(c)), literal = c.truth.anchor !== "AMBIGUOUS" && ideal.outcome === OUTCOME.ASK && ideal.reason === ASK_REASON.LITERAL_COMPETES;
  const own = literal ? (ideal.readings.find(list => list.anchor === TRUTH_ANCHOR[c.truth.anchor])?.readings ?? []).filter(reading => reading.drop === null)
    .map(reading => shown(c, reading.value as number)) : [];
  return { realAmbiguity, ownValue: own.length === 1 ? own[0] : null };
}
/** §7 as amended by §9.2, for a value used without asking: S4 when it is not the value expected (or a question was expected); S3 instead only for a real
 * ambiguity; W3 (reported, no stop) instead when the expected question came only from a competing cited reference and the value is the true anchor's own. */
function valueCodes(c: ProbeCase, facts: ReturnType<typeof expectation>, used: string | null): { safety: string[]; warnings: string[] } {
  if (used === null) return { safety: [], warnings: [] };
  if (c.expected.decision === "USE") return used === c.expected.value ? { safety: [], warnings: [] } : { safety: ["S4_WRONG_VALUE_WITHOUT_ASK"], warnings: [] };
  if (facts.realAmbiguity) return { safety: ["S3_SILENT_AMBIGUITY"], warnings: [] };
  if (facts.ownValue !== null && used === facts.ownValue) return { safety: [], warnings: ["W3_MISSED_LITERAL_ASK"] };
  return { safety: ["S4_WRONG_VALUE_WITHOUT_ASK"], warnings: [] };
}
const windowsOn = (c: ProbeCase, date: string): WorkingWindow[] => (c.salon.hours.byDate?.[date] ?? c.salon.hours.default).map(([start, end]) => ({ start: minuteOf(start), end: minuteOf(end) }));
/** The A* clock as the E2-B resolver reads it: the same operators; an offset's single anchor as the E2-B list (a cited clock, or no anchor, is no
 * E2-B anchor: an empty list, which the resolver asks as ANCHOR_MISSING). */
function e2bClock(hora: unknown): PilotTempoHora | null {
  const said = hora as { tipo?: string; minutos?: number; ancora?: { tipo?: string } | null; mencao?: string } | null;
  if (!said || said.tipo !== "deslocamento") return said as PilotTempoHora | null;
  const anchor = said.ancora?.tipo;
  return { tipo: "deslocamento", minutos: said.minutos, ancoras: anchor === "origem" || anchor === "agora" ? [anchor] : [], mencao: said.mencao ?? "" } as unknown as PilotTempoHora;
}
/** The orchestrator's knownClock (secretary-pilot.ts), verbatim in substance: the destination clock already known without the day's hours (a relogio
 * with one reading, the appointment's own clock, an offset counted only from the appointment's clock). */
function knownClock(hora: PilotTempoHora | null, originTime: string): string | null {
  if (!hora) return null;
  if (hora.tipo === "relogio") { const readings = pilotClockReadings(hora); return readings.length === 1 ? readings[0] : null; }
  if (hora.tipo === "mesmo_da_origem") return originTime;
  if (hora.tipo === "deslocamento" && hora.ancoras.length && hora.ancoras.every(anchor => anchor === "origem"))
    return pilotClockShiftReadings(hora, { origin: { date: "", time: originTime }, date: "" })[0]?.time ?? null;
  return null;
}
/** §9.1: what the product does with an answer that is no offset in the case's field, through the E2-B resolver of that operator, in the orchestrator's
 * order: with no day said, a clock offset counted from now says the day (resolveClockDay); else the day operator (none said keeps the appointment's
 * day; left open, two readings, past or nonexistent: asked); the clock operator on the case's destination day (none said keeps the appointment's clock on
 * its own day; left open, two readings or none in the hours: asked), then the orchestrator's fact check of a clock already gone (asked, TIME_INVALID). */
async function productDecision(c: ProbeCase, interpretation: AstarInterpretation): Promise<DecisionShown> {
  const clock = { receivedAt: new Date(c.receivedAt), timezone: c.timezone }, origin = { date: c.appointment.date, time: c.appointment.time };
  const asked = (reason: string, options: readonly string[], operator: string): DecisionShown => ({ outcome: "ASK", value: null, basis: null, reason, options: [...options], claim: null, operator });
  const used = (value: string, operator: string): DecisionShown => ({ outcome: "USE", value, basis: null, reason: null, options: null, claim: null, operator });
  const hora = e2bClock(interpretation.destino.hora);
  if (c.target === "date") {
    const dia = interpretation.destino.dia as unknown as PilotTempoDia | null, operator = dia?.tipo ?? "none";
    const implied = dia ? undefined : resolveClockDay(hora, origin, clock, clock);
    const day = implied ?? resolveTargetDate(dia, { date: origin.date }, clock, { time: knownClock(hora, origin.time) }, clock);
    return day.state === "one" ? used(day.date, operator) : asked(day.reason, day.state === "ask" ? day.options : [], operator);
  }
  const operator = hora?.tipo ?? "none";
  const reader = { workingWindows: async (_professional: string | null, date: string) => windowsOn(c, date) } as unknown as PilotReader;
  const time = await resolveTargetTime(reader, hora, { origin, date: c.destinationDay as string, professionalId: null, clock, current: clock });
  if (time.state !== "one") return asked(time.reason, time.state === "ask" ? time.options : [], operator);
  return `${c.destinationDay}T${time.time}` <= pilotNowLocal(clock) ? asked("TIME_INVALID", [], operator) : used(time.time, operator);
}
/** One case scored from Luna's decoded answer (null: no decoded answer). The enum alone never scores: evidence, type, anchor, cited reference and
 * decision. An offset in the case's field is decided by the pure module; any other answer by what the product does with it (§9.1). */
export async function scoreProbeCase(c: ProbeCase, interpretation: AstarInterpretation | null): Promise<ProbeScore> {
  const named = c.truth.startPointNamed, ambiguous = c.truth.anchor === "AMBIGUOUS", expectedCited = truthCited(c);
  const noClaim = { state: null, anchor: null, type: null, contained: false, empty: false }, noCited = { given: false, contained: false, typedEqual: null };
  const noDetail = { evidence: null, citedMention: null, input: null, decision: null };
  if (!interpretation) return { status: "NO_ANSWER", claim: noClaim, cited: noCited, decision: { outcome: "NONE" }, readings: null,
    metrics: { EVIDENCE_OK: false, TYPE_OK: false, ANCHOR_OK: false, CITED_OK: false, DECISION_OK: false }, optionsOk: null, operationOk: null, safety: [], warnings: [],
    falseAsk: false, ambiguityAsked: null, nullOrOutro: false, detail: noDetail };
  const read = lunaRead(c, interpretation), facts = expectation(c);
  if (!read.offset) {
    // §9.1: no anchored offset at all: the evidence, the type and the anchor never pass; the product's value decides S3, S4, W2 and W3.
    const product = await productDecision(c, interpretation), used = product.outcome === "USE" ? product.value : null, codes = valueCodes(c, facts, used);
    const right = used !== null && c.expected.decision === "USE" && used === c.expected.value;
    return { status: "NOT_OFFSET", claim: noClaim, cited: noCited, decision: product, readings: null,
      metrics: { EVIDENCE_OK: false, TYPE_OK: false, ANCHOR_OK: false, CITED_OK: !expectedCited, DECISION_OK: product.outcome === c.expected.decision && (product.outcome !== "USE" || right) },
      optionsOk: product.outcome === "ASK" && c.expected.decision === "ASK" && c.expected.options ? sameList(product.options ?? [], c.expected.options) : null, operationOk: null,
      safety: codes.safety, warnings: [...(right ? ["W2_NOT_OFFSET"] : []), ...codes.warnings], falseAsk: c.expected.decision === "USE" && product.outcome === "ASK",
      ambiguityAsked: facts.realAmbiguity ? product.outcome === "ASK" : null, nullOrOutro: false, detail: noDetail };
  }
  const decision = decideAnchor(read.input), view = decisionView(c, decision), { claim, evidence, empty } = read.claim;
  const accepted = decision.claim === CLAIM_STATE.ACCEPTED, anchorName = claim ? nameOf(ANCHOR, claim.anchor) : null, typeName = claim ? nameOf(EVIDENCE, claim.evidenceType) : null;
  // An empty evidence counts as no claim (spec 13 §2: "" vale como null).
  const claimed = !!claim && !empty, outro = claimed && claim.evidenceType === EVIDENCE.OUTRO, nullOrOutro = !claimed || outro;
  const EVIDENCE_OK = named ? claimed && evidenceMatches(c, evidence as string) : nullOrOutro;
  const TYPE_OK = named ? claimed && (c.truth.evidenceTypes as string[]).includes(String(typeName).toLowerCase()) : nullOrOutro;
  const ANCHOR_OK = ambiguous ? !accepted : named ? claimed && anchorName === c.truth.anchor : !accepted || anchorName === c.truth.anchor;
  const typedEqual = read.cited ? !!expectedCited && JSON.stringify(read.cited.fact) === JSON.stringify(expectedCited) : null;
  const CITED_OK = expectedCited ? !!read.cited && !!typedEqual && read.cited.contained : !read.cited?.contained;
  const used = view.outcome === "USE" ? view.value : null;
  const DECISION_OK = view.outcome === c.expected.decision && (view.outcome !== "USE" || used === c.expected.value);
  const optionsOk = view.outcome === "ASK" && c.expected.decision === "ASK" && c.expected.options ? sameList(view.options as string[], c.expected.options) : null;
  const codes = valueCodes(c, facts, used), safety: string[] = [];
  if (accepted && (ambiguous || anchorName !== c.truth.anchor)) safety.push("S1_WRONG_ANCHOR_ACCEPTED");
  if (accepted && !pilotMentionIn(c.message, evidence ?? "")) safety.push("S2_NONEXISTENT_EVIDENCE_ACCEPTED");
  safety.push(...codes.safety);
  const warnings = [...(accepted && !ambiguous && anchorName === c.truth.anchor && !EVIDENCE_OK ? ["W1_WEAK_EVIDENCE_RIGHT_ANCHOR"] : []), ...codes.warnings];
  return { status: "SCORED", claim: { state: nameOf(CLAIM_STATE, decision.claim), anchor: anchorName, type: typeName, contained: !!claim?.contained, empty },
    cited: { given: !!read.cited, contained: !!read.cited?.contained, typedEqual }, decision: view, readings: readingsView(c, decision),
    metrics: { EVIDENCE_OK, TYPE_OK, ANCHOR_OK, CITED_OK, DECISION_OK }, optionsOk, operationOk: read.operation === truthOperation(c), safety, warnings,
    falseAsk: c.expected.decision === "USE" && view.outcome === "ASK", ambiguityAsked: facts.realAmbiguity ? view.outcome === "ASK" : null, nullOrOutro,
    detail: { evidence, citedMention: read.cited?.mention ?? null, input: read.input, decision } };
}

// ---------------------------------------------------------------- payload (spec 13 §4.4 and §9.4) and the dry-run
const MODEL = PILOT_ASTAR_MODEL;
const USABLE_BYTES = PILOT_REQUEST_CAP.requestCap - PILOT_REQUEST_CAP.outputFraming;
const bytesOf = (request: Parameters<typeof agentRequestBody>[0]) => Buffer.byteLength(JSON.stringify(agentRequestBody(request, MODEL)), "utf8");
/** §9.4 INFORMATIVE only: the full-flow construction of the E2-B payload proof (300 services, 40 team names, an open plan at its two worst shapes, every
 * repair rule of the variant), with the worst documented text, with and without the mencao descriptions, against the cost-guard cap. The probe is one
 * turn with no open plan, so this never gates it; below the 2,048 B rule it is a pending item of the full implementation, reported to the owner. */
export function astarPayloadMeasurement() {
  const services = pilotCatalogNames(Array.from({ length: 300 }, (_, index) => `Ritual sintético ${String(index).padStart(3, "0")}`)).names;
  const team = Array.from({ length: 40 }, (_, index) => `Profissional Sintética Número ${index} de Sobrenome Comprido`);
  const label = (index: number) => `qua, 12/03/2031 às 23h59 — ${"ã".repeat(159)}… com ${"é".repeat(119)}… ${index}`;
  const words = `“${"é".repeat(120)}”`, delegation = `profissional: ${"é".repeat(119)}… (modo outro; sem: ${[words, words, words].join(", ")} e mais 7)`;
  const shapes = [{ lines: [`cliente: “${"ô".repeat(120)}” (cadastro ainda não definido)`, `atendimento atual: ${label(0)}`, "novo dia: não definido", "novo horário: não definido", delegation,
    "proposta pronta, aguardando Confirmar"], question: { questionId: "q999", field: "atendimento atual (origem)", reason: "APPOINTMENT_SEVERAL", options: Array.from({ length: 8 }, (_, index) => label(index + 1)), omitted: 99_992 } },
  { lines: [`cliente: “${"ô".repeat(120)}” (cadastro definido)`, `atendimento atual: ${label(0)}`, `novo dia: não definido (${words})`, "novo horário: não definido", delegation],
    question: { questionId: "q999", field: "quem não deve atender", reason: "EXCLUSION_CONTRADICTORY" } }];
  const kept = astarParameters(true), reclaimed = astarParameters(false);
  const measure = (open: (typeof shapes)[number], parameters: ReturnType<typeof astarParameters>) => {
    const request = astarRequest({ today: { date: "2031-03-10", weekday: "segunda-feira", timezone: "America/Sao_Paulo" }, team, services, open }, PROBE_WORST_TEXT, { repair: WORST_REPAIR });
    return bytesOf({ ...request, tools: [astarTool(parameters) as unknown as (typeof request.tools)[number]] });
  };
  const rows = shapes.map(open => ({ reason: open.question.reason, reclaimedBytes: measure(open, reclaimed), keptBytes: measure(open, kept) }));
  const variant = (bytes: number) => ({ worstBytes: bytes, margin: USABLE_BYTES - bytes, marginOverRequired: USABLE_BYTES - bytes - PROBE_PAYLOAD_REQUIRED });
  return { informative: true as const, text: { codePoints: [...PROBE_WORST_TEXT].length, bytes: Buffer.byteLength(PROBE_WORST_TEXT, "utf8") },
    cap: { requestCap: PILOT_REQUEST_CAP.requestCap, outputFraming: PILOT_REQUEST_CAP.outputFraming, required: PROBE_PAYLOAD_REQUIRED }, shapes: rows,
    reclaimed: variant(Math.max(...rows.map(row => row.reclaimedBytes))), kept: variant(Math.max(...rows.map(row => row.keptBytes))),
    probeVariant: PILOT_ASTAR_MENTION_DESCRIPTIONS ? "kept" as const : "reclaimed" as const };
}
/** §9.4 (the gate): a case's REAL request (its salon's context, no open plan) with the message replaced by the worst documented text, as the first call
 * and as the repair-note shape; `margin` is what the larger one keeps under the cap. */
export function probeCaseBytes(c: ProbeCase) {
  const context = probeRequestContext(c);
  const first = bytesOf(astarRequest(context, PROBE_WORST_TEXT)), repair = bytesOf(astarRequest(context, PROBE_WORST_TEXT, { repair: WORST_REPAIR }));
  return { first, repair, margin: USABLE_BYTES - Math.max(first, repair) };
}
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function readCases(file: string): { bytes: Buffer; raw: unknown } {
  let bytes: Buffer;
  try { bytes = readFileSync(resolve(file)); } catch { throw Error("PROBE_CASES_FILE"); }
  try { return { bytes, raw: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as unknown }; } catch { throw Error("PROBE_CASES_PARSE"); }
}
const fold = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const isInside = (child: string, parent: string) => { const rel = relative(fold(parent), fold(child)); return rel === "" || (!isAbsolute(rel) && rel.split(/[\\/]/)[0] !== ".."); };
/** <folder of the cases file>/runs: where the texts of a paid run go (the only place a dirty path is tolerated, §9.5). */
const runsRootOf = (file: string) => { let real: string; try { real = realpathSync(resolve(file)); } catch { real = resolve(file); } return join(dirname(real), "runs"); };
/** §9.5: HEAD and the paths that differ from it (absolute, untracked files included). Unknown when git cannot tell: no HEAD, or one dirty marker. */
export type ProbeTree = { head: string | null; dirty: string[] };
export function gitTree(): ProbeTree {
  const git = (args: string[]) => execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let head: string | null = null, root = process.cwd(), dirty: string[] = [];
  try { head = git(["rev-parse", "HEAD"]).trim() || null; } catch { head = null; }
  try { root = git(["rev-parse", "--show-toplevel"]).trim() || root; } catch { /* the working directory itself */ }
  try {
    const entries = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      dirty.push(resolve(root, entry.slice(3)));
      if (entry[0] === "R" || entry[0] === "C") index++; // the original path of a rename or a copy follows
    }
  } catch { dirty = [resolve(root, "#git-status-unavailable")]; }
  return { head, dirty };
}
/** §9.5: what every summary records: HEAD, whether the tree is clean (dirty paths inside the sealed runs folder aside) and the sha256 of the traced files. */
function traceability(tree: ProbeTree, runsRoot: string) {
  const dirty = tree.dirty.filter(path => !isInside(path, runsRoot));
  const files = Object.fromEntries(PROBE_TRACED_FILES.map(path => { try { return [path, sha256(readFileSync(resolve(path)))]; } catch { return [path, null]; } }));
  return { head: tree.head, clean: !!tree.head && dirty.length === 0, dirty: dirty.length, files };
}
/** Shared declared names (the evaluation sets' and the prompt examples'), for the contamination counts. */
const promptLint = () => {
  const words = (text: string) => lintFold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const { names } = lintSources(), declared = new Set([...names, ...PILOT_ASTAR_PROMPT_EXAMPLE_NAMES.flatMap(words)]);
  const messages = PILOT_ASTAR_PROMPT.split("\n").filter(line => line.startsWith("Mensagem: ")).map(line => /"(.*)"/u.exec(line)?.[1] ?? "");
  const contentPairs = (text: string) => { const out = new Set<string>(); for (const tokens of lintTokens(text, declared)) { const content = tokens.filter(token => !token.startsWith("<"));
    for (let index = 0; index + 2 <= content.length; index++) out.add(`${content[index]} ${content[index + 1]}`); } return out; };
  const promptGrams = lintGrams(PILOT_ASTAR_PROMPT, declared), examplePairs = new Set(messages.flatMap(message => [...contentPairs(message)]));
  const exampleNames = new Set(PILOT_ASTAR_PROMPT_EXAMPLE_NAMES.flatMap(words)), prompt = ` ${lintFold(PILOT_ASTAR_PROMPT)} `;
  return (c: ProbeCase) => ({ names: [...c.salon.team.map(member => member.name), c.appointment.customer, c.appointment.professional].filter(name => words(name).some(word => exampleNames.has(word))).length,
    catalog: c.salon.catalog.filter(name => name.trim() && prompt.includes(` ${lintFold(name)} `)).length, grams: [...lintGrams(c.message, declared)].filter(gram => promptGrams.has(gram)).length,
    pairs: [...contentPairs(c.message)].filter(pair => examplePairs.has(pair)).length });
};
/** The dry-run of a cases file (no network): every line is codes only. `ready`: every case valid, every expectation met under the ideal claim, the
 * evidence self-test complete and each case's real request within the §9.4 byte rule. The full-flow numbers and the contamination counts are informative. */
export async function dryRunProbe(file: string, deps: { print: (line: string) => void; tree?: () => ProbeTree }) {
  const { bytes, raw } = readCases(file), { cases, errors } = validateProbeCases(raw), lines: Record<string, unknown>[] = [];
  const emit = (line: Record<string, unknown>) => { lines.push(line); deps.print(JSON.stringify(line)); };
  for (const error of errors) emit({ kind: "DRY_RUN_CASE", id: error.id, ok: false, codes: error.codes });
  // Informative counts only (never part of `ready`); unavailable when the evaluation sources cannot be read from this directory.
  let contamination: ReturnType<typeof promptLint> | null;
  try { contamination = promptLint(); } catch { contamination = null; }
  const totals = { names: 0, catalog: 0, grams: 0, pairs: 0 }, selfTest = { cases: 0, spans: 0, ok: 0, failed: [] as string[] };
  const perCase = { required: PROBE_PAYLOAD_REQUIRED, maxFirst: 0, maxRepair: 0, minMargin: null as number | null, overMargin: [] as string[] };
  let mismatched = 0, worstCall = 0;
  for (const c of cases) {
    const codes: string[] = [], named = c.truth.startPointNamed && c.truth.anchor !== "AMBIGUOUS";
    if (c.truth.startPointNamed && !c.truth.evidenceSpans.every(span => pilotMentionIn(c.message, span))) codes.push("TRUTH_SPAN_NOT_CONTAINED");
    // Self-test (spec 13 §6, both sides normalized alike): each span, copied exactly as written as the evidence of an ideal answer, scores EVIDENCE_OK.
    let evidenceSelfTest: { spans: number; ok: number } | null = null;
    if (c.truth.startPointNamed) {
      const results = await Promise.all(c.truth.evidenceSpans.map(async span => (await scoreProbeCase(c, idealInterpretation(c, span))).metrics.EVIDENCE_OK));
      evidenceSelfTest = { spans: results.length, ok: results.filter(Boolean).length };
      selfTest.cases++; selfTest.spans += evidenceSelfTest.spans; selfTest.ok += evidenceSelfTest.ok;
      if (evidenceSelfTest.ok !== evidenceSelfTest.spans) { codes.push("EVIDENCE_SELF_TEST"); selfTest.failed.push(c.id); }
    }
    if (truthCited(c) && !c.truth.citedMentions.some(mention => pilotMentionIn(c.message, mention))) codes.push("TRUTH_CITED_NOT_CONTAINED");
    if (c.truth.startPointNamed && c.truth.anchor === "AMBIGUOUS") codes.push("TRUTH_NAMED_AMBIGUOUS");
    const decision = decideAnchor(idealInput(c)), view = decisionView(c, decision), readings = readingsView(c, decision);
    if (named && decision.claim !== CLAIM_STATE.ACCEPTED) codes.push("IDEAL_CLAIM_NOT_ACCEPTED");
    for (const anchor of ["ORIGIN", "PRESENT", "CITED"] as const) if (!sameList(readings[anchor], c.expected.readings[anchor] ?? [])) codes.push(`READINGS_${anchor}`);
    if (view.outcome !== c.expected.decision) codes.push("DECISION_KIND");
    else if (view.outcome === "USE" && view.value !== c.expected.value) codes.push("DECISION_VALUE");
    else if (view.outcome === "ASK" && c.expected.options && !sameList(view.options as string[], c.expected.options)) codes.push("DECISION_OPTIONS");
    // §9.4: the case's real request with the worst documented text keeps 2,048 B under the cap (first call and repair-note shape).
    const caseBytes = probeCaseBytes(c);
    perCase.maxFirst = Math.max(perCase.maxFirst, caseBytes.first); perCase.maxRepair = Math.max(perCase.maxRepair, caseBytes.repair);
    perCase.minMargin = perCase.minMargin === null ? caseBytes.margin : Math.min(perCase.minMargin, caseBytes.margin);
    if (caseBytes.margin < PROBE_PAYLOAD_REQUIRED) { codes.push("REQUEST_OVER_MARGIN"); perCase.overMargin.push(c.id); }
    const requestBytes = bytesOf(astarRequest(probeRequestContext(c), c.message)), worst = worstCaseMicroUsd(requestBytes, 8192);
    worstCall = Math.max(worstCall, worst);
    const counts = contamination ? contamination(c) : null;
    if (counts) for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += counts[key];
    if (codes.length) mismatched++;
    emit({ kind: "DRY_RUN_CASE", id: c.id, priority: c.priority, twin: c.twin, target: c.target, ok: codes.length === 0, codes,
      ideal: { claim: view.claim, outcome: view.outcome, value: view.value, options: view.options }, evidenceSelfTest, bytes: caseBytes, requestBytes, worstCaseUsd: worst / 1e6,
      contamination: counts });
  }
  // Projection (informative): calls at the E2-B mean, one per case, checked like the run (spent + worst case of the next call ≤ cap).
  let spent = 0, projected = 0;
  for (let index = 0; index < cases.length && spent + worstCall <= PROBE_CAP_USD * 1e6; index++) { spent += HISTORICAL_CALL_MICRO_USD; projected++; }
  const payload = { perCase, fullFlowInformative: astarPayloadMeasurement() }, ready = errors.length === 0 && mismatched === 0 && cases.length > 0;
  const summary = { kind: "DRY_RUN_SUMMARY", casesSha256: sha256(bytes), contractSha256: PILOT_ASTAR_CONTRACT_SHA256, cases: cases.length + errors.length, valid: cases.length,
    mismatched, ids: cases.map(c => c.id), payload, projection: { capUsd: PROBE_CAP_USD, worstCallUsd: worstCall / 1e6, historicalCallUsd: HISTORICAL_CALL_MICRO_USD / 1e6,
      casesBeforeCapAtHistoricalMean: projected }, evidenceSelfTest: { ...selfTest, complete: selfTest.ok === selfTest.spans },
    contamination: contamination ? { ...totals, clean: Object.values(totals).every(count => count === 0) } : null,
    traceability: traceability((deps.tree ?? gitTree)(), runsRootOf(file)), ready };
  emit(summary);
  return { ready, lines, cases, sha256: summary.casesSha256, payload, traceability: summary.traceability };
}

// ---------------------------------------------------------------- paid mode
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
export type ProbeRunDeps = { env: Record<string, string | undefined>; print: (line: string) => void;
  /** the raw transport behind the guard and the ledger (default: globalThis.fetch at the start of the run) */ network?: typeof fetch;
  /** the program ledger (default: the user ledger; a unit test passes a temporary one) */ ledger?: string;
  /** the checkout roots a runs folder must stay out of (default: this checkout) */ roots?: string[];
  /** HEAD and the dirty paths (default: git, fail closed) */ tree?: () => ProbeTree;
  /** the check of a request against the run's cap before it is sent (default: runSpendCapReached on this run): true when the request would pass the
   * cap; a throw is the guard refusing it */ capCheck?: (input: FetchInput, init: FetchInit) => boolean };
function checkoutRoots(): string[] {
  const roots = [process.cwd()], git = (args: string[]) => execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try { roots.push(git(["rev-parse", "--show-toplevel"])); } catch { /* not a checkout */ }
  try { roots.push(dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]))); } catch { /* idem */ }
  return [...new Set(roots.filter(Boolean).flatMap(root => { try { return [resolve(root), realpathSync(root)]; } catch { return [resolve(root)]; } }))];
}
/** The paid client: the E2-B wiring (dedicated credentials, no retries) whose guarded fetch admits ONLY the probe's wire. §9.6: the SDK logs nothing
 * (logLevel "off" wins over OPENAI_LOG), so no request, header or answer ever reaches stdout or stderr through it. */
export async function createProbeModel(env: Record<string, string | undefined>): Promise<Model> {
  if (env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "true") throw Error("PAID_CALLS_DISABLED");
  const modelId = env.SALON_SECRETARY_MODEL, apiKey = env.SALON_SECRETARY_OPENAI_API_KEY, project = env.SALON_SECRETARY_OPENAI_PROJECT;
  if (!modelId || !apiKey || !project) throw Error("SECRETARY_CONFIGURATION_REQUIRED");
  if (modelId !== PILOT_ASTAR_MODEL) throw Error("PROBE_MODEL");
  const client = new OpenAI({ apiKey, project, organization: null, baseURL: "https://api.openai.com/v1", maxRetries: 0, timeout: 30_000, logLevel: "off",
    fetch: secretaryGuardedFetch(modelId, { pilotAnchorProbe: true }) });
  return await new OpenAIProvider({ openAIClient: client, useResponses: true }).getModel(modelId);
}
type CallRecord = { id: string; latencyMs: number; status: number | null; usage: { input: number; cached: number; output: number; reasoning: number } | null; chargedMicroUsd: number };
const percentile = (values: number[], p: number) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]; };
const CODE = /^[A-Z][A-Z0-9_]{2,63}(?::[A-Za-z0-9_.#+*-]{1,40}){0,3}$/;
export const probeErrorCode = (error: unknown) => error instanceof Error && CODE.test(error.message) ? error.message : "PROBE_ERROR";
/** §9.4: the guard refusing the request itself (its wire or its size: no reservation, no transport). Only this fails a case and lets the run go on. */
const REFUSED = "PROGRAM_SPEND_WIRE";
const NO_METRICS = Object.freeze({ EVIDENCE_OK: false, TYPE_OK: false, ANCHOR_OK: false, CITED_OK: false, DECISION_OK: false });
/** §9.8 (N2): the product's own safe failures (a format still invalid after the one repair; the 15 s / 45 s deadline): it answers with the safe message
 * and writes nothing. */
const SAFE_FAILURES: readonly string[] = ["PILOT_SCHEMA", "PILOT_DEADLINE"];
/** §9.8 (N2): a case with no scored answer. FAILED_SAFE is reported and never changes the verdict. FAILED_INFRA (transport, the guard's refusal
 * REQUEST_REFUSED, the budget, the request guard, and any code not known as safe): Luna's answer was not measured, so any such case turns
 * PREMISSA_SEGURA into PREMISSA_INCONCLUSIVA. */
export const probeFailureClass = (code: string | null): "FAILED_SAFE" | "FAILED_INFRA" => code !== null && SAFE_FAILURES.includes(code) ? "FAILED_SAFE" : "FAILED_INFRA";
/** The paid probe (spec 13 §8 and §9). Refusals first (no ledger row, no call); then case by case in priority order; stop at the first safety code.
 * Always ends in a summary with a verdict once the ledger is open: a case the guard refuses is FAILED_INFRA (REQUEST_REFUSED) and the run goes on; the
 * cap, a ledger stop or an unexpected wire stop it (the case is listed in `unrun`), and after any stop no call goes out (§9.9). */
export async function runProbe(options: { file: string; capUsd?: number }, deps: ProbeRunDeps) {
  const env = deps.env, capUsd = options.capUsd ?? PROBE_CAP_USD;
  if (env.VERCEL_ENV === "production" || env.APP_ENV === "production") throw Error("PROBE_PRODUCTION_FORBIDDEN");
  if (env[PROBE_ENV.approved] !== "true") throw Error("PROBE_NOT_APPROVED");
  if (!(typeof capUsd === "number" && capUsd > 0 && capUsd <= PROBE_CAP_USD)) throw Error("PROBE_CAP_ARGUMENT");
  const { bytes } = readCases(options.file);
  if (sha256(bytes) !== String(env[PROBE_ENV.casesSha] ?? "").trim().toLowerCase()) throw Error("PROBE_CASES_SHA_MISMATCH");
  if (PILOT_ASTAR_CONTRACT_SHA256 !== String(env[PROBE_ENV.contractSha] ?? "").trim().toLowerCase()) throw Error("PROBE_CONTRACT_SHA_MISMATCH");
  if (env.SALON_SECRETARY_MODEL !== PILOT_ASTAR_MODEL) throw Error("PROBE_MODEL");
  // The dry-run must be clean (any divergence is resolved before spending); its lines are not printed here. One tree snapshot serves it and §9.5.
  const tree = (deps.tree ?? gitTree)(), dry = await dryRunProbe(options.file, { print: () => undefined, tree: () => tree });
  if (dry.sha256 !== sha256(bytes)) throw Error("PROBE_CASES_SHA_MISMATCH");
  if (!dry.ready) throw Error("PROBE_DRY_RUN_MISMATCH");
  const runsRoot = runsRootOf(options.file);
  if ((deps.roots ?? checkoutRoots()).some(root => isInside(runsRoot, root))) throw Error("PROBE_RESULTS_INSIDE_CHECKOUT");
  // §9.5: what runs is what HEAD holds (dirty paths inside the sealed runs folder aside), and every traced file is hashed from the checkout root (cwd,
  // as for every launcher): a file that cannot be read there would leave its sha256 out of the summary.
  if (!dry.traceability.clean) throw Error("PROBE_TREE_DIRTY");
  if (Object.values(dry.traceability.files).some(hash => hash === null)) throw Error("PROBE_TRACE_UNREADABLE");
  const ledger = deps.ledger ?? programSpendLedgerPath();
  programSpendTotals(ledger); // the whole chain and its anchor, before anything else
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"), run = programSpendLabel(`probe:astar-${stamp}`), runDir = join(runsRoot, stamp);
  const capMicroUsd = Math.round(capUsd * 1e6), network = deps.network ?? globalThis.fetch, saved = globalThis.fetch;
  const capCheck = deps.capCheck ?? ((input: FetchInput, init: FetchInit) => runSpendCapReached(input, init, { ledger, run, capMicroUsd, pilotAnchorProbe: true }));
  const proof: ProofLease = acquireProofLease(ledger, run);
  const records: CallRecord[] = [], lines: Record<string, unknown>[] = [];
  const scores: { c: ProbeCase; score: ProbeScore | null; failure: ReturnType<typeof probeFailureClass> | null; latencyMs: number | null }[] = [];
  let active: { id: string; n: number; refused: boolean } | null = null, halted: string | undefined;
  const halt = (code: string) => { halted ??= code; return Error(code); };
  // A refusal of the request itself fails the case (the SDK sees a transport error); anything else from the guard or the ledger stops the run.
  const refuse = (error: unknown) => { const code = probeErrorCode(error); if (code === REFUSED && active) { active.refused = true; return Error("REQUEST_REFUSED"); } return halt(code); };
  const emit = (line: Record<string, unknown>) => { lines.push(line); deps.print(JSON.stringify(line)); };
  try {
    mkdirSync(runDir, { recursive: true });
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
      // §9.9 (N3): once the run has halted, no call goes out, whoever makes it.
      if (halted) throw Error(halted);
      if (!active) throw halt("PROBE_UNEXPECTED_NETWORK");
      if (typeof input !== "string" || input !== RESPONSES_URL || init?.method?.toUpperCase() !== "POST" || typeof init.body !== "string") throw halt("PROBE_WIRE");
      // The cap before each call: what this run spent (open calls at their worst case) plus this call's worst case.
      let reached: boolean;
      try { reached = capCheck(input, init); } catch (error) { throw refuse(error); }
      if (reached) throw halt("PROBE_CAP");
      try { await assertProgramHeadroom(input, init, { ledger, proof, pilotAnchorProbe: true }); } catch (error) { throw refuse(error); }
      const item = programSpendLabel(`${active.id}:c${++active.n}`), started = performance.now(), worst = worstCaseMicroUsd(Buffer.byteLength(init.body, "utf8"), 8192);
      let response: Response;
      try { response = await guardPaidFetch("practice", network, { ledger, run, item, proof, pilotAnchorProbe: true })(input, init); }
      catch (error) {
        const code = probeErrorCode(error);
        records.push({ id: active.id, latencyMs: Math.round(performance.now() - started), status: null, usage: null, chargedMicroUsd: code === REFUSED ? 0 : worst });
        throw /^PROGRAM_SPEND_/.test(code) ? refuse(error) : error;
      }
      let actual: ReturnType<typeof responsesEstimator.actual> = null;
      try { actual = responsesEstimator.actual(await response.clone().json()); } catch { actual = null; }
      const usage = actual ? actual.usage as CallRecord["usage"] : null;
      records.push({ id: active.id, latencyMs: Math.round(performance.now() - started), status: response.status, usage, chargedMicroUsd: response.ok && actual ? actual.chargedMicroUsd : worst });
      return response;
    }) as typeof fetch;
    env.SALON_SECRETARY_ALLOW_PAID_CALLS = "true";
    const model = await createProbeModel(env);
    let stoppedBy: string | null = null;
    const unrun: string[] = [];
    // §9.9 (N3): a halt raised between cases (a stray call with no case active) stops the run before the next case starts.
    const haltedStop = () => { if (!stoppedBy && halted) stoppedBy = halted === "PROBE_CAP" ? "CAP" : halted; };
    for (const c of dry.cases) {
      haltedStop();
      if (stoppedBy) { unrun.push(c.id); continue; }
      const context = probeRequestContext(c), head = { kind: "CASE", id: c.id, priority: c.priority, twin: c.twin, target: c.target };
      // The same check before the first call of the case, on the body it will send (nothing is started past the cap).
      const body = JSON.stringify(agentRequestBody(astarRequest(context, c.message), MODEL));
      let reached: boolean;
      try { reached = capCheck(RESPONSES_URL, { method: "POST", body }); }
      catch (error) {
        const code = probeErrorCode(error);
        if (code === REFUSED) {
          // §9.4: refused before any call: failed (§9.8: infrastructure), the run goes on.
          scores.push({ c, score: null, failure: probeFailureClass("REQUEST_REFUSED"), latencyMs: null });
          emit({ ...head, status: probeFailureClass("REQUEST_REFUSED"), code: "REQUEST_REFUSED", calls: 0, repaired: false, latencyMs: 0, callLatencyMs: [], tokens: { input: 0, cached: 0, output: 0, reasoning: 0 },
            costUsd: 0, requestBytes: [Buffer.byteLength(body, "utf8")], metrics: NO_METRICS, safety: [], warnings: [] });
          writeFileSync(join(runDir, `${c.id}.json`), JSON.stringify({ case: c, refused: code }, null, 2));
          continue;
        }
        stoppedBy = code; unrun.push(c.id);
        emit({ ...head, status: "ABORTED", code, calls: 0, safety: [], warnings: [] });
        writeFileSync(join(runDir, `${c.id}.json`), JSON.stringify({ case: c, stopped: code }, null, 2));
        continue;
      }
      if (reached) { stoppedBy = "CAP"; unrun.push(c.id); continue; }
      active = { id: c.id, n: 0, refused: false };
      const started = performance.now(), outcome = await runAstarInterpretation(model, { context, message: c.message, modelId: MODEL, startedAt: started });
      const refused = active.refused;
      active = null;
      const latencyMs = Math.round(performance.now() - started), calls = records.filter(record => record.id === c.id);
      const tokens = calls.reduce((sum, record) => ({ input: sum.input + (record.usage?.input ?? 0), cached: sum.cached + (record.usage?.cached ?? 0), output: sum.output + (record.usage?.output ?? 0),
        reasoning: sum.reasoning + (record.usage?.reasoning ?? 0) }), { input: 0, cached: 0, output: 0, reasoning: 0 });
      const costUsd = calls.reduce((sum, record) => sum + record.chargedMicroUsd, 0) / 1e6;
      const base = { ...head, calls: outcome.telemetry.calls, repaired: outcome.telemetry.repaired, latencyMs, callLatencyMs: calls.map(record => record.latencyMs), tokens, costUsd,
        requestBytes: outcome.telemetry.request_bytes };
      if (halted) {
        // A cap or ledger stop inside the case (its repair): the case is not scored, it is listed unrun (§9.6) and nothing else runs.
        stoppedBy = halted === "PROBE_CAP" ? "CAP" : halted;
        unrun.push(c.id);
        emit({ ...base, status: halted === "PROBE_CAP" ? "CAP_STOP" : "ABORTED", code: halted, safety: [], warnings: [] });
        writeFileSync(join(runDir, `${c.id}.json`), JSON.stringify({ case: c, luna: { ok: outcome.ok, raw: outcome.raw }, stopped: halted }, null, 2));
        continue;
      }
      const score = outcome.ok ? await scoreProbeCase(c, outcome.interpretation) : null;
      // §9.8 (N2): no scored answer: the product's safe failure, or infrastructure (a refusal inside the case is infrastructure whatever the SDK said).
      const failureCode = score ? null : refused ? "REQUEST_REFUSED" : outcome.ok ? null : outcome.code, failure = score ? null : probeFailureClass(failureCode);
      scores.push({ c, score, failure, latencyMs });
      const line = score ? { ...base, status: score.status, claim: score.claim, cited: score.cited, decision: score.decision, expected: { outcome: c.expected.decision, value: c.expected.value,
        options: c.expected.options }, metrics: score.metrics, optionsOk: score.optionsOk, operationOk: score.operationOk, safety: score.safety, warnings: score.warnings }
        : { ...base, status: failure, code: failureCode,
          schema: outcome.telemetry.schema.filter(code => CODE.test(code) || /^SCHEMA:[a-z_]+@[A-Za-z0-9_.]*$/.test(code)), metrics: NO_METRICS, safety: [], warnings: [] };
      emit(line);
      writeFileSync(join(runDir, `${c.id}.json`), JSON.stringify({ case: c, luna: { ok: outcome.ok, code: outcome.ok ? null : outcome.code, raw: outcome.raw,
        interpretation: outcome.ok ? outcome.interpretation : null }, score, line }, null, 2));
      if (score?.safety.length) stoppedBy = score.safety[0];
    }
    haltedStop(); // a stray call after the last case still marks the run
    const scored = scores.flatMap(entry => entry.score ? [entry.score] : []), count = (key: keyof ProbeScore["metrics"]) => scored.filter(score => score.metrics[key]).length;
    const offsetScored = scored.filter(score => score.status === "SCORED").length, notOffset = scored.filter(score => score.status === "NOT_OFFSET").length;
    const useExpected = scores.filter(entry => entry.c.expected.decision === "USE").length, ambiguities = scored.filter(score => score.ambiguityAsked !== null);
    const warned = (code: string) => scores.filter(entry => entry.score?.warnings.includes(code)).map(entry => entry.c.id);
    const w1 = warned("W1_WEAK_EVIDENCE_RIGHT_ANCHOR"), w2 = warned("W2_NOT_OFFSET"), w3 = warned("W3_MISSED_LITERAL_ASK");
    const latencies = scores.flatMap(entry => entry.latencyMs === null ? [] : [entry.latencyMs]), totals = programSpendTotals(ledger).byRun[run];
    const failedOf = (kind: ReturnType<typeof probeFailureClass>) => scores.filter(entry => entry.failure === kind).map(entry => entry.c.id);
    const failedSafe = failedOf("FAILED_SAFE"), failedInfra = failedOf("FAILED_INFRA");
    const failed = { safe: { count: failedSafe.length, ids: failedSafe }, infra: { count: failedInfra.length, ids: failedInfra } };
    // §9.3 and §9.8: REPROVADA at a safety code; SEGURA only when the cases ended or the cap was reached, at least one case was scored as an offset AND
    // no case failed for infrastructure (FAILED_SAFE never changes it); any other end is INCONCLUSIVA, with the reason, the infrastructure ids and the counts.
    const safetyStop = stoppedBy !== null && (SAFETY_CODES as readonly string[]).includes(stoppedBy);
    const verdict = safetyStop ? "PREMISSA_REPROVADA"
      : (stoppedBy === null || stoppedBy === "CAP") && offsetScored > 0 && failedInfra.length === 0 ? "PREMISSA_SEGURA" : "PREMISSA_INCONCLUSIVA";
    const reason = stoppedBy !== null && stoppedBy !== "CAP" ? stoppedBy : failedInfra.length ? "INFRA_FAILED" : "NO_OFFSET_SCORED";
    const inconclusive = verdict !== "PREMISSA_INCONCLUSIVA" ? null : { reason, infraIds: failedInfra, offsetScored, notOffset, executed: scores.length,
      failedSafe: failedSafe.length, failedInfra: failedInfra.length, unrun: unrun.length };
    const maxRequestBytes = Math.max(0, ...lines.flatMap(line => Array.isArray(line.requestBytes) ? line.requestBytes as number[] : []));
    const fullFlow = dry.payload.fullFlowInformative;
    const summary = { kind: "SUMMARY", verdict, stoppedBy, executed: scores.length, offsetScored, notOffset, total: dry.cases.length, unrun,
      complete: unrun.length === 0 && !stoppedBy, inconclusive, failed,
      metrics: { EVIDENCE_OK: count("EVIDENCE_OK"), TYPE_OK: count("TYPE_OK"), ANCHOR_OK: count("ANCHOR_OK"), CITED_OK: count("CITED_OK"), DECISION_OK: count("DECISION_OK") },
      ambiguitiesAsked: { asked: ambiguities.filter(score => score.ambiguityAsked).length, expected: ambiguities.length },
      falseAsks: { count: scored.filter(score => score.falseAsk).length, ids: scores.filter(entry => entry.score?.falseAsk).map(entry => entry.c.id), useExpected, g3Limit: 1 },
      nullOrOutro: scored.filter(score => score.nullOrOutro).length, w1: { count: w1.length, ids: w1 }, w2: { count: w2.length, ids: w2 }, w3: { count: w3.length, ids: w3 },
      latencyMs: { p50: percentile(latencies, 0.5), p90: percentile(latencies, 0.9) },
      cost: { runUsd: (totals?.spentMicroUsd ?? 0) / 1e6, capUsd, calls: totals?.calls ?? 0, open: totals?.open ?? 0 },
      payload: { maxRequestBytes, finalMargin: USABLE_BYTES - maxRequestBytes, perCase: dry.payload.perCase,
        fullFlowInformative: { variant: fullFlow.probeVariant, ...fullFlow[fullFlow.probeVariant] } },
      casesSha256: dry.sha256, contractSha256: PILOT_ASTAR_CONTRACT_SHA256, traceability: dry.traceability, run, detail: runDir };
    emit(summary);
    writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
    writeFileSync(join(runDir, "lines.jsonl"), lines.map(line => JSON.stringify(line)).join("\n") + "\n");
    return summary;
  } finally {
    active = null;
    globalThis.fetch = saved;
    env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
    try { releaseProofLease(proof, ledger); } catch { /* stays: the next paid run is refused until the operator releases it */ }
  }
}

// ---------------------------------------------------------------- CLI
export type ProbeArgs = { cases: string; dryRun: boolean; capUsd: number };
/** --cases <file> [--dry-run] [--cap-usd <dollars, at most PROBE_CAP_USD = 0.04>] */
export function parseProbeArgs(argv: readonly string[]): ProbeArgs {
  const args = [...argv], values: Record<string, string> = {};
  while (args.length) {
    const key = args.shift() as string;
    if (key === "--dry-run") { if (values[key]) throw Error("PROBE_ARGUMENT"); values[key] = "true"; continue; }
    if ((key !== "--cases" && key !== "--cap-usd") || !args.length || key in values) throw Error("PROBE_ARGUMENT");
    values[key] = args.shift() as string;
  }
  const cap = values["--cap-usd"], capUsd = cap === undefined ? PROBE_CAP_USD : Number(cap);
  if (!values["--cases"] || (cap !== undefined && (!/^\d+(\.\d{1,6})?$/.test(cap) || !(capUsd > 0) || capUsd > PROBE_CAP_USD))) throw Error("PROBE_ARGUMENT");
  return { cases: values["--cases"], dryRun: values["--dry-run"] === "true", capUsd };
}
/** The CLI: 0 when the dry-run is ready or the paid run ended (its verdict is in the summary), 2 when the dry-run is not ready, 1 when blocked (a code). */
export async function probeCli(argv: readonly string[], env: Record<string, string | undefined>, print: (line: string) => void, deps: Partial<Omit<ProbeRunDeps, "env" | "print">> = {}): Promise<number> {
  try {
    const args = parseProbeArgs(argv);
    if (args.dryRun) return (await dryRunProbe(args.cases, { print, tree: deps.tree })).ready ? 0 : 2;
    await runProbe({ file: args.cases, capUsd: args.capUsd }, { env, print, ...deps });
    return 0;
  } catch (error) {
    print(JSON.stringify({ status: "BLOCKED", code: probeErrorCode(error) }));
    return 1;
  }
}
