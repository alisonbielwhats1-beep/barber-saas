import { PILOT_CONTRACT_LIMITS, type PilotCitedDay, type PilotClockShift, type PilotDayAnchor, type PilotDayShift, type PilotDestination, type PilotOrigin, type PilotTempoDia,
  type PilotTempoHora, type PilotTimeAnchor, type PilotWeekday } from "../../packages/salon-secretary/src/pilot-reschedule-contract";
import { nameScore, nameTokens, SUGGESTION_LIMIT, SUGGESTION_THRESHOLD } from "./name-search";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, toLocalDateTime, weekdayOfDateKey } from "./time";

/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE, default off; docs/c5-spike/12-piloto-remarcacao.md §0, §3): the deterministic
 * resolver after Luna. It never re-reads the owner's Portuguese: it normalizes the MENTIONS Luna extracted (lower case, no accents, the name
 * particles of the existing nameTokens) to find real records of the session's salon, computes days and clocks from the typed operators and the
 * frozen received_at in the salon's timezone, detects real ambiguity (2+ records, two valid readings in the data) and locates the appointment
 * once. The owner's message is used for one thing only, the narrow provenance check: a hint may choose among 2+ real appointments only when its
 * mention appears in the message (normalized search); otherwise it is ignored and the Secretária asks. That check never drops the action nor
 * changes a value. No word lists, no case or punctuation as evidence. Pure functions over an injected, tenant-scoped reader. E2-B (§11): an
 * offset ("deslocamento") is computed for each anchor the model LISTED (never an anchor chosen from words; §11.3: a cited reference gives each day
 * it may name): readings that differ are asked; and a delegated professional ("qualquer", "outro") is decision 15 over facts, with no preference
 * for the current one. */
export type PilotPerson = { id: string; name: string };
export type PilotProfessionalRow = PilotPerson & { serviceIds: readonly string[] };
export type PilotServiceRow = { id: string; name: string; durationMin: number; priceCents: number };
/** A booked appointment in the salon's local time ("YYYY-MM-DDTHH:mm"); `status` as stored (only PENDING and CONFIRMED are ever candidates).
 * `serviceId` is the appointment's first service; E2-A review SERVICE-1: `serviceIds`, every service of its items (a combo holds each of them). */
export type PilotAppointmentRow = { id: string; customerId: string; professionalId: string; professionalName: string; serviceId: string; serviceName: string;
  startLocal: string; endLocal: string; status: string; durationMin: number; priceCents: number; /** M11: booked for a dependent of the customer. */ dependentName?: string | null;
  serviceIds?: readonly string[] };
/** E2-A review SERVICE-1: the services an appointment holds (every item's; its first service when the row carries no items). Exact ids only. */
export const pilotServicesOf = (row: Pick<PilotAppointmentRow, "serviceId" | "serviceIds">): readonly string[] => row.serviceIds?.length ? row.serviceIds : [row.serviceId];
/** One working interval of a local day, in minutes [start, end). */
export type PilotWindow = { start: number; end: number };
/** What occupies a professional on a local day: an appointment (its id) or a block (null). */
export type PilotBusy = { appointmentId: string | null; startLocal: string; endLocal: string };
/** Tenant-scoped reads (the session's salon only). A failing read throws; the resolver turns it into "unavailable", never into "not found". */
export interface PilotReader {
  /** Customers that may match the mention: at least every one sharing a folded name token with it (more is allowed, never fewer). */
  customers(mencao: string): Promise<readonly PilotPerson[]>;
  /** The customer's appointments; `fromLocal` (received_at, local) may prefilter, and the resolver keeps only PENDING/CONFIRMED from it on. */
  appointmentsOf(customerId: string, fromLocal: string): Promise<readonly PilotAppointmentRow[]>;
  /** The salon's active professionals with the services each one performs. */
  team(): Promise<readonly PilotProfessionalRow[]>;
  catalog(): Promise<readonly PilotServiceRow[]>;
  /** Working intervals on a local day: of the professional, or of the salon (null: the union of its professionals'). */
  workingWindows(professionalId: string | null, date: string): Promise<readonly PilotWindow[]>;
  busy(professionalId: string, date: string): Promise<readonly PilotBusy[]>;
}
/** The turn's frozen received_at and the salon's IANA timezone. */
export type PilotClock = { receivedAt: Date; timezone: string };

export const PILOT_IDENTITY_STATES = ["exact", "partial", "ambiguous", "contradictory", "not_found", "unavailable"] as const;
export type PilotIdentityState = (typeof PILOT_IDENTITY_STATES)[number];
/** exact: the mention's tokens equal one record's and no other record holds them all (bound); partial: they are contained in ONE record (bound;
 * the proposal shows its full name); ambiguous: 2+ records hold them all (asked with those records); contradictory: no record holds them all
 * and exactly one shares some of them ("Encontrei X, mas você escreveu Y": asked, never substituted); not_found: asked, with tolerant suggestions
 * of real records when there are any (never bound); unavailable: the search failed (a safe error, never "does not exist"). */
export type PilotIdentity =
  | { state: "exact" | "partial"; id: string; name: string; mencao: string; provenance: "explicit" }
  | { state: "ambiguous"; options: PilotPerson[]; mencao: string; provenance: "unresolved" }
  | { state: "contradictory"; candidate: PilotPerson; mencao: string; provenance: "unresolved" }
  | { state: "not_found"; suggestions: PilotPerson[]; mencao: string; provenance: "unresolved" }
  | { state: "unavailable"; mencao: string; provenance: "unresolved" };

