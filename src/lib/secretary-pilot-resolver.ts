import type { PilotDestination, PilotOrigin, PilotTempoDia, PilotTempoHora, PilotWeekday } from "../../packages/salon-secretary/src/pilot-reschedule-contract";
import { nameScore, nameTokens, SUGGESTION_LIMIT, SUGGESTION_THRESHOLD } from "./name-search";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, toLocalDateTime, weekdayOfDateKey } from "./time";

/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE, default off; docs/c5-spike/12-piloto-remarcacao.md §0, §3): the deterministic
 * resolver after Luna. It never re-reads the owner's Portuguese: it normalizes the MENTIONS Luna extracted (lower case, no accents, the name
 * particles of the existing nameTokens) to find real records of the session's salon, computes days and clocks from the typed operators and the
 * frozen received_at in the salon's timezone, detects real ambiguity (2+ records, two valid readings in the data) and locates the appointment
 * once. The owner's message is used for one thing only, the narrow provenance check: a hint may choose among 2+ real appointments only when its
 * mention appears in the message (normalized search); otherwise it is ignored and the Secretária asks. That check never drops the action nor
 * changes a value. No word lists, no case or punctuation as evidence. Pure functions over an injected, tenant-scoped reader. */
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
/** "data": no month, the next day of that number from today on (a month without it is skipped); a month, that day this year or the next. */
function dataDay(dia: number, mes: number | null, today: string): string | undefined {
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  if (mes === null) {
    for (let step = 0; step < 24; step++) {
      const m = (month - 1 + step) % 12 + 1, y = year + Math.floor((month - 1 + step) / 12), date = calendarDay(y, m, dia);
      if (date && date >= today) return date;
    }
    return undefined;
  }
  for (const y of [year, year + 1]) { const date = calendarDay(y, mes, dia); if (date && date >= today) return date; }
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

/** The target day, from the frozen received_at in the salon's timezone. one: explicit for "data" (no month: the next occurrence from today on),
 * "relativo_hoje" and a weekday with a single reading; inherited when not said or "mesmo_da_origem"; derived for "origem_mais_dias". ask: a weekday
 * whose two readings differ (decision 27: the first after today, the first after the original day), both shown; "este" takes the first reading.
 * invalid: a date that does not exist. */
export type PilotDateResolution =
  | { state: "one"; date: string; provenance: "explicit" | "inherited" | "derived"; mencao?: string }
  | { state: "ask"; options: string[]; reason: "TWO_READINGS"; mencao: string }
  | { state: "invalid"; reason: "NO_SUCH_DATE" | "DATE_PAST"; mencao: string };
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
    case "data": return checked(dataDay(dia.dia, dia.mes, today), "explicit");
    case "mes_relativo": return checked(relativeMonthDay(dia.dia, dia.meses, today), "explicit");
    case "relativo_hoje": return checked(addCalendarDays(today, dia.dias), "explicit");
    case "mesmo_da_origem": return checked(origin.date, "inherited");
    case "origem_mais_dias": return checked(isDateKey(origin.date) ? addCalendarDays(origin.date, dia.dias) : undefined, "derived");
    case "dia_semana": {
      const weekday = pilotWeekdayNumber(dia.dia_semana);
      if (weekday === undefined) return { state: "invalid", reason: "NO_SUCH_DATE", mencao };
      const first = weekdayAfter(weekday, today);
      const ahead = !!target.time && /^\d{2}:\d{2}$/.test(target.time) && `${today}T${target.time}` > pilotNowLocal(clock);
      const onToday = dia.qualificador !== "proximo" && weekdayOfDateKey(today) === weekday && ahead ? [today] : [];
      const afterOrigin = dia.qualificador === "este" || !isDateKey(origin.date) ? [] : [weekdayAfter(weekday, origin.date)];
      const readings = [...new Set([...onToday, first, ...afterOrigin])].sort();
      return readings.length === 1 ? { state: "one", date: readings[0], provenance: "explicit", mencao } : { state: "ask", options: readings, reason: "TWO_READINGS", mencao };
    }
  }
}

/** The target clock "HH:mm". one: explicit for 12-23 or with a period; derived for a bare hour 1-11 whose readings h and h+12 leave ONE inside the
 * professional's (or the salon's) hours that day (decision 18), and for "origem_mais_minutos"; inherited for "mesmo_da_origem" and when not said on
 * the original day. ask: both readings inside the hours (both shown), "a_definir", or not said on a new day (decision 2). none: no reading inside
 * the hours (asked). */
