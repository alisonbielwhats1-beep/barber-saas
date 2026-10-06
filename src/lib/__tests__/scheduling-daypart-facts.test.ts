import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { closedDayText, closedReadingsText, daypartPurpose, loadDayFacts, openBlockPairs, openReadings, type DayFacts, type StaffDay } from "../scheduling-daypart-facts";

/** Candidate 4, C2 pure core (backlog §0): the owner's two readings of a bare hour filtered by the tenant's hard facts, never by
 * a fixed "2 = 14h". Every salon profile below is a different kind of business (barbearia, esmalteria, estúdio noturno de
 * tatuagem, spa 24h, estética com almoço). No DB, no network. */
const h = (hour: number, minute = 0) => hour * 60 + minute;
const staff = (id: string, work: [number, number][], off: [number, number][] = []): StaffDay => ({ id, work: work.map(([start, end]) => ({ start, end })), off: off.map(([start, end]) => ({ start, end })) });
const facts = (list: StaffDay[], closures: [number, number][] = [], now = -1): DayFacts => ({ staff: list, closures: closures.map(([start, end]) => ({ start, end })), now });
const barbearia = facts([staff("p-caio", [[h(8), h(20)]])]);
const soManha = facts([staff("p-lia", [[h(8), h(12)]])]);
const noturno = facts([staff("p-kai", [[h(0), h(3)], [h(18), h(24)]])]);
const spa24h = facts([staff("p-jade", [[0, h(24)]])]);
const almoco = facts([staff("p-nina", [[h(8), h(12)], [h(13), h(19)]])]);
const open = (candidates: string[], purpose: Parameters<typeof openReadings>[1], day: DayFacts, options: Parameters<typeof openReadings>[3] = {}) => openReadings(candidates, purpose, day, options).open;

describe("BOOK: start and start+duration inside one working interval, no closure, no TimeOff, not past", () => {
  it("a barbershop open 08-20 keeps only the afternoon reading", () => {
    expect(open(["02:00", "14:00"], "BOOK", barbearia)).toEqual(["14:00"]);expect(open(["03:00", "15:00"], "BOOK", barbearia)).toEqual(["15:00"]);
  });
  it("a morning-only professional: no reading fits (never 14h, never 02h)", () => {
    expect(openReadings(["02:00", "14:00"], "BOOK", soManha)).toEqual({ open: [], closed: [{ time: "02:00", cause: "OUTSIDE" }, { time: "14:00", cause: "OUTSIDE" }] });
  });
  it("a night tattoo studio 18h-03h keeps 02h (the rule never favours the afternoon)", () => { expect(open(["02:00", "14:00"], "BOOK", noturno)).toEqual(["02:00"]); });
  it("a 24h spa keeps both readings: the question stays", () => { expect(open(["02:00", "14:00"], "BOOK", spa24h)).toEqual(["02:00", "14:00"]); });
  it("a closed day and a closure over the whole day leave nothing", () => {
    expect(openReadings(["02:00", "14:00"], "BOOK", facts([staff("p-caio", [])])).closed.map(item => item.cause)).toEqual(["OUTSIDE", "OUTSIDE"]);
    expect(openReadings(["02:00", "14:00"], "BOOK", facts([staff("p-caio", [[h(8), h(20)]])], [[0, h(24)]])).closed.map(item => item.cause)).toEqual(["SALON_CLOSED", "SALON_CLOSED"]);
    expect(closedDayText(facts([staff("p-caio", [[h(8), h(20)]])], [[0, h(24)]]), "2026-10-01")).toBe("o salão está fechado em qui, 01/10");
    expect(closedDayText(facts([staff("p-caio", [])]), "2026-10-01", "Caio Brito")).toBe("Caio Brito não atende em qui, 01/10");
    expect(closedDayText(facts([staff("p-caio", []), staff("p-lia", [])]), "2026-10-01")).toBe("nenhum profissional atende em qui, 01/10");
    expect(closedDayText(barbearia, "2026-10-01")).toBeUndefined();
  });
  it("a lunch break 12-13: 01h/13h keeps 13h; a service crossing the break or the close is impossible", () => {
    expect(open(["01:00", "13:00"], "BOOK", almoco)).toEqual(["13:00"]);
    expect(openReadings(["11:30"], "BOOK", almoco, { duration: 60 }).closed).toEqual([{ time: "11:30", cause: "DURATION" }]);
    expect(openReadings(["07:00", "19:00"], "BOOK", barbearia, { duration: 90 })).toEqual({ open: [], closed: [{ time: "07:00", cause: "OUTSIDE" }, { time: "19:00", cause: "DURATION" }] });
    expect(open(["06:30", "18:30"], "BOOK", barbearia, { duration: 90 })).toEqual(["18:30"]);
  });
  it("TimeOff 13-15 covering the afternoon reading: BOOK has none; BLOCK_START still has 14h", () => {
    const folga = facts([staff("p-caio", [[h(8), h(20)]], [[h(13), h(15)]])]);
    expect(openReadings(["02:00", "14:00"], "BOOK", folga).closed.map(item => item.cause)).toEqual(["OUTSIDE", "OFF"]);
    expect(open(["02:00", "14:00"], "BLOCK_START", folga)).toEqual(["14:00"]);
  });
  it("today at 10:00 keeps 14h; at 15:00 nothing (the past never counts)", () => {
    expect(open(["02:00", "14:00"], "BOOK", { ...barbearia, now: h(10) })).toEqual(["14:00"]);
    expect(openReadings(["02:00", "14:00"], "BOOK", { ...barbearia, now: h(15) }).closed.map(item => item.cause)).toEqual(["PAST", "PAST"]);
    expect(openReadings(["14:00"], "BOOK", { ...barbearia, now: h(14) }).closed).toEqual([{ time: "14:00", cause: "PAST" }]);
    expect(openReadings(["14:00"], "BOOK", { ...barbearia, now: 1440 }).closed).toEqual([{ time: "14:00", cause: "PAST" }]);
  });
  it("boundaries: a booking may end exactly at the close and never start at it", () => {
    expect(open(["19:30"], "BOOK", barbearia, { duration: 30 })).toEqual(["19:30"]);expect(open(["19:31"], "BOOK", barbearia, { duration: 30 })).toEqual([]);
    expect(open(["20:00", "08:00"], "BOOK", barbearia)).toEqual(["08:00"]);
  });
  it("an envelope keeps a reading any professional can take (never a pick); the closest cause is said", () => {
    const equipe = facts([staff("p-lia", [[h(8), h(12)]]), staff("p-kai", [[h(18), h(24)]], [[h(20), h(22)]])]);
    expect(open(["02:00", "14:00"], "BOOK", equipe)).toEqual([]);
    expect(open(["09:00", "21:00"], "BOOK", equipe)).toEqual(["09:00"]);
    expect(openReadings(["21:00"], "BOOK", equipe).closed).toEqual([{ time: "21:00", cause: "OFF" }]);
  });
  it("an excluded reading is subtracted first and never offered", () => {
    expect(open(["02:00", "14:00"], "BOOK", spa24h, { excluded: new Set(["14:00"]) })).toEqual(["02:00"]);
  });
});

