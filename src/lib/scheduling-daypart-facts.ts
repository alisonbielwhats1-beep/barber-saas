import { withTenant, type Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import type { SchedulingFields } from "./scheduling-contract";
import { unionIntervals } from "./intervals";
import { getSchedulingAppointment, getSchedulingAvailability, listSchedulingProfessionals, listSchedulingServices, schedulingTimezone } from "./scheduling-catalog";
import { locateSchedulingAppointments } from "./scheduling-mutations";
import { searchSalonCustomer } from "./customer-catalog";
import { coherentIntervalReadings } from "./scheduling-temporal-reference";
import { dateKeyInTimeZone, endExclusiveOfDateInTimeZone, startOfDateInTimeZone, wallClockMinutesInTimeZone, weekdayOfDateKey } from "./time";
import { formatClock, formatDay } from "./secretary-datetime-format";

/** Candidate 4, C2 (flag SALON_SECRETARY_DAYPART_BY_HOURS, default off; backlog §0): the two readings of a bare hour 1-7 ("pras 2"
 * = 02h or 14h) are filtered by the TENANT's real, hard facts for that day and professional, never by a fixed table:
 * WorkingHours ∪ ProfessionalOpening (the booking engine's own union), SalonClosure, TimeOff and the past minute. Occupancy never
 * eliminates a reading (a taken slot is the normal review). Exactly one reading left is used and said; two keep today's question;
 * none is said as unavailable, with real alternatives, and never becomes "the least impossible". Unknown facts (no hours
 * configured in the salon, a failing read, homonym customers, an incomplete professional list) keep today's question.
 * Read-only, tenant-scoped, codes-only evidence; nothing is written without the owner's Confirmar. */
export const daypartByHoursEnabled = () => process.env.SALON_SECRETARY_DAYPART_BY_HOURS === "true";

type Span = { start: number; end: number };
/** One professional's day, local minutes [start, end). */
export type StaffDay = { id: string; work: Span[]; off: Span[] };
/** One day's hard facts. `now`: -1 for a future day, the current local minute today, 1440 for a past day. */
export type DayFacts = { staff: StaffDay[]; closures: Span[]; now: number };
/** BOOK: a create's time or a move's destination (start and start+duration inside ONE working interval, no closure, no TimeOff,
 * not past). BLOCK_START/BLOCK_END: a block's edges (inside the working hours; only closures eliminate, never TimeOff, which a
 * block may cover). LOCATE: an existing appointment's own clock (a cancel's time, a move's origin): only the past eliminates it,
 * because an appointment may lawfully sit outside today's hours (an authorized override, hours changed after booking). */
export type DaypartPurpose = "BOOK" | "BLOCK_START" | "BLOCK_END" | "LOCATE";
export type ReadingCause = "PAST" | "SALON_CLOSED" | "OUTSIDE" | "DURATION" | "OFF" | "INTERVAL";
export type OpenReadings = { open: string[]; closed: { time: string; cause: ReadingCause }[] };
export type DaypartField = "time" | "source_time" | "end_time";

const minuteOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const overlaps = (spans: readonly Span[], a: number, b: number) => spans.some(span => span.start < b && span.end > a);
/** The cause said for a reading nobody can take: the one closest to possible among the professionals considered. */
const causeOrder: readonly ReadingCause[] = ["INTERVAL", "PAST", "SALON_CLOSED", "OUTSIDE", "DURATION", "OFF"];

/** Why a reading (local minute) cannot serve the purpose for one professional (undefined: possible). */
function blocker(r: number, purpose: DaypartPurpose, staff: StaffDay | undefined, facts: DayFacts, duration?: number): ReadingCause | undefined {
  if (r <= facts.now) return "PAST";
  if (purpose === "LOCATE") return;
  const length = purpose === "BOOK" ? Math.max(1, duration ?? 1) : 1, [a, b] = purpose === "BLOCK_END" ? [r - 1, r] : [r, r + length];
  if (overlaps(facts.closures, a, b)) return "SALON_CLOSED";
  const hosts = staff?.work.filter(w => purpose === "BLOCK_END" ? w.start < r && r <= w.end : w.start <= r && r < w.end) ?? [];
  if (!hosts.length) return "OUTSIDE";
  if (purpose !== "BOOK") return;
  // The whole service inside the SAME working interval: a break or the end of the day is never crossed.
  if (!hosts.some(w => r + length <= w.end)) return "DURATION";
  return overlaps(staff!.off, a, b) ? "OFF" : undefined;
}
/** Pure core: which of the owner's readings the facts leave possible for the purpose. A reading is open when at least one of the
 * professionals considered can take it (a unique professional, or the envelope of the eligible ones; never a pick). `other`: the
 * other edge of a single-day block (an end is after its start). `excluded`: readings the owner excluded, subtracted first. */
export function openReadings(candidates: readonly string[], purpose: DaypartPurpose, facts: DayFacts,
  options: { duration?: number; other?: string; excluded?: ReadonlySet<string> } = {}): OpenReadings {
  const out: OpenReadings = { open: [], closed: [] };
  for (const time of candidates) {
    if (options.excluded?.has(time)) continue;
    const r = minuteOf(time), other = options.other === undefined ? undefined : minuteOf(options.other);
    const reversed = other !== undefined && (purpose === "BLOCK_START" ? r >= other : purpose === "BLOCK_END" && r <= other);
    const causes = purpose !== "LOCATE" && facts.staff.length ? facts.staff.map(staff => blocker(r, purpose, staff, facts, options.duration)) : [blocker(r, purpose, undefined, facts, options.duration)];
    // The facts' own cause is said first; a reading the facts allow but the other edge contradicts is INTERVAL.
    if (causes.includes(undefined)) { if (reversed) out.closed.push({ time, cause: "INTERVAL" }); else out.open.push(time); }
    else out.closed.push({ time, cause: causeOrder[Math.max(...causes.map(cause => causeOrder.indexOf(cause!)))] });
  }
  return out;
}
/** A single-day block whose two edges are both open questions: the coherent (start, end) pairs ONE professional can hold. */
export function openBlockPairs(starts: readonly string[], ends: readonly string[], facts: DayFacts): [string, string][] {
  return coherentIntervalReadings(starts, ends).filter(([a, b]) =>
    facts.staff.some(staff => !blocker(minuteOf(a), "BLOCK_START", staff, facts) && !blocker(minuteOf(b), "BLOCK_END", staff, facts)));
}

const phrase = (cause: ReadingCause, who: string | undefined, plural: boolean) => ({
  PAST: plural ? "já passaram" : "já passou", SALON_CLOSED: "o salão está fechado", OUTSIDE: who ? `${who} não atende` : "nenhum profissional atende",
  DURATION: who ? `o serviço não cabe no expediente de ${who}` : "o serviço não cabe no expediente", OFF: who ? `${who} está indisponível` : "os profissionais estão indisponíveis",
  INTERVAL: "o fim ficaria antes do início" }[cause]);
/** "às 2h Jade Moura não atende; às 14h o salão está fechado" (clocks and causes only; the name is the registered one). */
export function closedReadingsText(closed: OpenReadings["closed"], who?: string) {
  const causes = [...new Set(closed.map(item => item.cause))];
  return causes.map(cause => { const times = closed.filter(item => item.cause === cause).map(item => `às ${formatClock(item.time)}`);
    return `${times.join(" e ")} ${phrase(cause, who, times.length > 1)}`; }).join("; ");
}
/** The whole day is shut for the professionals considered (a closure covering it, or nobody works that day). */
export function closedDayText(facts: DayFacts, day: string, who?: string) {
  if (facts.closures.some(span => span.start <= 0 && span.end >= 1440)) return `o salão está fechado em ${formatDay(day)}`;
  if (facts.staff.length && facts.staff.every(staff => !staff.work.length)) return who ? `${who} não atende em ${formatDay(day)}` : `nenhum profissional atende em ${formatDay(day)}`;
}

/** Read-only tenant facts of one local day for the given professionals (undefined: unknown; today's question applies). A salon
 * without any configured working hours says nothing about which half of the day is possible. */
export async function loadDayFacts(tx: Tx, salonId: string, timezone: string, date: string, professionalIds: readonly string[], now: Date): Promise<DayFacts | undefined> {
  const ids = [...new Set(professionalIds)];
  if (!ids.length || !await tx.workingHours.findFirst({ where: { salonId }, select: { id: true } })) return;
  const from = startOfDateInTimeZone(date, timezone), to = endExclusiveOfDateInTimeZone(date, timezone);
  const local = (at: Date) => at <= from ? 0 : at >= to ? 1440 : wallClockMinutesInTimeZone(at, timezone);
  const clip = (rows: readonly { startAt: Date; endAt: Date }[]) => unionIntervals(rows.map(row => ({ start: local(row.startAt), end: local(row.endAt) })));
  const weekly = await tx.workingHours.findMany({ where: { salonId, professionalId: { in: ids }, weekday: weekdayOfDateKey(date) }, select: { professionalId: true, startMinutes: true, endMinutes: true } });
  const openings = await tx.professionalOpening.findMany({ where: { salonId, professionalId: { in: ids }, dateKey: date }, select: { professionalId: true, startMinutes: true, endMinutes: true } });
  const closures = await tx.salonClosure.findMany({ where: { salonId, startAt: { lt: to }, endAt: { gt: from } }, select: { startAt: true, endAt: true } });
  // TimeOff has no salonId of its own: it is scoped through its professional's salon.
  const offs = await tx.timeOff.findMany({ where: { professionalId: { in: ids }, professional: { salonId }, startAt: { lt: to }, endAt: { gt: from } }, select: { professionalId: true, startAt: true, endAt: true } });
  const today = dateKeyInTimeZone(now, timezone);
  return { closures: clip(closures), now: date > today ? -1 : date < today ? 1440 : wallClockMinutesInTimeZone(now, timezone),
    staff: ids.map(id => ({ id, work: unionIntervals([...weekly, ...openings].filter(row => row.professionalId === id).map(row => ({ start: row.startMinutes, end: row.endMinutes }))),
      off: clip(offs.filter(row => row.professionalId === id)) })) };
}
/** Facts of a LOCATE purpose: only the salon's current minute (no hours needed). */
export async function loadNowFacts(actor: ServiceActor, date: string, now: Date): Promise<DayFacts> {
  const timezone = await withTenant(actor, tx => schedulingTimezone(tx, actor)), today = dateKeyInTimeZone(now, timezone);
  return { staff: [], closures: [], now: date > today ? -1 : date < today ? 1440 : wallClockMinutesInTimeZone(now, timezone) };
}

/** Which facts decide a pending reading of this operation's role; reads and anything else keep today's question. */
export function daypartPurpose(op: string, field: string): DaypartPurpose | undefined {
  if ((op === "appointment.create" || op === "appointment.change") && field === "time") return "BOOK";
  if (op === "appointment.change" && field === "source_time" || op === "appointment.cancel" && field === "time") return "LOCATE";
  if (op === "schedule.block") return field === "time" ? "BLOCK_START" : field === "end_time" ? "BLOCK_END" : undefined;
}
/** Who and what a BOOK/BLOCK reading is checked against, read-only. `staff.name`: set only for ONE professional. `service`:
 * the unique service (for alternatives). `release`: a move's own appointment (its slot does not count against itself). */
export type HoursContext = { day: string; staff: { ids: string[]; name?: string }; duration?: number; service?: string; release?: string; basis: string };
type ContextInput = { op: string; field: DaypartField; fields: SchedulingFields; unproven: ReadonlySet<string>; names?: Record<string, string> };
/** A move keeps its appointment's professional (and, for a time-only move, its day): the ONE appointment the proven data locate
 * (the resolved ref, or the tenant locator with a unique customer); anything else is unknown. */
async function movedAppointment(actor: ServiceActor, f: SchedulingFields, unproven: ReadonlySet<string>) {
  if (f.appointment_ref) return withTenant(actor, tx => getSchedulingAppointment(tx, actor, f.appointment_ref!));
  let customer = f.customer_ref;
  if (!customer) {
    if (!f.customer_name || unproven.has("customer_name")) return;
    const rows = await withTenant(actor, tx => searchSalonCustomer(tx, actor, f.customer_name!));
    if (rows.length !== 1) return;
    customer = rows[0].id;
  }
  const rows = await withTenant(actor, tx => locateSchedulingAppointments(tx, actor, { ...f, customer_ref: customer }, "appointment.change"));
  return rows.length === 1 ? rows[0] : undefined;
}
/** The professionals a reading is checked against: the resolved one, the one match of the name the owner wrote, every homonym
 * of it (their envelope), or every eligible active professional (the salon's envelope). Never a pick; a list the catalog
 * truncates (over 20) is unknown. A booking's service (the resolved ref, or the single match of the name the owner wrote, not
 * resolved yet on a first turn) filters them first: a homonym who does not perform it never lends its hours. */
async function staffOf(actor: ServiceActor, f: SchedulingFields, op: string, unproven: ReadonlySet<string>, names?: Record<string, string>, resolvedService?: string) {
  if (f.professional_ref) {
    const registered = names?.[f.professional_ref] ?? (await withTenant(actor, tx => listSchedulingProfessionals(tx, actor, {}))).find(row => row.id === f.professional_ref)?.name;
    return { ids: [f.professional_ref], name: registered ?? undefined };
  }
  const serviceRef = op === "appointment.create" ? f.service_ref ?? resolvedService : undefined, service = serviceRef ? { service_ref: serviceRef } : {};
  if (f.professional_name && !unproven.has("professional_name")) {
    const rows = await withTenant(actor, tx => listSchedulingProfessionals(tx, actor, { ...service, query: f.professional_name }));
    if (rows.length === 1) return { ids: [rows[0].id], name: rows[0].name };
    if (rows.length > 1) return rows.length <= 20 ? { ids: rows.map(row => row.id).sort() } : undefined;
    // The name the owner wrote matches no one (eligible): that professional is asked first; nobody else's hours decide.
    return;
  }
  const all = await withTenant(actor, tx => listSchedulingProfessionals(tx, actor, service));
  return all.length && all.length <= 20 ? { ids: all.map(row => row.id).sort() } : undefined;
}
async function serviceOf(actor: ServiceActor, f: SchedulingFields): Promise<{ ref: string; duration: number } | undefined> {
  if (f.service_ref) {
    const row = await withTenant(actor, tx => tx.service.findFirst({ where: { id: f.service_ref!, salonId: actor.salonId, active: true }, select: { durationMin: true } }));
    return row ? { ref: f.service_ref, duration: row.durationMin } : undefined;
  }
  if (!f.service_name) return;
  const rows = await withTenant(actor, tx => listSchedulingServices(tx, actor, f.service_name!));
  return rows.length === 1 ? { ref: rows[0].id, duration: rows[0].durationMin } : undefined;
}
/** BOOK/BLOCK context of one pending role (undefined: unknown facts, today's question). The basis names every input of the facts
 * (day, professionals, duration): a resolution is re-checked whenever it changes. */
export async function hoursContext(actor: ServiceActor, input: ContextInput): Promise<HoursContext | undefined> {
  const { op, field, fields: f } = input, purpose = daypartPurpose(op, field);
  if (!purpose || purpose === "LOCATE") return;
  let day = field === "end_time" ? f.end_date ?? f.date : f.date, staff: HoursContext["staff"] | undefined, duration: number | undefined, service: string | undefined, release: string | undefined;
  if (op === "appointment.change") {
    const appointment = await movedAppointment(actor, f, input.unproven);
    if (!appointment) return;
    staff = { ids: [appointment.professional_ref], name: appointment.professional_name };
    duration = Math.round((Date.parse(appointment.end_at) - Date.parse(appointment.start_at)) / 60000) || undefined;
    service = appointment.service_ref; release = appointment.appointment_ref; day ??= appointment.start_local.slice(0, 10);
  } else {
    if (op === "appointment.create") { const found = await serviceOf(actor, f); duration = found?.duration; service = found?.ref; }
    staff = await staffOf(actor, f, op, input.unproven, input.names, service);
  }
  if (!day || !staff?.ids.length) return;
  return { day, staff, duration, service, release, basis: `${purpose}|${day}|${staff.ids.join(",")}|${duration ?? ""}` };
}
/** Real free slots of that day for ONE professional and a known service (never for an envelope), without the excluded clocks. */
export async function hoursAlternatives(actor: ServiceActor, context: HoursContext, now: Date, excluded?: ReadonlySet<string>) {
  if (!context.service || context.staff.ids.length !== 1) return [];
  try {
    const found = await withTenant(actor, tx => getSchedulingAvailability(tx, actor, { service_ref: context.service, professional_ref: context.staff.ids[0], date: context.day }, now,
      context.release ? { releasedAppointmentId: context.release } : undefined, excluded));
    return found.alternatives;
  } catch { return []; }
}