export type PilotTimeResolution =
  | { state: "one"; time: string; provenance: "explicit" | "inherited" | "derived"; mencao?: string }
  | { state: "ask"; options: string[]; reason: "TWO_READINGS" | "TO_DEFINE" | "NOT_SAID"; mencao?: string }
  | { state: "none"; readings: string[]; reason: "NO_READING_IN_HOURS"; mencao: string };
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
  context: { origin: { date: string; time: string }; date: string; professionalId: string | null }): Promise<PilotTimeResolution> {
  if (!hora) return context.date === context.origin.date ? { state: "one", time: context.origin.time, provenance: "inherited" } : { state: "ask", options: [], reason: "NOT_SAID" };
  const mencao = hora.mencao;
  switch (hora.tipo) {
    case "mesmo_da_origem": return { state: "one", time: context.origin.time, provenance: "inherited", mencao };
    case "a_definir": return { state: "ask", options: [], reason: "TO_DEFINE", mencao };
    case "origem_mais_minutos": {
      const minutes = minutesOf(context.origin.time) + hora.minutos;
      return minutes >= 0 && minutes < 24 * 60 ? { state: "one", time: clockOf(minutes), provenance: "derived", mencao } : { state: "ask", options: [], reason: "TO_DEFINE", mencao };
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
 * relative to an origin say nothing about the origin itself: no filter. */
function originDays(dia: PilotTempoDia, clock: PilotClock): ((date: string) => boolean) | undefined {
  const today = pilotToday(clock);
  switch (dia.tipo) {
    case "data": { const date = dataDay(dia.dia, dia.mes, today); return day => day === date; }
    case "mes_relativo": { const date = relativeMonthDay(dia.dia, dia.meses, today); return day => day === date; }
    case "relativo_hoje": { const date = addCalendarDays(today, dia.dias); return day => day === date; }
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
/** kept: not said or "manter" (the current professional, inherited); the identity states for "nomeado" (explicit when bound); chosen: "qualquer"
 * (decision 15: performs the service and is free for its whole duration at the slot, the appointment being moved aside; the fewest appointments
 * that day; derived, shown); nobody_free: asked; waiting: "qualquer" before the day and the clock are resolved. */
export type PilotProfessionalResolution =
  | { state: "kept"; id: string; name: string; provenance: "inherited" }
  | PilotIdentity
  | { state: "chosen"; id: string; name: string; provenance: "derived" }
  | { state: "nobody_free"; provenance: "unresolved" }
  | { state: "waiting"; provenance: "unresolved" }
  /** M9: words beside "manter"/"qualquer" naming ONE member of the team the mode would not give: asked, never ignored. */
  | { state: "conflict"; mode: "manter" | "qualquer"; named: PilotPerson; mencao: string; provenance: "unresolved" };
export async function resolveProfessional(reader: PilotReader, profissional: PilotDestination["profissional"],
  context: { current: PilotPerson; appointmentId: string; serviceId: string; durationMin: number; slot: { date: string; time: string } | null }): Promise<PilotProfessionalResolution> {
  const mode = profissional.modo ?? (profissional.mencao ? "nomeado" : null);
  // M9: words that name nobody of the team are the owner's way of saying the mode itself and change nothing.
  if ((mode === "manter" || mode === "qualquer") && profissional.mencao) {
    let named: PilotIdentity;
    try { named = pilotIdentityOf((await reader.team()).map(person), profissional.mencao); } catch { return { state: "unavailable", mencao: profissional.mencao, provenance: "unresolved" }; }
    if ((named.state === "exact" || named.state === "partial") && (mode === "qualquer" || named.id !== context.current.id))
      return { state: "conflict", mode, named: { id: named.id, name: named.name }, mencao: profissional.mencao, provenance: "unresolved" };
  }
  if (mode === null || mode === "manter") return { state: "kept", id: context.current.id, name: context.current.name, provenance: "inherited" };
  if (mode === "nomeado") {
    const mencao = profissional.mencao ?? "";
    let team: readonly PilotProfessionalRow[];
    try { team = await reader.team(); } catch { return { state: "unavailable", mencao, provenance: "unresolved" }; }
    return pilotIdentityOf(team.map(person), mencao);
  }
  if (!context.slot) return { state: "waiting", provenance: "unresolved" };
  const { date, time } = context.slot, start = minutesOf(time), end = start + context.durationMin;
  const local = (value: string) => value.slice(0, 10) < date ? 0 : value.slice(0, 10) > date ? 24 * 60 : minutesOf(value.slice(11, 16));
  try {
    const team = await reader.team(), free: { row: PilotProfessionalRow; count: number }[] = [];
    for (const row of team.filter(item => item.serviceIds.includes(context.serviceId))) {
      const [windows, busy] = await Promise.all([reader.workingWindows(row.id, date), reader.busy(row.id, date)]);
      if (!windows.some(window => window.start <= start && end <= window.end)) continue;
      const others = busy.filter(item => item.appointmentId !== context.appointmentId);
      if (others.some(item => local(item.startLocal) < end && start < local(item.endLocal))) continue;
      free.push({ row, count: others.filter(item => item.appointmentId !== null).length });
    }
    if (!free.length) return { state: "nobody_free", provenance: "unresolved" };
    // Fewest appointments that day; a tie keeps the current professional, then the name order (deterministic).
    free.sort((a, b) => a.count - b.count || Number(b.row.id === context.current.id) - Number(a.row.id === context.current.id) || byName(a.row, b.row));
    return { state: "chosen", id: free[0].row.id, name: free[0].row.name, provenance: "derived" };
  } catch { return { state: "unavailable", mencao: profissional.mencao ?? "", provenance: "unresolved" }; }
}
