import { describe, expect, it } from "vitest";
import { resolveAppointment, resolveTargetDate, resolveTargetTime, type PilotAppointmentResolution, type PilotPerson, type PilotProfessionalRow,
  type PilotServiceRow } from "../secretary-pilot-resolver";
import type { PilotTempoDia, PilotTempoHora } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { e2bCited, e2bClock, e2bDays, e2bMinutes, e2bOrigin, e2bRandom, e2bWeeks, saoPauloInstant, wire, type E2bClock, type E2bDay, type E2bDayAnchor,
  type E2bOrigin } from "../../test/secretary-pilot-e2b";

/** Reschedule pilot E2-B, the resolver of anchored offsets (docs/c5-spike/12-piloto-remarcacao.md §11.1; Adendo 11), written BEFORE the
 * implementation, with ADVERSARIAL TWINS (pairs identical but for the one typed fact that must change the result).
 *  - The code computes ONE reading per anchor the model listed: origem = the appointment's own day or clock; hoje / agora = the frozen received_at
 *    of the turn that SAID the operator, in the salon's timezone; data_citada = the literal date, computed like the "data" operator. Weeks are 7
 *    days. One anchor: used (derived, shown). Two anchors: equal readings are used; different readings are asked (ANCHOR_TWO_READINGS, both real
 *    values). Never an anchor chosen from the mention's words.
 *  - A result in the past (or a date that does not exist) is asked, never shifted. ENCODED AMBIGUITY A (spec silent): with two anchors, a reading
 *    that cannot be a destination (past) is not a reading, like decision 18 drops a clock outside the hours: one valid reading left is used
 *    (derived, shown); none left is asked.
 *  - ENCODED AMBIGUITY B (spec silent): an "agora" reading lives on received_at's own day; on another destination day it is no reading (the
 *    clock of now is never pasted onto another day).
 *  - Decision 18 (bare hours) never applies to an offset: an offset's clock is the computed one, not re-read as h / h+12.
 *  - Origin hints: an anchored offset in origem.dia filters the customer's appointments by its reading(s) (two readings never choose between
 *    appointments); an origin day anchored on the origin itself says nothing about it; the narrow provenance check still applies.
 * received_at: Monday 2031-03-10, 09:00 in São Paulo unless a case moves it. Invented names and sentences; no network, database or model. */
const MON = "2031-03-10", TUE = "2031-03-11", WED = "2031-03-12", THU = "2031-03-13", FRI = "2031-03-14";
const at = (local: string) => clockAt(saoPauloInstant(local));
const day = (dia: E2bDay, origin = THU, said = clockAt(), current?: ReturnType<typeof clockAt>) =>
  resolveTargetDate(wire<PilotTempoDia>(dia), { date: origin }, said, {}, current);
const one = (date: string, mencao: string) => ({ state: "one", date, provenance: "derived", mencao });
const past = (mencao: string) => ({ state: "invalid", reason: "DATE_PAST", mencao });