describe("BLOCK and LOCATE have their own possibility rules", () => {
  it("BLOCK: edges inside the working hours, only closures eliminate, an end is after its start", () => {
    expect(open(["02:00", "14:00"], "BLOCK_START", barbearia)).toEqual(["14:00"]);
    expect(open(["08:00", "20:00"], "BLOCK_END", barbearia)).toEqual(["20:00"]);
    expect(openReadings(["02:00", "14:00"], "BLOCK_END", barbearia, { other: "15:00" }).closed).toEqual([{ time: "02:00", cause: "OUTSIDE" }, { time: "14:00", cause: "INTERVAL" }]);
    expect(openReadings(["03:00", "15:00"], "BLOCK_START", barbearia, { other: "14:00" })).toEqual({ open: [], closed: [{ time: "03:00", cause: "OUTSIDE" }, { time: "15:00", cause: "INTERVAL" }] });
    expect(openReadings(["14:00"], "BLOCK_START", facts([staff("p-caio", [[h(8), h(20)]])], [[h(13), h(16)]])).closed).toEqual([{ time: "14:00", cause: "SALON_CLOSED" }]);
  });
  it("BLOCK pairs: 'das 2 às 6' in a salon 08-20 is 14-18; one professional must hold both edges", () => {
    expect(openBlockPairs(["02:00", "14:00"], ["06:00", "18:00"], barbearia)).toEqual([["14:00", "18:00"]]);
    expect(openBlockPairs(["02:00", "14:00"], ["06:00", "18:00"], spa24h)).toHaveLength(3);
    const split = facts([staff("p-lia", [[h(8), h(12)]]), staff("p-kai", [[h(16), h(22)]])]);
    expect(openBlockPairs(["10:00", "22:00"], ["05:00", "17:00"], split)).toEqual([]);
  });
  it("LOCATE: an existing appointment's clock is ruled out only by the past (it may sit outside today's hours)", () => {
    expect(open(["02:00", "14:00"], "LOCATE", { ...soManha, now: -1 })).toEqual(["02:00", "14:00"]);
    expect(open(["02:00", "14:00"], "LOCATE", { staff: [], closures: [], now: h(10) })).toEqual(["14:00"]);
    expect(openReadings(["02:00", "14:00"], "LOCATE", { staff: [], closures: [], now: h(15) }).closed.map(item => item.cause)).toEqual(["PAST", "PAST"]);
  });
  it("purposes: only bookings, blocks and existing appointments; reads keep today's question", () => {
    expect([daypartPurpose("appointment.create", "time"), daypartPurpose("appointment.change", "time"), daypartPurpose("appointment.change", "source_time"), daypartPurpose("appointment.cancel", "time"),
      daypartPurpose("schedule.block", "time"), daypartPurpose("schedule.block", "end_time"), daypartPurpose("appointment.list", "time"), daypartPurpose("availability.get", "time"), daypartPurpose("appointment.read", "time")])
      .toEqual(["BOOK", "BOOK", "LOCATE", "LOCATE", "BLOCK_START", "BLOCK_END", undefined, undefined, undefined]);
  });
  it("the closed readings are said with clocks, causes and the registered name only", () => {
    expect(closedReadingsText([{ time: "02:00", cause: "OUTSIDE" }], "Caio Brito")).toBe("às 2h Caio Brito não atende");
    expect(closedReadingsText([{ time: "02:00", cause: "OUTSIDE" }, { time: "14:00", cause: "OUTSIDE" }])).toBe("às 2h e às 14h nenhum profissional atende");
    expect(closedReadingsText([{ time: "02:00", cause: "PAST" }, { time: "14:00", cause: "OFF" }], "Nina Sato")).toBe("às 2h já passou; às 14h Nina Sato está indisponível");
  });
});