// ---------------------------------------------------------------- normalization of mentions (never of the owner's grammar)
/** Folded text for the provenance search: no accents, lower case, any run of non-letters/digits one space. */
export const pilotFold = (text: string) => ` ${text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
/** Whether a mention Luna copied appears in the owner's message, as whole words (case, accents and punctuation aside). */
export function pilotMentionIn(message: string, mention: string | null | undefined): boolean {
  // L3: a degenerate mention (a lone letter, a particle) proves nothing.
  if (!mention || !nameTokens(mention).some(token => token.length >= 2 || /^\p{N}+$/u.test(token))) return false;
  return pilotFold(message).includes(pilotFold(mention));
}
const tokensOf = (text: string) => [...new Set(nameTokens(text))];
const holds = (name: string, tokens: readonly string[]) => { const own = new Set(nameTokens(name)); return tokens.every(token => own.has(token)); };
const byName = (a: PilotPerson, b: PilotPerson) => a.name.localeCompare(b.name, "pt-BR") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const person = (row: PilotPerson): PilotPerson => ({ id: row.id, name: row.name });

/** The identity states over rows already read (customers or the team), by the folded tokens of the mention. */
export function pilotIdentityOf(rows: readonly PilotPerson[], mencao: string): PilotIdentity {
  const tokens = tokensOf(mencao), seen = new Set<string>();
  const unique = rows.filter(row => typeof row?.id === "string" && typeof row.name === "string" && !seen.has(row.id) && !!seen.add(row.id)).map(person);
  if (!tokens.length) return { state: "not_found", suggestions: [], mencao, provenance: "unresolved" };
  const holding = unique.filter(row => holds(row.name, tokens)).sort(byName);
  if (holding.length === 1) {
    const exact = new Set(nameTokens(holding[0].name)).size === tokens.length;
    return { state: exact ? "exact" : "partial", id: holding[0].id, name: holding[0].name, mencao, provenance: "explicit" };
  }
  if (holding.length > 1) return { state: "ambiguous", options: holding, mencao, provenance: "unresolved" };
  const sharing = unique.filter(row => nameTokens(row.name).some(token => tokens.includes(token))).sort(byName);
  if (sharing.length === 1) return { state: "contradictory", candidate: sharing[0], mencao, provenance: "unresolved" };
  // Tolerant suggestions (typing slips): every mention token close to its own name token; real records only, never bound.
  const close = unique.map(row => ({ row, score: nameScore(tokens, nameTokens(row.name)) })).filter(item => item.score >= SUGGESTION_THRESHOLD - 1e-9)
    .sort((a, b) => b.score - a.score || byName(a.row, b.row)).map(item => item.row);
  const suggestions = [...sharing, ...close.filter(row => !sharing.some(other => other.id === row.id))].slice(0, SUGGESTION_LIMIT);
  return { state: "not_found", suggestions, mencao, provenance: "unresolved" };
}
export async function resolveCustomer(reader: PilotReader, mencao: string): Promise<PilotIdentity> {
  let rows: readonly PilotPerson[];
  try { rows = await reader.customers(mencao); } catch { return { state: "unavailable", mencao, provenance: "unresolved" }; }
  return pilotIdentityOf(rows, mencao);
}

// ---------------------------------------------------------------- day and clock arithmetic (typed operators only)
const pad = (value: number) => String(value).padStart(2, "0");
const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const clockOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
/** A real calendar day (YYYY-MM-DD) or undefined. */
function calendarDay(year: number, month: number, day: number): string | undefined {
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}` : undefined;
}
/** The salon's local day of the frozen received_at. */
export const pilotToday = (clock: PilotClock) => dateKeyInTimeZone(clock.receivedAt, clock.timezone);
/** The salon's local "YYYY-MM-DDTHH:mm" of the frozen received_at. */
export const pilotNowLocal = (clock: PilotClock) => toLocalDateTime(clock.receivedAt, clock.timezone).slice(0, 16);
/** The next day of that number from today on (a month without it is skipped). §11.4: only the "next one that exists" reading of a cited day number
 * (pilotCitedDays); the "data" operator itself reads like the cited reference (pilotDataReadings). */
function nextDayNumbered(dia: number, today: string): string | undefined {
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  for (let step = 0; step < 24; step++) {
    const m = (month - 1 + step) % 12 + 1, y = year + Math.floor((month - 1 + step) / 12), date = calendarDay(y, m, dia);
    if (date && date >= today) return date;
  }
  return undefined;
}
/** "mes_relativo" (review P7): that day of the month `meses` months after today's (0 this month, 1 the next); never another month in its place. */
function relativeMonthDay(dia: number, meses: number, today: string): string | undefined {
  const at = Number(today.slice(5, 7)) - 1 + meses;
  return calendarDay(Number(today.slice(0, 4)) + Math.floor(at / 12), at % 12 + 1, dia);
}
/** E2-A §10.2: the typed weekday as the calendar's own number (weekdayOfDateKey: 0 Sunday … 6 Saturday). A data table over the enum Luna
 * returns, never a reading of the owner's words (the mention is not looked at). */
export const PILOT_WEEKDAY_NUMBER: Readonly<Record<PilotWeekday, number>> = Object.freeze({ domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 });
/** The calendar number of a typed weekday; undefined for anything else (a value the contract would never let through). */
export const pilotWeekdayNumber = (value: unknown): number | undefined =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(PILOT_WEEKDAY_NUMBER, value) ? PILOT_WEEKDAY_NUMBER[value as PilotWeekday] : undefined;
/** The first day of that weekday (0 Sunday … 6 Saturday) strictly after `from`. */
const weekdayAfter = (weekday: number, from: string) => addCalendarDays(from, ((weekday - weekdayOfDateKey(from) + 7) % 7) || 7);
/** The first day of that weekday from `from` on, `from` included. */
const weekdayFrom = (weekday: number, from: string) => addCalendarDays(from, (weekday - weekdayOfDateKey(from) + 7) % 7);

/** §11.1: the days an offset moves (weeks are 7 days). */
const shiftDays = (dia: PilotDayShift) => dia.quantidade * (dia.unidade === "semanas" ? 7 : 1);
const dayIndex = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
/** §11.3 (SEMANTICS-1, CONTRACT-4): the day(s) the reference of a data_citada anchor may name, each a reading of that anchor (calendar facts over the
 * typed reference; the mention is never looked at). A day number with no month names this month's day; once that day has passed, the next one
 * that exists is a reading too (the owner may mean either; never moved forward in silence). With its month: the occurrence nearest to today (the
 * others are a year away; a tie keeps both). A weekday: decision 27's readings (the first after today and the first after the appointment's day;
 * "este" only the first; today too when it is that weekday, unless "proximo"). A day of a relative month: that day (mes_relativo). */