describe("§11.1 day offset: one reading per anchor, from the frozen received_at (TWINS: only the anchor differs)", () => {
  const rows: [number, "dias" | "semanas", string | null, string | null][] = [
    // quantidade, unidade, anchored on the appointment (Thursday 13), anchored on today (Monday 10); null = in the past (asked)
    [1, "dias", FRI, TUE], [3, "dias", "2031-03-16", THU], [0, "dias", THU, MON], [1, "semanas", "2031-03-20", "2031-03-17"], [2, "semanas", "2031-03-27", "2031-03-24"],
    [-2, "dias", TUE, null], [-1, "semanas", null, null],
  ];
  for (const [quantidade, unidade, fromOrigin, fromToday] of rows) it(`${quantidade} ${unidade}: origem → ${fromOrigin ?? "past"}, hoje → ${fromToday ?? "past"}`, () => {
    const make = unidade === "dias" ? e2bDays : e2bWeeks, mencao = `${quantidade} ${unidade} de deslocamento`;
    expect(day(make(quantidade, ["origem"], mencao))).toEqual(fromOrigin ? one(fromOrigin, mencao) : past(mencao));
    expect(day(make(quantidade, ["hoje"], mencao))).toEqual(fromToday ? one(fromToday, mencao) : past(mencao));
  });
  it("the anchor origem follows the appointment's own day (same offset, two origins)", () => {
    expect(day(e2bDays(2, ["origem"], "dois dias depois do marcado"), WED)).toEqual(one("2031-03-14", "dois dias depois do marcado"));
    expect(day(e2bDays(2, ["origem"], "dois dias depois do marcado"), FRI)).toEqual(one("2031-03-16", "dois dias depois do marcado"));
    // …while hoje never does.
    expect(day(e2bDays(2, ["hoje"], "dois dias contando de hoje"), WED)).toEqual(day(e2bDays(2, ["hoje"], "dois dias contando de hoje"), FRI));
  });
  it("weeks are 7 days, for every anchor and sign (property)", () => {
    for (let q = -2; q <= 6; q++) for (const anchors of [["origem"], ["hoje"], ["data_citada"]] as E2bDayAnchor[][]) {
      const cited = anchors[0] === "data_citada" ? e2bCited(20, null, "dia 20") : null;
      const weeks = day(e2bWeeks(q, anchors, "a mesma menção", cited));
      expect(["one", "invalid"], `${q} ${anchors}`).toContain(weeks?.state);
      expect(weeks, `${q} ${anchors}`).toEqual(day(e2bDays(7 * q, anchors, "a mesma menção", cited)));
    }
  });
  it("hoje is counted on the salon's local day of the turn that SAID it: said at 23:50, resolved after midnight, still that turn's tomorrow", () => {
    const said = at("2031-03-10T23:50"), later = at("2031-03-11T00:10");
    expect(day(e2bDays(1, ["hoje"], "amanhã"), THU, said, later)).toEqual(one(TUE, "amanhã"));
    // …and a day of that turn that has passed meanwhile is asked, never moved forward.
    expect(day(e2bDays(0, ["hoje"], "hoje ainda"), THU, said, later)).toEqual(past("hoje ainda"));
    // 23:30 in São Paulo is still that local day (02:30 UTC is not).
    expect(day(e2bDays(1, ["hoje"], "amanhã"), THU, at("2031-03-10T23:30"))).toEqual(one(TUE, "amanhã"));
  });
});

describe("§11.1 data_citada: the literal date (computed like the operator 'data'), then the offset", () => {
  const cases: [number, "dias" | "semanas", number, number | null, string | { invalid: string }][] = [
    [2, "dias", 20, null, "2031-03-22"], [2, "dias", 20, 4, "2031-04-22"], [-3, "dias", 20, null, "2031-03-17"], [1, "semanas", 20, null, "2031-03-27"],
    // month rollover after the offset; a day number already past this month is next month's; a 31st the month has
    [3, "dias", 30, 3, "2031-04-02"], [1, "dias", 5, null, "2031-04-06"], [1, "dias", 31, null, "2031-04-01"], [0, "dias", 10, null, MON],
    [1, "dias", 31, 4, { invalid: "NO_SUCH_DATE" }],
  ];
  for (const [quantidade, unidade, dia, mes, expected] of cases) it(`${quantidade} ${unidade} from ${dia}/${mes ?? "-"} → ${typeof expected === "string" ? expected : expected.invalid}`, () => {
    const make = unidade === "dias" ? e2bDays : e2bWeeks, mencao = "a partir da data dita";
    const result = day(make(quantidade, ["data_citada"], mencao, e2bCited(dia, mes, `${dia}${mes ? `/${mes}` : ""}`)));
    expect(result).toEqual(typeof expected === "string" ? one(expected, mencao) : { state: "invalid", reason: expected.invalid, mencao });
  });
  it("TWIN: the same offset from the cited date and from the appointment give different days (the anchor is a typed fact)", () => {
    expect(day(e2bDays(1, ["data_citada"], "um dia depois do 20", e2bCited(20, null, "20")))).toEqual(one("2031-03-21", "um dia depois do 20"));
    expect(day(e2bDays(1, ["origem"], "um dia depois do 20"))).toEqual(one(FRI, "um dia depois do 20"));
  });
});