describe("loadDayFacts: read-only, tenant-scoped, unknown when the salon has no hours", () => {
  const tz = "America/Sao_Paulo", day = "2026-10-01", utc = (local: string) => new Date(Date.parse(`${local}:00Z`) + 3 * 3600_000);
  function tx(rows: { hours: Record<string, unknown>[]; openings?: Record<string, unknown>[]; closures?: Record<string, unknown>[]; offs?: Record<string, unknown>[] }) {
    const where: Record<string, unknown>[] = [];
    const take = (list: Record<string, unknown>[] = []) => vi.fn(async (query: { where: Record<string, unknown> }) => { where.push(query.where); return list.filter(row => Object.entries(query.where).every(([key, value]) =>
      key === "professionalId" && typeof value === "object" ? (value as { in: string[] }).in.includes(row.professionalId as string) : typeof value === "object" || row[key] === undefined || row[key] === value)); });
    return { where, tx: { workingHours: { findFirst: vi.fn(async ({ where: w }: { where: { salonId: string } }) => rows.hours.find(row => row.salonId === w.salonId) ?? null), findMany: take(rows.hours) },
      professionalOpening: { findMany: take(rows.openings) }, salonClosure: { findMany: take(rows.closures) }, timeOff: { findMany: take(rows.offs) } } as unknown as Tx };
  }
  it("no working hours configured in this salon (another salon has some): unknown", async () => {
    const { tx: t } = tx({ hours: [{ salonId: "estudio-sul", professionalId: "p-x", weekday: 4, startMinutes: 0, endMinutes: 1440 }] });
    expect(await loadDayFacts(t, "esmalteria-lua", tz, day, ["p-lia"], new Date("2026-09-29T15:00:00Z"))).toBeUndefined();
  });
  it("union of weekly hours and openings; closures and TimeOff clipped to the local day; every query carries the salon", async () => {
    const { tx: t, where } = tx({
      hours: [{ salonId: "esmalteria-lua", professionalId: "p-lia", weekday: 4, startMinutes: h(8), endMinutes: h(12) }],
      openings: [{ salonId: "esmalteria-lua", professionalId: "p-lia", dateKey: day, startMinutes: h(11), endMinutes: h(15) }],
      closures: [{ salonId: "esmalteria-lua", startAt: utc("2026-09-30T20:00"), endAt: utc("2026-10-01T09:00") }],
      offs: [{ professionalId: "p-lia", startAt: utc("2026-10-01T13:30"), endAt: utc("2026-10-02T10:00") }] });
    const loaded = await loadDayFacts(t, "esmalteria-lua", tz, day, ["p-lia"], new Date("2026-09-29T15:00:00Z"));
    expect(loaded).toEqual({ now: -1, closures: [{ start: 0, end: h(9) }], staff: [{ id: "p-lia", work: [{ start: h(8), end: h(15) }], off: [{ start: h(13, 30), end: 1440 }] }] });
    expect(where.every(item => item.salonId === "esmalteria-lua" || (item.professional as { salonId?: string })?.salonId === "esmalteria-lua")).toBe(true);
    expect(where.find(item => "professional" in item)).toMatchObject({ professional: { salonId: "esmalteria-lua" } });
  });
  it("today uses the salon's current minute; a past day is all past", async () => {
    const { tx: t } = tx({ hours: [{ salonId: "barbearia-sol", professionalId: "p-caio", weekday: 2, startMinutes: h(8), endMinutes: h(20) }] });
    expect((await loadDayFacts(t, "barbearia-sol", tz, "2026-09-29", ["p-caio"], new Date("2026-09-29T15:00:00Z")))?.now).toBe(h(12));
    expect((await loadDayFacts(t, "barbearia-sol", tz, "2026-09-28", ["p-caio"], new Date("2026-09-29T15:00:00Z")))?.now).toBe(1440);
  });
});