export function pilotCitedDays(cited: PilotCitedDay, origin: { date: string }, today: string): string[] {
  if ("tipo" in cited) {
    if (cited.tipo === "mes_relativo") { const date = relativeMonthDay(cited.dia, cited.meses, today); return date ? [date] : []; }
    const weekday = pilotWeekdayNumber(cited.dia_semana);
    if (weekday === undefined) return [];
    const onToday = cited.qualificador !== "proximo" && weekdayOfDateKey(today) === weekday ? [today] : [];
    const afterOrigin = cited.qualificador === "este" || !isDateKey(origin.date) ? [] : [weekdayAfter(weekday, origin.date)];
    return [...new Set([...onToday, weekdayAfter(weekday, today), ...afterOrigin])].sort();
  }
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  if (cited.mes === null) {
    const current = calendarDay(year, month, cited.dia);
    if (current && current >= today) return [current];
    return [...new Set([current, nextDayNumbered(cited.dia, today)].filter((date): date is string => !!date))].sort();
  }
  const occurrences = [year - 1, year, year + 1].map(y => calendarDay(y, cited.mes!, cited.dia)).filter((date): date is string => !!date);
  if (!occurrences.length) return [];
  const distance = (date: string) => Math.abs(dayIndex(date) - dayIndex(today)), nearest = Math.min(...occurrences.map(distance));
  return occurrences.filter(date => distance(date) === nearest);
}
/** One reading of an offset: its anchor, the day it counts from (`base`; for data_citada, which of the reference's days) and the result. */
export type PilotDayShiftReading = { anchor: PilotDayAnchor; base: string | undefined; date: string | undefined };
/** §11.1: the readings of each anchor the model listed, each a plain fact: origem, the appointment's own day; hoje, the local day of the turn that
 * SAID the offset (`today`); data_citada, each day its reference may name (§11.3, pilotCitedDays). undefined: the reading does not exist (no such
 * date, no reference, or past the bound of a year either way). The anchors are the typed list as given; the mention is never looked at. */
export function pilotDayShiftReadings(dia: PilotDayShift, origin: { date: string }, today: string): PilotDayShiftReading[] {
  const days = shiftDays(dia), within = Number.isInteger(days) && Math.abs(days) <= PILOT_CONTRACT_LIMITS.days;
  const bases = (anchor: PilotDayAnchor): (string | undefined)[] => anchor === "origem" ? [isDateKey(origin.date) ? origin.date : undefined] : anchor === "hoje" ? [today]
    : dia.data_citada ? pilotCitedDays(dia.data_citada, origin, today) : [];
  return [...new Set(dia.ancoras)].flatMap(anchor => {
    const list = bases(anchor);
    return (list.length ? list : [undefined]).map(base => ({ anchor, base, date: within && base ? addCalendarDays(base, days) : undefined }));
  });
}
/** The target day, from the frozen received_at in the salon's timezone. one: explicit for "data" read as said (this month's day, or with its month the
 * nearest occurrence) and a weekday with a single reading; inherited when not said or "mesmo_da_origem"; derived for an offset (§11.1: one anchor,
 * or two whose readings coincide) and, §11.4, for a "data" whose literal reading was left out (already passed, or a day the month lacks: the
 * proposal names it). ask: a weekday whose two readings differ (decision 27: the first after today, the first after the original day), both shown;
 * "este" takes the first reading; an offset whose readings give two or more different days (ANCHOR_TWO_READINGS, each shown); §11.4: an offset with
 * no anchor (ANCHOR_MISSING: never computed from an anchor nobody said) and a day left open (TO_DEFINE: the old day is never kept). Encoded
 * ambiguity A (a fact filter, ratified as §11.3 like decision 18): a reading that cannot be a destination (past, or no such date) is no reading;
 * the proposal names the one left out. invalid: a date that does not exist, or one already past. */
export type PilotDateResolution =
  | { state: "one"; date: string; provenance: "explicit" | "inherited" | "derived"; mencao?: string }
  | { state: "ask"; options: string[]; reason: "TWO_READINGS" | "ANCHOR_TWO_READINGS" | "ANCHOR_MISSING" | "TO_DEFINE"; mencao: string }
  | { state: "invalid"; reason: "NO_SUCH_DATE" | "DATE_PAST"; mencao: string };
/** §11.4 (one general model; replaces the §3.3 rule for a "data" with no month): the days a "data" operator may name are exactly those of the
 * same reference cited as an anchor (pilotCitedDays: a day number with no month, this month's and, once it has passed, the next one that exists;
 * with its month, the occurrence nearest to today). Never a month or a year forward in silence. */
export const pilotDataReadings = (dia: { dia: number; mes: number | null }, today: string) => pilotCitedDays({ dia: dia.dia, mes: dia.mes, mencao: "" }, { date: "" }, today);
/** `target.time` (coordinator decision 4): the destination clock when it is already known without the day's hours (a clock with a period or
 * from 12 on, the original one, the original one plus minutes). A weekday said on that very weekday (no qualifier, or "este") then also reads as
 * today, if that clock is still ahead of received_at; readings that differ are asked (decision 27). An unknown clock adds no today. M6: a day
 * that does not exist or has already passed is invalid (asked, never prepared). Review S2: `clock` is the received_at of the turn that SAID the
 * operator (its "today"); `current`, when given, is this turn's, and only decides whether the day has passed meanwhile (asked, never shifted). */