describe("§11.1 two anchors: equal readings are used; different readings are asked with both real dates (decision 27)", () => {
  const ask = (options: string[], mencao: string) => ({ state: "ask", options, reason: "ANCHOR_TWO_READINGS", mencao });
  it("origem + hoje: the appointment is today → one day (no question); it is Thursday → both asked (TWINS: only the origin day differs)", () => {
    expect(day(e2bDays(1, ["origem", "hoje"], "um dia depois"), MON)).toEqual(one(TUE, "um dia depois"));
    expect(day(e2bDays(1, ["origem", "hoje"], "um dia depois"), THU)).toEqual(ask([TUE, FRI], "um dia depois"));
    expect(day(e2bDays(1, ["hoje", "origem"], "um dia depois"), THU), "the order of the anchors never matters").toEqual(ask([TUE, FRI], "um dia depois"));
    expect(day(e2bWeeks(1, ["origem", "hoje"], "uma semana depois"), THU)).toEqual(ask(["2031-03-17", "2031-03-20"], "uma semana depois"));
  });
  it("data_citada + origem: the cited day is the appointment's → one; another day → both asked", () => {
    expect(day(e2bDays(1, ["data_citada", "origem"], "um dia depois do 13", e2bCited(13, null, "13")))).toEqual(one(FRI, "um dia depois do 13"));
    expect(day(e2bDays(1, ["data_citada", "origem"], "um dia depois do 12", e2bCited(12, null, "12")))).toEqual(ask([THU, FRI], "um dia depois do 12"));
  });
  it("hoje + data_citada: the cited day is today → one; another day → both asked", () => {
    expect(day(e2bDays(2, ["hoje", "data_citada"], "dois dias depois do 10", e2bCited(10, null, "10")))).toEqual(one(WED, "dois dias depois do 10"));
    expect(day(e2bDays(2, ["hoje", "data_citada"], "dois dias depois do 11", e2bCited(11, null, "11")))).toEqual(ask([WED, THU], "dois dias depois do 11"));
  });
  it("ENCODED AMBIGUITY A: a past reading is no reading — one valid left is used (derived), none left is asked as past", () => {
    expect(day(e2bDays(-2, ["origem", "hoje"], "dois dias antes"), THU)).toEqual(one(TUE, "dois dias antes"));
    expect(day(e2bDays(-1, ["origem", "hoje"], "um dia antes"), THU)).toEqual(one(WED, "um dia antes"));
    expect(day(e2bWeeks(-1, ["origem", "hoje"], "uma semana antes"), THU)).toEqual(past("uma semana antes"));
  });
  it("the mention never decides (property): any words in mencao, the same typed fields → the same result", () => {
    const words = ["amanhã", "depois do atendimento", "a partir de hoje", "dia 31", "na semana que vem", "do horário marcado dela", "sei lá", "q1", "origem", "hoje"];
    const random = e2bRandom(20310310);
    for (const anchors of [["origem"], ["hoje"], ["origem", "hoje"]] as E2bDayAnchor[][]) {
      const base = day(e2bDays(1, anchors, "palavras neutras"));
      expect(["one", "ask"], String(anchors)).toContain(base?.state);
      for (let round = 0; round < 12; round++) {
        const mencao = [words[Math.floor(random() * words.length)], words[Math.floor(random() * words.length)]].join(" ");
        expect({ ...day(e2bDays(1, anchors, mencao)), mencao: null }, `${anchors} ${mencao}`).toEqual({ ...base, mencao: null });
      }
    }
  });
});

const abelardo: PilotProfessionalRow = { id: "pro-abelardo", name: "Abelardo Juruena", serviceIds: ["srv-reflexo"] };
const bernadete: PilotProfessionalRow = { id: "pro-bernadete", name: "Bernadete Quixadá", serviceIds: ["srv-reflexo"] };
const studioReader = () => memoryReader({ team: [abelardo, bernadete], hours: { [abelardo.id]: everyDay(["08:00", "20:00"]), [bernadete.id]: everyDay(["12:00", "22:00"]) } });
const time = (hora: E2bClock, origin: { date: string; time: string }, date: string, clock = clockAt(), professionalId: string | null = abelardo.id, reader = studioReader()) =>
  resolveTargetTime(reader, wire<PilotTempoHora>(hora), wire<Parameters<typeof resolveTargetTime>[2]>({ origin, date, professionalId, clock }));
const oneTime = (value: string, mencao: string) => ({ state: "one", time: value, provenance: "derived", mencao });

