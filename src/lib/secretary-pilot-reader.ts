import { withTenant, type Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { assertSchedulingAccess, schedulingTimezone } from "./scheduling-catalog";
import { FOLD_FROM, FOLD_TO, nameTokens } from "./name-search";
import { subtractIntervals, unionIntervals } from "./intervals";
import { endExclusiveOfDateInTimeZone, isDateKey, localDateTimeToUtc, startOfDateInTimeZone, toLocalDateTime, wallClockMinutesInTimeZone, weekdayOfDateKey } from "./time";
import type { PilotAppointmentRow, PilotBusy, PilotPerson, PilotProfessionalRow, PilotReader, PilotServiceRow, PilotWindow } from "./secretary-pilot-resolver";

/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE, default off): the resolver's reads on the real tables, always inside withTenant
 * for the session's actor (RLS by salon) and with the salon predicate repeated. Read-only; a failing read throws (the resolver says
 * "unavailable", never "not found"). Customers: the unmerged customers holding every folded name token of the mention as a whole word, else
 * those sharing one (the resolver decides by whole tokens), plus, for tolerant suggestions, those with a name word starting like a mention token;
 * bounded, and a set past the bound is refused (never decided on a truncated set). */
/** Review L5/M3: 300 future appointments of one customer (a long recurring series) before the read is refused; a question lists at most 8 of
 * them in its text (plus a count) and keeps at most 20 as options. */