export function resolveTargetDate(dia: PilotTempoDia | null, origin: { date: string }, clock: PilotClock, target: { time?: string | null } = {}, current?: PilotClock): PilotDateResolution {
  if (!dia) return { state: "one", date: origin.date, provenance: "inherited" };
  const today = pilotToday(clock), now = current ? pilotToday(current) : today, mencao = dia.mencao;
  const checked = (date: string | undefined, provenance: "explicit" | "inherited" | "derived"): PilotDateResolution =>
    !date || !isDateKey(date) ? { state: "invalid", reason: "NO_SUCH_DATE", mencao } : date < today || date < now ? { state: "invalid", reason: "DATE_PAST", mencao } : { state: "one", date, provenance, mencao };
  switch (dia.tipo) {
    case "data": {
      // §11.4: the readings of the same reference as a cited one; those already past are no reading (named in the proposal), two or more are asked.
      const readings = pilotDataReadings(dia, today), valid = [...new Set(readings.filter(date => date >= today && date >= now))].sort();
      if (!readings.length) return { state: "invalid", reason: "NO_SUCH_DATE", mencao };
      if (!valid.length) return { state: "invalid", reason: "DATE_PAST", mencao };
      if (valid.length > 1) return { state: "ask", options: valid, reason: "TWO_READINGS", mencao };
      const literal = readings.length === 1 && (dia.mes !== null || readings[0].slice(0, 7) === today.slice(0, 7));
      return { state: "one", date: valid[0], provenance: literal ? "explicit" : "derived", mencao };
    }
    case "mes_relativo": return checked(relativeMonthDay(dia.dia, dia.meses, today), "explicit");
    case "mesmo_da_origem": return checked(origin.date, "inherited");
    // §11.4: the day left open (or dropped with no new one): asked; the day said before is never kept.
    case "a_definir": return { state: "ask", options: [], reason: "TO_DEFINE", mencao };
    case "deslocamento": {
      // §11.4: an operation whose owner gave no anchor the contract has is asked, never computed from an anchor nobody said.
      if (!dia.ancoras.length) return { state: "ask", options: [], reason: "ANCHOR_MISSING", mencao };
      const readings = pilotDayShiftReadings(dia, origin, today).map(reading => reading.date).filter((date): date is string => !!date && isDateKey(date));
      const valid = [...new Set(readings.filter(date => date >= today && date >= now))].sort();
      if (valid.length === 1) return { state: "one", date: valid[0], provenance: "derived", mencao };
      if (valid.length > 1) return { state: "ask", options: valid, reason: "ANCHOR_TWO_READINGS", mencao };
      return { state: "invalid", reason: readings.length ? "DATE_PAST" : "NO_SUCH_DATE", mencao };
    }
    case "dia_semana": {
      const weekday = pilotWeekdayNumber(dia.dia_semana);
      if (weekday === undefined) return { state: "invalid", reason: "NO_SUCH_DATE", mencao };
      const first = weekdayAfter(weekday, today);
      const ahead = !!target.time && /^\d{2}:\d{2}$/.test(target.time) && `${today}T${target.time}` > pilotNowLocal(clock);
      const onToday = dia.qualificador !== "proximo" && weekdayOfDateKey(today) === weekday && ahead ? [today] : [];
      const afterOrigin = dia.qualificador === "este" || !isDateKey(origin.date) ? [] : [weekdayAfter(weekday, origin.date)];
      const readings = [...new Set([...onToday, first, ...afterOrigin])].sort();
      // §11.11 (R2-TEMPORAL-2, like every other operator): a reading already past on this turn's day is no reading (the one left is derived); none left:
      // the day is asked (DATE_PAST), never a clock refused on a day gone.
      const valid = readings.filter(date => date >= now);
      if (!valid.length) return { state: "invalid", reason: "DATE_PAST", mencao };
      return valid.length === 1 ? { state: "one", date: valid[0], provenance: valid.length < readings.length ? "derived" : "explicit", mencao } : { state: "ask", options: valid, reason: "TWO_READINGS", mencao };
    }
  }
}

/** The target clock "HH:mm". one: explicit for 12-23 or with a period; derived for a bare hour 1-11 whose readings h and h+12 leave ONE inside the
 * professional's (or the salon's) hours that day (decision 18), and for an offset (§11.1: one anchor, or two whose readings coincide; decision 18
 * never re-reads an offset); inherited for "mesmo_da_origem" and when not said on the original day. ask: both readings inside the hours (both
 * shown), "a_definir", not said on a new day (decision 2), or an offset whose anchors give two different clocks (ANCHOR_TWO_READINGS, both shown).
 * none: no reading inside the hours (asked). invalid: an offset with no reading left on that day (it leaves the day, is not ahead of now, or
 * counts from now on another day): asked, never wrapped or moved. */
export type PilotTimeResolution =
  | { state: "one"; time: string; provenance: "explicit" | "inherited" | "derived"; mencao?: string }
  | { state: "ask"; options: string[]; reason: "TWO_READINGS" | "TO_DEFINE" | "NOT_SAID" | "ANCHOR_TWO_READINGS" | "ANCHOR_MISSING"; mencao?: string }
  | { state: "none"; readings: string[]; reason: "NO_READING_IN_HOURS"; mencao: string }
  | { state: "invalid"; reason: "NO_READING"; mencao: string };
/** What a clock offset is read against: the appointment's own day and clock, the destination day, the received_at of the turn that SAID the offset
 * (`clock`, the anchor agora) and this turn's (`current`: only what is still ahead). */
export type PilotClockContext = { origin: { date: string; time: string }; date: string; clock?: PilotClock; current?: PilotClock };
/** Why a clock reading is no reading on the destination day (§11.3, a fact each; the proposal names LEAVES_DAY and NOT_AHEAD): OTHER_DAY, the anchor
 * agora on a day other than its own; NO_BASE, nothing to count from; LEAVES_DAY, the result is outside 00:00-23:59; NOT_AHEAD, it is not ahead of now. */
export type PilotClockShiftReading = { anchor: PilotTimeAnchor; time: string | undefined; dropped?: { reason: "OTHER_DAY" | "NO_BASE" | "LEAVES_DAY" | "NOT_AHEAD"; time?: string } };
/** §11.1: ONE reading per anchor the model listed, on the destination day: origem, the appointment's clock plus the minutes (on any day, as the
 * clock of the appointment); agora, the said turn's local clock plus the minutes, and only on that turn's own local day (encoded ambiguity B, a fact
 * as amended in §11.3: the clock of now never lands on another day). undefined (with why): the reading leaves the day, or is not ahead of now (this
 * turn's, else the said turn's). */