describe("§11.1 clock offset: origem or agora (TWINS: only the anchor differs)", () => {
  it("anchored on the appointment's clock: +90, -30, +150 minutes (derived)", async () => {
    const origin = { date: THU, time: "15:00" };
    expect(await time(e2bMinutes(90, ["origem"], "uma hora e meia mais tarde"), origin, THU)).toEqual(oneTime("16:30", "uma hora e meia mais tarde"));
    expect(await time(e2bMinutes(-30, ["origem"], "meia hora mais cedo"), origin, THU)).toEqual(oneTime("14:30", "meia hora mais cedo"));
    expect(await time(e2bMinutes(150, ["origem"], "cento e cinquenta minutos adiante"), origin, THU)).toEqual(oneTime("17:30", "cento e cinquenta minutos adiante"));
  });
  it("anchored on now (received_at, the appointment later today): +90 → 10:30; the same words anchored on the appointment → 16:30", async () => {
    const origin = { date: MON, time: "15:00" };
    expect(await time(e2bMinutes(90, ["agora"], "uma hora e meia"), origin, MON)).toEqual(oneTime("10:30", "uma hora e meia"));
    expect(await time(e2bMinutes(90, ["origem"], "uma hora e meia"), origin, MON)).toEqual(oneTime("16:30", "uma hora e meia"));
  });
  it("-30 minutes: from the appointment 14:30; from now (09:00) it is already past → asked, never used", async () => {
    const origin = { date: MON, time: "15:00" };
    expect(await time(e2bMinutes(-30, ["origem"], "trinta minutos"), origin, MON)).toEqual(oneTime("14:30", "trinta minutos"));
    expect((await time(e2bMinutes(-30, ["agora"], "trinta minutos"), origin, MON)).state).not.toBe("one");
  });
  it("two anchors: different readings asked with both clocks (bound to the time); equal readings used", async () => {
    const ask = { state: "ask", options: ["10:30", "16:30"], reason: "ANCHOR_TWO_READINGS", mencao: "uma hora e meia depois" };
    expect(await time(e2bMinutes(90, ["origem", "agora"], "uma hora e meia depois"), { date: MON, time: "15:00" }, MON)).toEqual(ask);
    expect(await time(e2bMinutes(90, ["agora", "origem"], "uma hora e meia depois"), { date: MON, time: "15:00" }, MON)).toEqual(ask);
    // Said at 15:00 about an appointment at 15:00 (the twin: only received_at differs): both readings are 16:00.
    expect(await time(e2bMinutes(60, ["origem", "agora"], "uma hora depois"), { date: MON, time: "15:00" }, MON, at("2031-03-10T15:00"))).toEqual(oneTime("16:00", "uma hora depois"));
  });
  it("ENCODED AMBIGUITY A for clocks: a past reading of two is dropped (the other used); ENCODED AMBIGUITY B: now's clock never lands on another day", async () => {
    expect(await time(e2bMinutes(-60, ["origem", "agora"], "uma hora antes"), { date: MON, time: "15:00" }, MON)).toEqual(oneTime("14:00", "uma hora antes"));
    expect((await time(e2bMinutes(90, ["agora"], "daqui a uma hora e meia"), { date: THU, time: "15:00" }, THU)).state).not.toBe("one");
  });
  it("the agora reading is the received_at of the turn that SAID it (a later turn's clock never moves it)", async () => {
    expect(await time(e2bMinutes(90, ["agora"], "daqui a uma hora e meia"), { date: MON, time: "15:00" }, MON, at("2031-03-10T09:00"))).toEqual(oneTime("10:30", "daqui a uma hora e meia"));
    expect(await time(e2bMinutes(90, ["agora"], "daqui a uma hora e meia"), { date: MON, time: "15:00" }, MON, at("2031-03-10T09:40"))).toEqual(oneTime("11:10", "daqui a uma hora e meia"));
  });
  it("an offset that leaves the day is asked, never wrapped around midnight", async () => {
    expect((await time(e2bMinutes(120, ["origem"], "duas horas depois"), { date: THU, time: "23:00" }, THU)).state).not.toBe("one");
    expect((await time(e2bMinutes(-60, ["origem"], "uma hora antes"), { date: THU, time: "00:30" }, THU)).state).not.toBe("one");
  });
  it("decision 18 never re-reads an offset: 09:00 - 60 min is 08:00 even where only 20:00 is inside the hours, and no hours are read (TWIN: a bare 8 is filtered)", async () => {
    const reader = studioReader();
    expect(await time(e2bMinutes(-60, ["origem"], "uma hora mais cedo"), { date: THU, time: "09:00" }, THU, clockAt(), bernadete.id, reader)).toEqual(oneTime("08:00", "uma hora mais cedo"));
    expect(reader.calls.filter(call => call.method === "workingWindows")).toEqual([]);
    expect(await time(e2bClock(8, "às 8"), { date: THU, time: "09:00" }, THU, clockAt(), bernadete.id)).toEqual({ state: "one", time: "20:00", provenance: "derived", mencao: "às 8" });
  });
  it("the mention never decides (property): other words, the same typed minutes and anchors → the same clock", async () => {
    const base = await time(e2bMinutes(45, ["origem"], "palavras neutras"), { date: THU, time: "15:00" }, THU);
    expect(base).toEqual(oneTime("15:45", "palavras neutras"));
    for (const mencao of ["daqui a 45 minutos", "a partir de agora", "45 min depois do horário dela", "às 9", "agora mesmo", "agora"])
      expect({ ...(await time(e2bMinutes(45, ["origem"], mencao), { date: THU, time: "15:00" }, THU)), mencao: null }, mencao).toEqual({ ...base, mencao: null });
  });
});