export const PILOT_READ_LIMITS = Object.freeze({ customers: 1000, appointments: 300 });
const ACTIVE = ["PENDING", "CONFIRMED"] as const, OCCUPYING = ["PENDING", "CONFIRMED", "IN_PROGRESS"] as const;
const minutesOn = (date: string, timezone: string, at: Date) => {
  const start = startOfDateInTimeZone(date, timezone), end = endExclusiveOfDateInTimeZone(date, timezone);
  return at <= start ? 0 : at >= end ? 24 * 60 : wallClockMinutesInTimeZone(at, timezone);
};
/** Working intervals of one professional on a local day: weekly hours and openings, minus salon closures and the professional's time off. */
async function windowsOf(tx: Tx, salonId: string, timezone: string, professionalId: string, date: string): Promise<PilotWindow[]> {
  const from = startOfDateInTimeZone(date, timezone), to = endExclusiveOfDateInTimeZone(date, timezone);
  const [weekly, openings, closures, offs] = await Promise.all([
    tx.workingHours.findMany({ where: { salonId, professionalId, weekday: weekdayOfDateKey(date) }, select: { startMinutes: true, endMinutes: true } }),
    tx.professionalOpening.findMany({ where: { salonId, professionalId, dateKey: date }, select: { startMinutes: true, endMinutes: true } }),
    tx.salonClosure.findMany({ where: { salonId, startAt: { lt: to }, endAt: { gt: from } }, select: { startAt: true, endAt: true } }),
    // TimeOff has no salonId of its own: it is scoped through its professional's salon.
    tx.timeOff.findMany({ where: { professionalId, professional: { salonId }, startAt: { lt: to }, endAt: { gt: from } }, select: { startAt: true, endAt: true } }),
  ]);
  const work = [...weekly, ...openings].map(row => ({ start: row.startMinutes, end: row.endMinutes }));
  const away = [...closures, ...offs].map(row => ({ start: minutesOn(date, timezone, row.startAt), end: minutesOn(date, timezone, row.endAt) }));
  return subtractIntervals(work, away);
}
export function pilotTenantReader(actor: ServiceActor): PilotReader {
  const read = <T>(run: (tx: Tx, timezone: string) => Promise<T>) => withTenant(actor, async tx => { await assertSchedulingAccess(tx, actor); return run(tx, await schedulingTimezone(tx, actor)); });
  const salonId = actor.salonId;
  return {
    customers: mencao => read(async tx => {
      const tokens = [...new Set(nameTokens(mencao))];
      if (!tokens.length) return [];
      const valid = (rows: unknown) => (Array.isArray(rows) ? rows : []).filter((row): row is PilotPerson => typeof row?.id === "string" && typeof row.name === "string")
        .map(row => ({ id: row.id, name: row.name }));
      // Review M8: whole folded tokens in the database (tokens are letters and digits only). First the names holding EVERY mention token: when
      // there is one, the identity is decided on that set alone (pilotIdentityOf looks at nothing else then), so a common first name never makes
      // a full name unreadable. Only when none holds them all, the names sharing ANY token (the contradictory/suggestion set).
      const words = tokens.map(token => `(^|[^a-z0-9])${token}([^a-z0-9]|$)`), cap = PILOT_READ_LIMITS.customers;
      const every = await tx.$queryRaw<PilotPerson[]>`SELECT id, name FROM "ClientProfile" WHERE "salonId"=${salonId} AND "mergedIntoId" IS NULL
        AND lower(translate(name, ${FOLD_FROM}, ${FOLD_TO})) ~ ALL (${words}::text[]) ORDER BY name, id LIMIT ${cap + 1}::int`;
      if (!Array.isArray(every) || every.length > cap) throw Error("PILOT_SEARCH_TOO_BROAD");
      if (every.length) return valid(every);
      const shared = await tx.$queryRaw<PilotPerson[]>`SELECT id, name FROM "ClientProfile" WHERE "salonId"=${salonId} AND "mergedIntoId" IS NULL
        AND lower(translate(name, ${FOLD_FROM}, ${FOLD_TO})) ~ ANY (${words}::text[]) ORDER BY name, id LIMIT ${cap + 1}::int`;
      if (!Array.isArray(shared)) throw Error("PILOT_SEARCH_TOO_BROAD");
      // Nobody holds every token and more than the bound share one: no record is "the one" (not found), and a set that broad suggests nobody.
      if (shared.length > cap) return [];
      const rows = valid(shared);
      if (rows.some(row => nameTokens(row.name).some(token => tokens.includes(token)))) return rows;
      // Nobody shares a whole token: names with a word starting like a mention token, for tolerant suggestions only (a broad set gives none).
      const prefixes = tokens.filter(token => /^[a-z0-9]{2}/.test(token)).map(token => `(^|[^a-z0-9])${token.slice(0, 2)}`);
      if (!prefixes.length) return rows;
      const near = await tx.$queryRaw<PilotPerson[]>`SELECT id, name FROM "ClientProfile" WHERE "salonId"=${salonId} AND "mergedIntoId" IS NULL
        AND lower(translate(name, ${FOLD_FROM}, ${FOLD_TO})) ~ ANY (${prefixes}::text[]) ORDER BY name, id LIMIT 301`;
      return Array.isArray(near) && near.length <= 300 ? [...rows, ...valid(near).filter(row => !rows.some(other => other.id === row.id))] : rows;
    }),
    appointmentsOf: (customerId, fromLocal) => read(async (tx, timezone) => {
      // received_at itself is the bound (the turn's frozen instant, to the minute); the resolver keeps only what starts after it. Review M7: an
      // instant that cannot be read is a failed read ("unavailable"), never the server's current time.
      const from = localDateTimeToUtc(fromLocal, timezone);
      if (!(from instanceof Date) || Number.isNaN(from.getTime())) throw Error("PILOT_CLOCK_INVALID");
      const rows = await tx.appointment.findMany({ where: { salonId, clientId: customerId, status: { in: [...ACTIVE] }, startAt: { gte: from } },
        select: { id: true, clientId: true, professionalId: true, serviceId: true, startAt: true, endAt: true, status: true, priceCents: true,
          dependentId: true, dependentName: true,
          professional: { select: { user: { select: { name: true } } } }, service: { select: { name: true } },
          serviceItems: { orderBy: { position: "asc" }, select: { serviceName: true } } },
        orderBy: [{ startAt: "asc" }, { id: "asc" }], take: PILOT_READ_LIMITS.appointments + 1 });
      if (rows.length > PILOT_READ_LIMITS.appointments) throw Error("PILOT_SEARCH_TOO_BROAD");
      // Review L5: the salon's timezone everywhere (received_at, the hints and these rows are all read in it).
      return rows.map((row): PilotAppointmentRow => ({ id: row.id, customerId: row.clientId, professionalId: row.professionalId, professionalName: row.professional.user.name ?? "",
        serviceId: row.serviceId, serviceName: row.serviceItems.length ? row.serviceItems.map(item => item.serviceName).join(" + ") : row.service.name,
        startLocal: toLocalDateTime(row.startAt, timezone), endLocal: toLocalDateTime(row.endAt, timezone), status: row.status,
        durationMin: Math.round((row.endAt.getTime() - row.startAt.getTime()) / 60_000), priceCents: row.priceCents,
        // Review M11: an appointment booked for a dependent is carried as such (never located from the customer's own mention).
        dependentName: row.dependentId ? row.dependentName ?? "" : null }));
    }),
    team: () => read(async tx => {
      const rows = await tx.professional.findMany({ where: { salonId, active: true }, select: { id: true, user: { select: { name: true } },
        services: { where: { service: { salonId, active: true } }, select: { serviceId: true } } }, orderBy: { id: "asc" }, take: 200 });
      return rows.map((row): PilotProfessionalRow => ({ id: row.id, name: row.user.name ?? "", serviceIds: row.services.map(item => item.serviceId) }));
    }),
    catalog: () => read(async tx => (await tx.service.findMany({ where: { salonId, active: true }, select: { id: true, name: true, durationMin: true, priceCents: true },
      orderBy: [{ name: "asc" }, { id: "asc" }], take: 400 })).map((row): PilotServiceRow => ({ id: row.id, name: row.name, durationMin: row.durationMin, priceCents: row.priceCents }))),
    workingWindows: (professionalId, date) => read(async (tx, timezone) => {
      if (!isDateKey(date)) throw Error("PILOT_DATE_INVALID");
      const ids = professionalId ? [professionalId] : (await tx.professional.findMany({ where: { salonId, active: true }, select: { id: true }, take: 200 })).map(row => row.id);
      const all: PilotWindow[] = [];
      for (const id of ids) all.push(...await windowsOf(tx, salonId, timezone, id, date));
      return unionIntervals(all);
    }),
    busy: (professionalId, date) => read(async (tx, timezone) => {
      if (!isDateKey(date)) throw Error("PILOT_DATE_INVALID");
      const from = startOfDateInTimeZone(date, timezone), to = endExclusiveOfDateInTimeZone(date, timezone);
      const [appointments, offs, closures] = await Promise.all([
        tx.appointment.findMany({ where: { salonId, professionalId, status: { in: [...OCCUPYING] }, startAt: { lt: to }, endAt: { gt: from } }, select: { id: true, startAt: true, endAt: true } }),
        tx.timeOff.findMany({ where: { professionalId, professional: { salonId }, startAt: { lt: to }, endAt: { gt: from } }, select: { startAt: true, endAt: true } }),
        tx.salonClosure.findMany({ where: { salonId, startAt: { lt: to }, endAt: { gt: from } }, select: { startAt: true, endAt: true } }),
      ]);
      return [...appointments.map((row): PilotBusy => ({ appointmentId: row.id, startLocal: toLocalDateTime(row.startAt, timezone), endLocal: toLocalDateTime(row.endAt, timezone) })),
        ...[...offs, ...closures].map((row): PilotBusy => ({ appointmentId: null, startLocal: toLocalDateTime(row.startAt, timezone), endLocal: toLocalDateTime(row.endAt, timezone) }))];
    }),
  };
}