export function pilotClockShiftReadings(hora: PilotClockShift, context: PilotClockContext): PilotClockShiftReading[] {
  const now = context.current ?? context.clock, nowLocal = now ? pilotNowLocal(now) : undefined;
  const from = (anchor: PilotTimeAnchor): number | "OTHER_DAY" | "NO_BASE" => {
    if (anchor === "origem") return /^\d{2}:\d{2}$/.test(context.origin.time) ? minutesOf(context.origin.time) : "NO_BASE";
    if (!context.clock) return "NO_BASE";
    const said = pilotNowLocal(context.clock);
    return said.slice(0, 10) === context.date ? minutesOf(said.slice(11, 16)) : "OTHER_DAY";
  };
  return [...new Set(hora.ancoras)].map((anchor): PilotClockShiftReading => {
    const base = from(anchor);
    if (typeof base !== "number") return { anchor, time: undefined, dropped: { reason: base } };
    const total = base + hora.minutos;
    if (!Number.isInteger(total) || total < 0 || total >= 24 * 60) return { anchor, time: undefined, dropped: { reason: "LEAVES_DAY" } };
    const time = clockOf(total);
    return nowLocal && `${context.date}T${time}` <= nowLocal ? { anchor, time: undefined, dropped: { reason: "NOT_AHEAD", time } } : { anchor, time };
  });
}
/** Encoded ambiguity B (§11.1, ratified as a fact in §11.3): with no day said, a clock offset that may count from now says which day too: its readings
 * are the appointment's own day (anchor origem) and the local day of the turn that SAID it (anchor agora), each only while its clock reading is still
 * ahead there. Two days: asked (ANCHOR_TWO_READINGS; the answer settles the anchor too, secretary-pilot.ts); one: that day (inherited when it is the
 * appointment's own; the orchestrator keeps any other day in the plan, PRINCIPLE-1); none: the said turn's day (its clock is then asked) or, once that
 * day has passed, DATE_PAST. undefined: no anchor agora (a day not said keeps the appointment's, as before). */
export function resolveClockDay(hora: PilotTempoHora | null, origin: { date: string; time: string }, clock: PilotClock, current?: PilotClock): PilotDateResolution | undefined {
  if (!hora || hora.tipo !== "deslocamento" || !hora.ancoras.includes("agora")) return undefined;
  const today = pilotToday(clock), now = current ? pilotToday(current) : today, mencao = hora.mencao;
  const days = [...new Set(hora.ancoras.flatMap(anchor => {
    const date = anchor === "agora" ? today : origin.date;
    const reading = pilotClockShiftReadings({ ...hora, ancoras: [anchor] }, { origin, date, clock, ...(current ? { current } : {}) })[0];
    return reading?.time && isDateKey(date) && date >= now ? [date] : [];
  }))].sort();
  const one = (date: string): PilotDateResolution => ({ state: "one", date, provenance: date === origin.date ? "inherited" : "derived", mencao });
  if (days.length === 1) return one(days[0]);
  if (days.length > 1) return { state: "ask", options: days, reason: "ANCHOR_TWO_READINGS", mencao };
  return today >= now ? one(today) : { state: "invalid", reason: "DATE_PAST", mencao };
}
/** The readings of a clock operator as said: one clock, or both of a bare hour 1-11 (the day's hours choose, decision 18). */
export function pilotClockReadings(hora: Extract<PilotTempoHora, { tipo: "relogio" }>): string[] {
  const h = hora.hora, at = (value: number) => `${pad(value)}:${pad(hora.minuto)}`;
  // M10: a period adds 12 only to 1-11; midnight said with "noite" is 00:00; a period that contradicts the hour ("15 da manhã") is not resolved
  // by the code: both halves, as a bare hour (the day's hours decide, or the owner is asked).
  switch (hora.periodo) {
    case null: return h >= 1 && h <= 11 ? [at(h), at(h + 12)] : [at(h)];
    case "manha": return h <= 12 ? [at(h)] : [at(h - 12), at(h)];
    case "tarde": return h >= 1 && h <= 11 ? [at(h + 12)] : h === 0 ? [at(0), at(12)] : [at(h)];
    case "noite": return h >= 1 && h <= 11 ? [at(h + 12)] : h === 0 || h === 12 ? [at(0)] : [at(h)];
  }
}
export async function resolveTargetTime(reader: PilotReader, hora: PilotTempoHora | null,
  context: { origin: { date: string; time: string }; date: string; professionalId: string | null; clock?: PilotClock; current?: PilotClock }): Promise<PilotTimeResolution> {
  if (!hora) return context.date === context.origin.date ? { state: "one", time: context.origin.time, provenance: "inherited" } : { state: "ask", options: [], reason: "NOT_SAID" };
  const mencao = hora.mencao;
  switch (hora.tipo) {
    case "mesmo_da_origem": return { state: "one", time: context.origin.time, provenance: "inherited", mencao };
    case "a_definir": return { state: "ask", options: [], reason: "TO_DEFINE", mencao };
    case "deslocamento": {
      // §11.4: no anchor said → asked (ANCHOR_MISSING), never computed. §11.1: one reading per listed anchor; decision 18 never applies (the
      // computed clock is not a bare hour), so no hours are read here.
      if (!hora.ancoras.length) return { state: "ask", options: [], reason: "ANCHOR_MISSING", mencao };
      const valid = [...new Set(pilotClockShiftReadings(hora, context).map(reading => reading.time).filter((time): time is string => !!time))].sort();
      if (valid.length === 1) return { state: "one", time: valid[0], provenance: "derived", mencao };
      return valid.length ? { state: "ask", options: valid, reason: "ANCHOR_TWO_READINGS", mencao } : { state: "invalid", reason: "NO_READING", mencao };
    }
    case "relogio": {
      const readings = pilotClockReadings(hora);
      if (readings.length === 1) return { state: "one", time: readings[0], provenance: "explicit", mencao };
      let windows: readonly PilotWindow[];
      // An unreadable day never picks a reading: both are asked.
      try { windows = await reader.workingWindows(context.professionalId, context.date); } catch { return { state: "ask", options: readings, reason: "TWO_READINGS", mencao }; }
      const inside = readings.filter(reading => windows.some(window => window.start <= minutesOf(reading) && minutesOf(reading) < window.end));
      if (inside.length === 1) return { state: "one", time: inside[0], provenance: "derived", mencao };
      return inside.length ? { state: "ask", options: inside, reason: "TWO_READINGS", mencao } : { state: "none", readings, reason: "NO_READING_IN_HOURS", mencao };
    }
  }
}