describe("§11.1 an anchored offset as an origin hint (which appointment): filters by its reading(s), never picks between two", () => {
  const reflexo: PilotServiceRow = { id: "srv-reflexo", name: "Reflexologia podal", durationMin: 50, priceCents: 9000 };
  const ivonete: PilotPerson = { id: "cli-ivonete", name: "Ivonete Barbalho" };
  const salon: MemorySalon = { customers: [ivonete], team: [abelardo, bernadete], catalog: [reflexo], hours: { [abelardo.id]: everyDay(["08:00", "20:00"]) },
    appointments: [booked("apt-ivo-tue", ivonete, abelardo, reflexo, TUE, "10:00"), booked("apt-ivo-wed", ivonete, abelardo, reflexo, WED, "10:00"),
      booked("apt-ivo-thu", ivonete, abelardo, reflexo, THU, "10:00")] };
  const locate = (origem: E2bOrigin, message: string) =>
    resolveAppointment(memoryReader(salon), wire<Parameters<typeof resolveAppointment>[1]>({ customerId: ivonete.id, origem, message, catalog: [reflexo] }), clockAt());
  const picked = (result: PilotAppointmentResolution) => result.state === "one" ? result.appointment.id : result.state === "several" ? result.options.map(row => row.id).sort() : result.state;
  it("TWINS: +1 from today → Tuesday's; +2 from today → Wednesday's", async () => {
    expect(picked(await locate(e2bOrigin({ dia: e2bDays(1, ["hoje"], "a de amanhã") }), "A de amanhã da Ivonete passa pra sexta"))).toBe("apt-ivo-tue");
    expect(picked(await locate(e2bOrigin({ dia: e2bDays(2, ["hoje"], "a de depois de amanhã") }), "A de depois de amanhã da Ivonete passa pra sexta"))).toBe("apt-ivo-wed");
  });
  it("from a cited day: one day after the 12th → Thursday's", async () => {
    expect(picked(await locate(e2bOrigin({ dia: e2bDays(1, ["data_citada"], "a do dia seguinte ao 12", e2bCited(12, null, "12")) }),
      "A do dia seguinte ao 12 da Ivonete passa pra sexta"))).toBe("apt-ivo-thu");
  });
  it("two readings (today+1 and the 12th+1) match two appointments: both are asked, never one chosen", async () => {
    expect(picked(await locate(e2bOrigin({ dia: e2bDays(1, ["hoje", "data_citada"], "a do dia seguinte", e2bCited(12, null, "12")) }),
      "A do dia seguinte ao 12 da Ivonete passa pra sexta"))).toEqual(["apt-ivo-thu", "apt-ivo-tue"]);
  });
  it("an origin day anchored on the origin itself says nothing about it: all of hers stay (asked)", async () => {
    expect(picked(await locate(e2bOrigin({ dia: e2bDays(1, ["origem"], "a de um dia depois") }), "A de um dia depois da Ivonete passa pra sexta")))
      .toEqual(["apt-ivo-thu", "apt-ivo-tue", "apt-ivo-wed"]);
  });
  it("the narrow provenance check still applies: words not in the message never choose", async () => {
    const result = await locate(e2bOrigin({ dia: e2bDays(1, ["hoje"], "a de amanhã") }), "Passa a Ivonete pra sexta");
    expect(picked(result)).toEqual(["apt-ivo-thu", "apt-ivo-tue", "apt-ivo-wed"]);
    expect(result.state === "several" && result.ignored).toContain("dia");
  });
});