// ---------------------------------------------------------------- the appointment, located once
export type PilotHint = "dia" | "hora" | "profissional" | "servico" | "posicao";
/** Over the customer's future appointments (from received_at, PENDING or CONFIRMED), filtered by the origin hints: day and clock through the
 * normalizer, professional by its mention, service by the ids of the catalog names Luna gave (E2-A §10.3; every service of the appointment's items,
 * review SERVICE-1), position in the day. one: bound (derived, shown in the proposal); none: asked, showing her next appointments (also when the
 * service contradicts what the other hints point at); several: asked with the real options. `ignored`: hints with a mention absent from the
 * message, never used to choose. Review PRINCIPLE-1: a service hint whose names are none of the salon's (an empty list included) is Luna saying
 * the owner's words fit no service of the salon: with its mention proven it matches no appointment (asked, never the only one bound in silence);
 * unproven, it is ignored like any hint. */
export type PilotAppointmentResolution =
  | { state: "one"; appointment: PilotAppointmentRow; provenance: "derived"; used: PilotHint[]; ignored: PilotHint[]; skippedDependents?: number }
  | { state: "none"; upcoming: PilotAppointmentRow[]; provenance: "unresolved"; used: PilotHint[]; ignored: PilotHint[]; skippedDependents?: number }
  | { state: "several"; options: PilotAppointmentRow[]; provenance: "unresolved"; used: PilotHint[]; ignored: PilotHint[]; skippedDependents?: number }
  | { state: "unavailable"; provenance: "unresolved" };
/** The local days an origin day operator names among the candidates' days (a weekday: every such day ahead; "este": the first one). Operators
 * relative to an origin say nothing about the origin itself: no filter. §11.1: an offset filters by every reading of its anchors (hoje, data_citada),
 * so two readings keep both days (2+ appointments left are asked, never one picked); an anchor origem counts from the very appointment it would
 * locate, so it gives no reading: alone, no filter; beside another anchor, the other anchor's readings filter (§11.3, RESOLVER-5). */
function originDays(dia: PilotTempoDia, clock: PilotClock): ((date: string) => boolean) | undefined {
  const today = pilotToday(clock);
  switch (dia.tipo) {
    // §11.4: a day said outright names the days of the same reference cited as an anchor (every one of them filters; 2+ appointments left are asked).
    case "data": { const dates = new Set(pilotDataReadings(dia, today)); return day => dates.has(day); }
    case "mes_relativo": { const date = relativeMonthDay(dia.dia, dia.meses, today); return day => day === date; }
    case "deslocamento": {
      const others = dia.ancoras.filter(anchor => anchor !== "origem");
      if (!others.length) return undefined;
      const dates = new Set(pilotDayShiftReadings({ ...dia, ancoras: others }, { date: "" }, today).map(reading => reading.date).filter((date): date is string => !!date));
      return day => dates.has(day);
    }
    case "dia_semana": {
      const weekday = pilotWeekdayNumber(dia.dia_semana);
      // A value outside the table matches no appointment (asked, never ignored in silence).
      if (weekday === undefined) return () => false;
      // C4: an origin said "este" is the first such day from today on, today included (an appointment later today is "this" one).
      if (dia.qualificador === "este") { const date = weekdayFrom(weekday, today); return day => day === date; }
      return day => weekdayOfDateKey(day) === weekday;
    }
    default: return undefined;
  }
}
/** A clock said for the origin: "relogio" filters by its readings; an offset never does (from the origin itself it says nothing about it, and a
 * clock counted from now is no exact start of a booked appointment): such a hint never chooses, the appointments it would leave are asked. */
function originClock(hora: PilotTempoHora): ((clock: string) => boolean) | undefined {
  if (hora.tipo !== "relogio") return undefined;
  const readings = pilotClockReadings(hora);
  return clock => readings.includes(clock);
}
const byStart = (a: PilotAppointmentRow, b: PilotAppointmentRow) => a.startLocal.localeCompare(b.startLocal) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** E2-A §10.3: a catalog name as compared, name against name: case and accents folded (runs of white space one space). Never a part of a name,
 * a word of it or a similar spelling: equality only. */
export const pilotCatalogKey = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
/** The ids of the salon's services named EXACTLY (pilotCatalogKey) by the given names; a name the catalog does not have is dropped. */
export function pilotCatalogIds(catalog: readonly Pick<PilotServiceRow, "id" | "name">[], names: readonly string[]): Set<string> {
  const wanted = new Set(names.filter(name => typeof name === "string").map(pilotCatalogKey).filter(Boolean));
  return new Set(catalog.filter(row => typeof row?.name === "string" && wanted.has(pilotCatalogKey(row.name))).map(row => row.id));
}
/** `message`: the owner's message the hints are proved against. Review P1: `proven` instead, when the hints came from several messages: whether each
 * hint's mention was in the very message that brought it (proved once, on arrival; a hint absent from it never chooses). Review S2: `anchor`, the
 * received_at of the turn that said the origin day (its "today"); `clock` stays this turn's (what is still ahead). `catalog`: the salon's
 * services the turn already read (else read here), the only names a service hint may use. E2-A review FLOW-1: `among`, the appointment ids a
 * question offered: the hints (the answer's own) choose only among those still ahead (a none lists them); when none of them is ahead any more,
 * her appointments are listed as none (asked again, never bound). */
export async function resolveAppointment(reader: PilotReader, input: { customerId: string; origem: PilotOrigin; message?: string; proven?: Partial<Record<PilotHint, boolean>>;
  anchor?: PilotClock; catalog?: readonly PilotServiceRow[]; among?: readonly string[] }, clock: PilotClock): Promise<PilotAppointmentResolution> {
  const now = pilotNowLocal(clock);
  let rows: readonly PilotAppointmentRow[], services: Set<string> | undefined;
  try {
    rows = await reader.appointmentsOf(input.customerId, now);
    if (input.origem.servico) services = pilotCatalogIds(input.catalog ?? await reader.catalog(), input.origem.servico.catalogo);
  } catch { return { state: "unavailable", provenance: "unresolved" }; }
  const ahead = rows.filter(row => row.customerId === input.customerId && (row.status === "PENDING" || row.status === "CONFIRMED") && row.startLocal.slice(0, 16) > now).sort(byStart);
  // M11: a dependent's appointment is never located from the customer's own mention (the agenda does not move it here either).
  const future = ahead.filter(row => !row.dependentName), skippedDependents = ahead.length - future.length;
  const skipped = skippedDependents ? { skippedDependents } : {};
  const among = input.among ? new Set(input.among) : undefined, pool = among ? future.filter(row => among.has(row.id)) : future;
  if (among && !pool.length) return { state: "none", upcoming: future, provenance: "unresolved", used: [], ignored: [], ...skipped };
  const origem = input.origem, used: PilotHint[] = [], ignored: PilotHint[] = [];
  const hints: { hint: PilotHint; mencao: string | null; test?: (row: PilotAppointmentRow) => boolean }[] = [];
  const proven = (hint: PilotHint, mencao: string | null) => input.proven ? input.proven[hint] === true : pilotMentionIn(input.message ?? "", mencao);
  if (origem.dia) { const test = originDays(origem.dia, input.anchor ?? clock); hints.push({ hint: "dia", mencao: origem.dia.mencao, test: test && (row => test(row.startLocal.slice(0, 10))) }); }
  if (origem.hora) { const test = originClock(origem.hora); hints.push({ hint: "hora", mencao: origem.hora.mencao, test: test && (row => test(row.startLocal.slice(11, 16))) }); }
  if (origem.profissional_mencao) { const tokens = tokensOf(origem.profissional_mencao); hints.push({ hint: "profissional", mencao: origem.profissional_mencao, test: row => !!tokens.length && holds(row.professionalName, tokens) }); }
  // E2-A §10.3: the service by the ids of the catalog names Luna gave (no token of a name compared), against every service of the appointment
  // (review SERVICE-1). Review PRINCIPLE-1: no name of the salon's matches no appointment (proven: asked; unproven: ignored, below).
  if (origem.servico) { const ids = services ?? new Set<string>(); hints.push({ hint: "servico", mencao: origem.servico.mencao, test: row => pilotServicesOf(row).some(id => ids.has(id)) }); }
  let left = pool;
  for (const { hint, mencao, test } of hints) {
    if (!test) continue;
    // §0 narrow provenance: a hint whose words are not in the message is the model's, never the owner's: it never chooses.
    if (!proven(hint, mencao)) { ignored.push(hint); continue; }
    left = left.filter(test); used.push(hint);
  }
  // Position in the day: first or last by start, only among appointments of ONE day (the day said, or the only one left), and only with the
  // owner's own words for it (C3: the narrow provenance check of every hint; an unproven position never narrows 2 or more rows).
  if (origem.posicao && left.length > 1) {
    if (!proven("posicao", origem.posicao.mencao)) ignored.push("posicao");
    else if (new Set(left.map(row => row.startLocal.slice(0, 10))).size === 1) { left = [origem.posicao.valor === "primeiro" ? left[0] : left[left.length - 1]]; used.push("posicao"); }
  }
  if (left.length === 1) return { state: "one", appointment: left[0], provenance: "derived", used, ignored, ...skipped };
  if (!left.length) return { state: "none", upcoming: pool, provenance: "unresolved", used, ignored, ...skipped };
  return { state: "several", options: left, provenance: "unresolved", used, ignored, ...skipped };
}

// ---------------------------------------------------------------- the professional
/** kept: not said or "manter" (the current professional, inherited); the identity states for "nomeado" (explicit when bound); chosen: "qualquer" or
 * "outro" (decision 15 as amended by §11.2: performs the service and is free for its whole duration at the slot, the appointment being moved aside;
 * the current professional leaves for "outro", or when the slot is the origin's own day and clock, a fact; §11.3/§11.4: the members the exclusion
 * list names leave too; the ONE member with the fewest appointments that day, with no preference for the current one; derived, shown); tie (§11.4,
 * decision 15 with no rule left): two or more free members share the fewest appointments, asked with them (never the name order); nobody_free:
 * asked; waiting: a delegated mode before the day and the clock are resolved. */
export type PilotProfessionalResolution =
  | { state: "kept"; id: string; name: string; provenance: "inherited" }
  | PilotIdentity
  | { state: "chosen"; id: string; name: string; provenance: "derived" }
  /** `options`: the tied members, by name (an order to show them in, never a choice). */
  | { state: "tie"; options: PilotPerson[]; provenance: "unresolved" }
  /** `excluded` (§11.3/§11.4): the members the exclusions left out by name (the current one too, when an exclusion named her), when there are any. */
  | { state: "nobody_free"; provenance: "unresolved"; excluded?: PilotPerson[] }
  | { state: "waiting"; provenance: "unresolved" }
  /** M9: words beside "manter"/"qualquer" naming ONE member of the team the mode would not give: asked, never ignored. */
  | { state: "conflict"; mode: "manter" | "qualquer"; named: PilotPerson; mencao: string; provenance: "unresolved" }
  /** §11.4: an exclusion that names no member for sure (contradictory, or not found): asked with that mention, never ignored nor offered as who attends. */
  | (Extract<PilotIdentity, { state: "contradictory" | "not_found" }> & { excluding: true });
/** §11.4: who must not attend, as the model typed it: each name of `excluidos` (with "qualquer" or "outro") and, for "outro", its mencao (the role
 * §11.3 gave it, kept for a state saved before the list). A value from before the list (no `excluidos`): none of its own. */
export const pilotExclusionMentions = (profissional: { modo: string | null; mencao: string | null; excluidos?: readonly string[] }): string[] => {
  if (profissional.modo !== "qualquer" && profissional.modo !== "outro") return [];
  return [...(profissional.modo === "outro" && profissional.mencao ? [profissional.mencao] : []), ...(Array.isArray(profissional.excluidos) ? profissional.excluidos : [])];
};
/** The destination professional as said: the contract's, or (§11.4) a value saved before the exclusion list (no `excluidos`: none of its own). */
export type PilotProfessionalSaid = Omit<PilotDestination["profissional"], "excluidos"> & { excluidos?: readonly string[] };
/** §11.11: exclusions said earlier in the plan that the value does not carry itself (typed names, words beside "outro", the current professional): a
 * delegated value applies them exactly as its own; any other value never reads them. */
export type PilotHeldExclusionsSaid = { outro?: boolean; excluidos?: readonly string[]; words?: readonly string[] };
/** `origin` (§11.2): the appointment's own day and clock, so the resolver sees the fact that the slot is the origin's own. §11.11: `serviceIds`, every
 * service the appointment holds (who attends performs each of them; exact ids); `held`, the exclusions held aside. */
export async function resolveProfessional(reader: PilotReader, profissional: PilotProfessionalSaid,
  context: { current: PilotPerson; appointmentId: string; serviceId: string; serviceIds?: readonly string[]; durationMin: number; slot: { date: string; time: string } | null;
    origin?: { date: string; time: string }; held?: PilotHeldExclusionsSaid }): Promise<PilotProfessionalResolution> {
  const mode = profissional.modo ?? (profissional.mencao ? "nomeado" : null), held = mode === "qualquer" || mode === "outro" ? context.held : undefined;
  const exclusions = [...pilotExclusionMentions(profissional), ...(held?.excluidos ?? []), ...(held?.words ?? [])], withoutCurrent = mode === "outro" || !!held?.outro;
  // M9: words beside "manter"/"qualquer" that name nobody of the team are the owner's way of saying the mode itself and change nothing; another
  // member's name there is asked like any conflict. §11.3/§11.4 (PRINCIPLE-3): an exclusion (excluidos, and "outro"'s mencao) is who must NOT attend:
  // each is checked against the real team by its normalized mention (the identity states, never grammar): the member it names leaves the candidates
  // (an ambiguous name leaves every member it fits; never a conflict that offers them); one that names no member for sure is asked, never ignored.
  // A mencao of "outro" related to no member at all (not found, no suggestion) stays M9's: the mode's own words.
  const left = new Map<string, PilotPerson>(), said = profissional.mencao;
  const conflictable = (mode === "manter" || mode === "qualquer") && !!said;
  if (conflictable || exclusions.length) {
    let team: PilotPerson[];
    try { team = (await reader.team()).map(person); } catch { return { state: "unavailable", mencao: said ?? exclusions[0] ?? "", provenance: "unresolved" }; }
    // Round 2 (§11.10, R1-PROFESSIONAL-3): the exclusions are resolved FIRST, so a member an exclusion leaves out is never the conflict's option (a question
    // that would make her the one who attends): words beside "qualquer" naming an excluded member stay the mode's own words (M9).
    const typed = new Set([...(Array.isArray(profissional.excluidos) ? profissional.excluidos : []), ...(held?.excluidos ?? [])]);
    for (const mencao of exclusions) {
      const named = pilotIdentityOf(team, mencao);
      if (named.state === "exact" || named.state === "partial") left.set(named.id, { id: named.id, name: named.name });
      else if (named.state === "ambiguous") for (const option of named.options) left.set(option.id, option);
      else if (named.state === "contradictory" || (named.state === "not_found" && (typed.has(mencao) || named.suggestions.length))) return { ...named, excluding: true };
    }
    // §11.11: the current professional held out ("outro" kept beside words of "qualquer") is never the conflict's option either.
    if (conflictable && said && (mode === "manter" || mode === "qualquer")) {
      const named = pilotIdentityOf(team, said);
      if ((named.state === "exact" || named.state === "partial") && !left.has(named.id) && !(withoutCurrent && named.id === context.current.id)
        && (mode === "qualquer" || named.id !== context.current.id))
        return { state: "conflict", mode, named: { id: named.id, name: named.name }, mencao: said, provenance: "unresolved" };
    }
  }
  if (mode === null || mode === "manter") return { state: "kept", id: context.current.id, name: context.current.name, provenance: "inherited" };
  if (mode === "nomeado") {
    const mencao = said ?? "";
    let team: readonly PilotProfessionalRow[];
    try { team = await reader.team(); } catch { return { state: "unavailable", mencao, provenance: "unresolved" }; }
    return pilotIdentityOf(team.map(person), mencao);
  }
  if (!context.slot) return { state: "waiting", provenance: "unresolved" };
  const { date, time } = context.slot, start = minutesOf(time), end = start + context.durationMin;
  // §11.2: the current professional is no candidate for "outro", nor at the origin's own day and clock (choosing it would change nothing); §11.3/
  // §11.4: nor the member(s) the exclusions named.
  const excluded = new Set([...(withoutCurrent || (context.origin?.date === date && context.origin?.time === time) ? [context.current.id] : []), ...left.keys()]);
  const local = (value: string) => value.slice(0, 10) < date ? 0 : value.slice(0, 10) > date ? 24 * 60 : minutesOf(value.slice(11, 16));
  // §11.11 (R2-PROFESSIONAL-4): a candidate performs every service the appointment holds (exact ids; its first one when none is listed).
  const services = context.serviceIds?.length ? context.serviceIds : [context.serviceId];
  try {
    const team = await reader.team(), free: { row: PilotProfessionalRow; count: number }[] = [];
    for (const row of team.filter(item => services.every(id => item.serviceIds.includes(id)) && !excluded.has(item.id))) {
      const [windows, busy] = await Promise.all([reader.workingWindows(row.id, date), reader.busy(row.id, date)]);
      if (!windows.some(window => window.start <= start && end <= window.end)) continue;
      const others = busy.filter(item => item.appointmentId !== context.appointmentId);
      if (others.some(item => local(item.startLocal) < end && start < local(item.endLocal))) continue;
      free.push({ row, count: others.filter(item => item.appointmentId !== null).length });
    }
    // Who the exclusions named (the current one too when named: "qualquer" may exclude her), said in the question.
    const named = [...left.values()].sort(byName);
    if (!free.length) return { state: "nobody_free", provenance: "unresolved", ...(named.length ? { excluded: named } : {}) };
    // Decision 15: the fewest appointments that day; §11.2: no preference for the current professional; §11.4: when more than one member is left with
    // the fewest, the product rule does not decide: asked with them (never the name order).
    const least = Math.min(...free.map(item => item.count));
    const fewest = [...new Map(free.filter(item => item.count === least).map(item => [item.row.id, person(item.row)])).values()].sort(byName);
    if (fewest.length > 1) return { state: "tie", options: fewest, provenance: "unresolved" };
    return { state: "chosen", id: fewest[0].id, name: fewest[0].name, provenance: "derived" };
  } catch { return { state: "unavailable", mencao: said ?? "", provenance: "unresolved" }; }
}
