import { describe, expect, it } from "vitest";
import { resolveAppointment, resolveTargetDate, type PilotAppointmentResolution, type PilotPerson, type PilotProfessionalRow,
  type PilotServiceRow } from "../secretary-pilot-resolver";
import type { PilotTempoDia } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { E2A_WEEKDAYS, e2aDay, e2aOrigin, e2aService, wire, type E2aDay, type E2aOrigin, type E2aWeekday } from "../../test/secretary-pilot-e2a";

/** Reschedule pilot E2-A, the resolver (docs/c5-spike/12-piloto-remarcacao.md §3, §10.2, §10.3; Adendo 10), written BEFORE the implementation.
 *  - Weekday: the typed enum becomes the weekday by a data table; the date is computed from the frozen received_at in the salon's timezone;
 *    decision 27 and the este/proximo/today rules are unchanged; the mention is never read to find the day.
 *  - Service as a factual hint of the existing appointment: only the `catalogo` names that exist in the salon's catalog (case and accents aside,
 *    name against name) count; the customer's future appointments are filtered by those services' ids. One → bound (derived); 2+ → asked with
 *    the real options; none, or a contradiction with the other hints → asked showing her appointments. Adversarial review PRINCIPLE-1: an empty
 *    list or only unknown names, with the mention proven, is Luna saying the owner's words fit no service of the salon: it matches no appointment
 *    (asked, never the only one bound in silence); an unproven mention is ignored, as every hint. SERVICE-1: an appointment holds every service
 *    of its items (a combo is found by any of them). The narrow provenance check applies to `servico.mencao`. No token similarity anywhere.
 * In-memory hair studio; received_at is Thursday 2031-03-13, 09:00 in São Paulo unless a case moves it. Invented names; no network or model.
 * The salon catalog is in the reader AND in the input (`catalog`): the resolver may read either. */
const escova: PilotServiceRow = { id: "srv-escova", name: "Escova modelada", durationMin: 45, priceCents: 7000 };
const hidratacao: PilotServiceRow = { id: "srv-hidratacao", name: "Hidratação capilar", durationMin: 60, priceCents: 9500 };
const camadas: PilotServiceRow = { id: "srv-camadas", name: "Corte em camadas", durationMin: 50, priceCents: 8000 };
const lisandra: PilotProfessionalRow = { id: "pro-lisandra", name: "Lisandra Pompeu", serviceIds: [escova.id, hidratacao.id, camadas.id] };
const thales: PilotProfessionalRow = { id: "pro-thales", name: "Thales Aranha", serviceIds: [escova.id, camadas.id] };
const person = (id: string, name: string): PilotPerson => ({ id, name });
const eudoxia = person("cli-eudoxia", "Eudóxia Marcondes"), filomeno = person("cli-filomeno", "Filomeno Bonfim"), cremilda = person("cli-cremilda", "Cremilda Caldas");
/** Thursday 2031-03-13 09:00 in São Paulo. */
const THU_AT = "2031-03-13T12:00:00.000Z";
const THU = "2031-03-13", FRI = "2031-03-14", SAT = "2031-03-15", SUN = "2031-03-16", MON = "2031-03-17", TUE = "2031-03-18", WED = "2031-03-19";
const NEXT_THU = "2031-03-20", NEXT_FRI = "2031-03-21", NEXT_TUE = "2031-03-25";
/** Eudóxia: an escova on Tuesday, a hidratação on Friday and another on the Tuesday after. */
const eudoxiaRows = () => [booked("apt-eu-escova", eudoxia, lisandra, escova, TUE, "10:00"), booked("apt-eu-hidra", eudoxia, lisandra, hidratacao, FRI, "14:00"),
  booked("apt-eu-hidra-2", eudoxia, lisandra, hidratacao, NEXT_TUE, "11:00")];
/** Filomeno: one appointment on each of the next seven local days (today's later than received_at). */
const filomenoWeek = () => [booked("apt-fi-thu", filomeno, thales, camadas, THU, "15:00"), ...[FRI, SAT, SUN, MON, TUE, WED].map(date => booked(`apt-fi-${date}`, filomeno, thales, camadas, date, "10:00"))];
const studio = (over: MemorySalon = {}): MemorySalon => ({ customers: [eudoxia, filomeno, cremilda], team: [lisandra, thales], catalog: [escova, hidratacao, camadas],
  hours: { [lisandra.id]: everyDay(["08:00", "20:00"]), [thales.id]: everyDay(["08:00", "20:00"]) }, appointments: [...eudoxiaRows(), ...filomenoWeek()], ...over });
const at = (iso = THU_AT) => clockAt(iso);
const locate = (salon: MemorySalon, customerId: string, origem: E2aOrigin, message: string, clock = at(), among?: string[]) =>
  resolveAppointment(memoryReader(salon), wire<Parameters<typeof resolveAppointment>[1]>({ customerId, origem, message, catalog: salon.catalog ?? [], ...(among ? { among } : {}) }), clock);
/** SERVICE-1: an appointment with several service items (the first is Appointment.serviceId; every item's service is carried in serviceIds). */
const combo = (id: string, customer: PilotPerson, professional: PilotProfessionalRow, services: PilotServiceRow[], date: string, clock: string) =>
  ({ ...booked(id, customer, professional, services[0], date, clock), serviceIds: services.map(service => service.id), serviceName: services.map(service => service.name).join(" + ") });
const ids = (rows: readonly { id: string }[]) => rows.map(row => row.id).sort();
const idOf = (result: PilotAppointmentResolution) => result.state === "one" ? result.appointment.id : null;
const optionsOf = (result: PilotAppointmentResolution) => result.state === "several" ? ids(result.options) : result.state === "none" ? ids(result.upcoming) : [];
const target = (dia: E2aDay | null, origin: string, clock = at(), time?: string) => resolveTargetDate(wire<PilotTempoDia>(dia), { date: origin }, clock, time ? { time } : {});
/** The Portuguese word of each enum value as an owner would write it (only for building messages and mentions; the code never reads them). */
const SAID: Record<E2aWeekday, string> = { segunda: "segunda", terca: "terça", quarta: "quarta", quinta: "quinta", sexta: "sexta", sabado: "sábado", domingo: "domingo" };

describe("E2-A §10.2 destination weekday: the enum, received_at frozen, the salon's timezone", () => {
  it("each of the seven values is the first such day after today (origin today, no clock): Thursday received_at", () => {
    const expected: Record<E2aWeekday, string> = { segunda: MON, terca: TUE, quarta: WED, quinta: NEXT_THU, sexta: FRI, sabado: SAT, domingo: SUN };
    for (const day of E2A_WEEKDAYS)
      expect(target(e2aDay(day, `pra ${SAID[day]}`), THU), day).toEqual({ state: "one", date: expected[day], provenance: "explicit", mencao: `pra ${SAID[day]}` });
  });
  it("each of the seven values from a Sunday received_at (another table row, so an off-by-one cannot hide)", () => {
    const sunday = at("2031-03-16T13:00:00.000Z");
    const expected: Record<E2aWeekday, string> = { segunda: MON, terca: TUE, quarta: WED, quinta: NEXT_THU, sexta: NEXT_FRI, sabado: "2031-03-22", domingo: "2031-03-23" };
    for (const day of E2A_WEEKDAYS) expect(target(e2aDay(day, SAID[day]), SUN, sunday), day).toMatchObject({ state: "one", date: expected[day] });
  });
  it("the salon's local day of received_at counts, never the UTC day (22:30 on Thursday in São Paulo is already Friday in UTC)", () => {
    const late = at("2031-03-14T01:30:00.000Z");
    expect(target(e2aDay("sexta", "sexta"), THU, late)).toMatchObject({ state: "one", date: FRI });
    expect(target(e2aDay("sexta", "nesta sexta", "este"), THU, late)).toMatchObject({ state: "one", date: FRI });
    expect(target(e2aDay("quinta", "quinta"), THU, late)).toMatchObject({ state: "one", date: NEXT_THU });
  });
  it("decision 27 unchanged: the first after today and the first after the original day differ → asked with both; 'este' takes the first; 'proximo' asks", () => {
    expect(target(e2aDay("sexta", "sexta"), SAT)).toEqual({ state: "ask", options: [FRI, NEXT_FRI], reason: "TWO_READINGS", mencao: "sexta" });
    expect(target(e2aDay("sexta", "nesta sexta", "este"), SAT)).toMatchObject({ state: "one", date: FRI });
    expect(target(e2aDay("sexta", "na próxima sexta", "proximo"), SAT)).toMatchObject({ state: "ask", options: [FRI, NEXT_FRI] });
    expect(target(e2aDay("sexta", "sexta"), THU)).toMatchObject({ state: "one", date: FRI });
  });
  it("today's weekday: today is a reading only while the known clock is ahead of received_at; 'proximo' never reads today", () => {
    expect(target(e2aDay("quinta", "quinta"), THU, at(), "15:00")).toMatchObject({ state: "ask", options: [THU, NEXT_THU] });
    expect(target(e2aDay("quinta", "nesta quinta", "este"), THU, at(), "15:00")).toMatchObject({ state: "ask", options: [THU, NEXT_THU] });
    expect(target(e2aDay("quinta", "quinta"), THU, at(), "08:00")).toMatchObject({ state: "one", date: NEXT_THU });
    expect(target(e2aDay("quinta", "quinta que vem", "proximo"), THU, at(), "15:00")).toMatchObject({ state: "one", date: NEXT_THU });
  });
  it("the code never re-reads the mention to find the day: the enum decides even when the copied words name another weekday", () => {
    expect(target(e2aDay("sexta", "na terça"), THU)).toMatchObject({ state: "one", date: FRI });
    expect(target(e2aDay("domingo", "segunda-feira"), THU)).toMatchObject({ state: "one", date: SUN });
  });
});

describe("E2-A §10.2 origin weekday: the enum filters the customer's appointments", () => {
  it("each of the seven values picks the appointment of that weekday among one per day", async () => {
    const expected: Record<E2aWeekday, string> = { quinta: "apt-fi-thu", sexta: `apt-fi-${FRI}`, sabado: `apt-fi-${SAT}`, domingo: `apt-fi-${SUN}`, segunda: `apt-fi-${MON}`,
      terca: `apt-fi-${TUE}`, quarta: `apt-fi-${WED}` };
    for (const day of E2A_WEEKDAYS) {
      const mencao = `a de ${SAID[day]}`, result = await locate(studio(), filomeno.id, e2aOrigin({ dia: e2aDay(day, mencao) }), `${mencao} do Filomeno vai pra outro horário`);
      expect(result, day).toMatchObject({ state: "one", provenance: "derived" });
      expect(idOf(result), day).toBe(expected[day]);
    }
  });
  it("an origin 'este' is the first such day from today on, today included; without it every such day ahead is a candidate", async () => {
    const salon = studio({ appointments: [...filomenoWeek(), booked("apt-fi-next-thu", filomeno, thales, camadas, NEXT_THU, "10:00")] });
    expect(idOf(await locate(salon, filomeno.id, e2aOrigin({ dia: e2aDay("quinta", "desta quinta", "este") }), "a desta quinta do Filomeno passa pra sábado"))).toBe("apt-fi-thu");
    expect(optionsOf(await locate(salon, filomeno.id, e2aOrigin({ dia: e2aDay("quinta", "de quinta") }), "a de quinta do Filomeno passa pra sábado"))).toEqual(["apt-fi-next-thu", "apt-fi-thu"]);
  });
  it("the enum decides even when the copied words name another weekday (the words only prove the hint came from the owner)", async () => {
    const result = await locate(studio(), filomeno.id, e2aOrigin({ dia: e2aDay("sabado", "a de domingo") }), "a de domingo do Filomeno vai pra quarta");
    expect(idOf(result)).toBe(`apt-fi-${SAT}`);
  });
  it("narrow provenance unchanged: a weekday hint whose words are not in the message never chooses", async () => {
    const proven = await locate(studio(), filomeno.id, e2aOrigin({ dia: e2aDay("sexta", "a de sexta") }), "a de sexta do Filomeno vai pra outro horário");
    expect(idOf(proven), "control: the words in the message").toBe(`apt-fi-${FRI}`);
    const result = await locate(studio(), filomeno.id, e2aOrigin({ dia: e2aDay("sexta", "a de sexta") }), "o Filomeno vai pra outro horário");
    expect(result.state).toBe("several");
    expect(result.state === "several" && result.ignored).toContain("dia");
  });
});

describe("E2-A §10.3 the service as a factual hint of the existing appointment", () => {
  const eu = (servico: E2aOrigin["servico"], message: string, extra: Partial<E2aOrigin> = {}, salon = studio()) => locate(salon, eudoxia.id, e2aOrigin({ servico, ...extra }), message);
  it("one compatible appointment: bound (derived) and the hint is used", async () => {
    const result = await eu(e2aService("a escova", ["Escova modelada"]), "Passa a escova da Eudóxia pra sábado às 11h");
    expect(result).toMatchObject({ state: "one", provenance: "derived" });
    expect(idOf(result)).toBe("apt-eu-escova");
    expect(result.state === "one" && result.used).toContain("servico");
  });
  it("two or more compatible: asked with exactly those real appointments (never a pick among them)", async () => {
    const result = await eu(e2aService("a hidratação", ["Hidratação capilar"]), "A hidratação da Eudóxia vai pra segunda");
    expect(result).toMatchObject({ state: "several", provenance: "unresolved" });
    expect(optionsOf(result)).toEqual(["apt-eu-hidra", "apt-eu-hidra-2"]);
    const both = await eu(e2aService("o tratamento", ["Hidratação capilar", "Escova modelada"]), "O tratamento da Eudóxia muda de dia");
    expect(optionsOf(both)).toEqual(["apt-eu-escova", "apt-eu-hidra", "apt-eu-hidra-2"]);
  });
  it("agreeing with the other hints narrows to one (a weekday with two such days, the service picks the one)", async () => {
    const result = await eu(e2aService("a hidratação", ["Hidratação capilar"]), "A hidratação de terça da Eudóxia vai pra sábado", { dia: e2aDay("terca", "de terça") });
    expect(idOf(result)).toBe("apt-eu-hidra-2");
  });
  it("none compatible: asked showing her appointments; with a single appointment too (never bound against the owner's words)", async () => {
    const none = await eu(e2aService("o corte", ["Corte em camadas"]), "O corte da Eudóxia vai pra sábado");
    expect(none).toMatchObject({ state: "none", provenance: "unresolved" });
    expect(optionsOf(none)).toEqual(["apt-eu-escova", "apt-eu-hidra", "apt-eu-hidra-2"]);
    const single = studio({ appointments: [booked("apt-cre", cremilda, thales, escova, FRI, "16:00")] });
    const contradicted = await locate(single, cremilda.id, e2aOrigin({ servico: e2aService("a hidratação", ["Hidratação capilar"]) }), "A hidratação da Cremilda vai pra sábado");
    expect(contradicted.state).toBe("none");
    expect(optionsOf(contradicted)).toEqual(["apt-cre"]);
  });
  it("a service that contradicts the appointment the other hints point at: asked showing her appointments, neither one picked in silence", async () => {
    expect(idOf(await eu(null, "A de sexta da Eudóxia vai pra sábado", { dia: e2aDay("sexta", "de sexta") })), "control: the day alone").toBe("apt-eu-hidra");
    const result = await eu(e2aService("a escova", ["Escova modelada"]), "A escova de sexta da Eudóxia vai pra sábado", { dia: e2aDay("sexta", "de sexta") });
    expect(result.state).toBe("none");
    expect(optionsOf(result)).toEqual(["apt-eu-escova", "apt-eu-hidra", "apt-eu-hidra-2"]);
  });
  it("unknown catalog names are dropped; the known ones still decide", async () => {
    const result = await eu(e2aService("a escova", ["Massagem com pedras quentes", "Escova modelada"]), "A escova da Eudóxia vai pra sábado");
    expect(idOf(result)).toBe("apt-eu-escova");
  });
  it("PRINCIPLE-1: an empty catalogo, or only unknown names, with the mention proven, matches no appointment: asked showing hers, a single one too", async () => {
    expect(idOf(await eu(e2aService("a escova", ["Escova modelada"]), "A escova da Eudóxia vai pra sábado")), "control: a known name").toBe("apt-eu-escova");
    for (const catalogo of [[], ["Escova progressiva"], ["Banho de lua"]]) {
      const result = await eu(e2aService("a escova", catalogo), "A escova da Eudóxia vai pra sábado");
      expect(result.state, JSON.stringify(catalogo)).toBe("none");
      expect(optionsOf(result), JSON.stringify(catalogo)).toEqual(["apt-eu-escova", "apt-eu-hidra", "apt-eu-hidra-2"]);
      expect(result.state === "none" && result.used, JSON.stringify(catalogo)).toContain("servico");
    }
    // The finding's probe: her ONLY appointment is of another service and the owner named one the salon does not have: asked, never bound.
    const single = studio({ appointments: [booked("apt-cre", cremilda, thales, escova, FRI, "16:00")] });
    for (const catalogo of [[], ["Escova progressiva"]]) {
      const result = await locate(single, cremilda.id, e2aOrigin({ servico: e2aService("a progressiva", catalogo) }), "A progressiva da Cremilda vai pro domingo às 10h");
      expect(result.state, JSON.stringify(catalogo)).toBe("none");
      expect(optionsOf(result), JSON.stringify(catalogo)).toEqual(["apt-cre"]);
    }
    // Same outcome as a known but wrong name (the more honest reading is never the less safe one).
    expect((await locate(single, cremilda.id, e2aOrigin({ servico: e2aService("a progressiva", ["Hidratação capilar"]) }), "A progressiva da Cremilda vai pro domingo")).state).toBe("none");
  });
  it("PRINCIPLE-1: an unproven service mention with no catalog name is ignored like any unproven hint (never narrows, never empties)", async () => {
    const result = await eu(e2aService("a escova", []), "A da Eudóxia vai pra sábado");
    expect(result.state).toBe("several");
    expect(result.state === "several" && result.ignored).toContain("servico");
    const single = studio({ appointments: [booked("apt-cre", cremilda, thales, escova, FRI, "16:00")] });
    expect(idOf(await locate(single, cremilda.id, e2aOrigin({ servico: e2aService("a escova", []) }), "A da Cremilda vai pra sábado"))).toBe("apt-cre");
  });
  it("no token similarity: a mention sharing words with a catalog name, with catalogo [], is never matched by its words (asked showing hers)", async () => {
    expect(idOf(await eu(e2aService("escova modelada", ["Escova modelada"]), "A escova modelada da Eudóxia vai pra sábado")), "control: the typed name").toBe("apt-eu-escova");
    for (const mencao of ["escova modelada", "Escova", "modelada", "escova da modelada"]) {
      const result = await eu(e2aService(mencao, []), `A ${mencao} da Eudóxia vai pra sábado`);
      expect(result.state, mencao).toBe("none");
      expect(optionsOf(result), mencao).toEqual(["apt-eu-escova", "apt-eu-hidra", "apt-eu-hidra-2"]);
    }
  });
  it("catalog-name equality is normalized for case and accents only: a part, a superset or another letter is an unknown name", async () => {
    for (const name of ["ESCOVA MODELADA", "escova modelada", "Escova Modelada"])
      expect(idOf(await eu(e2aService("a escova", [name]), "A escova da Eudóxia vai pra sábado")), name).toBe("apt-eu-escova");
    for (const name of ["HIDRATAÇÃO CAPILAR", "hidratacao capilar"])
      expect(optionsOf(await eu(e2aService("a hidratação", [name]), "A hidratação da Eudóxia vai pra sábado")), name).toEqual(["apt-eu-hidra", "apt-eu-hidra-2"]);
    for (const name of ["Escova", "Escova modelada longa", "Escova modelado", "Modelada escova"]) {
      const result = await eu(e2aService("a escova", [name]), "A escova da Eudóxia vai pra sábado");
      expect(result.state, name).toBe("none");
    }
  });
  it("narrow provenance applies to servico.mencao: words absent from the message never choose (ignored, every option asked)", async () => {
    const result = await eu(e2aService("a escova", ["Escova modelada"]), "A da Eudóxia vai pra sábado");
    expect(result.state).toBe("several");
    expect(result.state === "several" && result.ignored).toContain("servico");
  });
  it("the typed catalog names decide, never the copied words (a mention naming another service only proves the hint is the owner's)", async () => {
    const result = await eu(e2aService("a do corte", ["Escova modelada"]), "A do corte da Eudóxia vai pra sábado");
    expect(idOf(result)).toBe("apt-eu-escova");
  });
  it("the filter is by the service of the appointment row (its id), whatever the professional or the day", async () => {
    const mixed = studio({ appointments: [booked("apt-eu-a", eudoxia, thales, escova, MON, "09:00"), booked("apt-eu-b", eudoxia, lisandra, camadas, MON, "15:00")] });
    expect(idOf(await eu(e2aService("o corte", ["Corte em camadas"]), "O corte da Eudóxia vai pra quarta", {}, mixed))).toBe("apt-eu-b");
    expect(idOf(await eu(e2aService("a escova", ["Escova modelada"]), "A escova da Eudóxia vai pra quarta", {}, mixed))).toBe("apt-eu-a");
  });
});

describe("E2-A review SERVICE-1: an appointment with several services is found by any of them (exact ids, never names)", () => {
  /** Cremilda: a combo on Friday (Corte em camadas first, then Hidratação capilar) and, on Tuesday, a Hidratação capilar alone. */
  const both = () => studio({ appointments: [combo("apt-cre-combo", cremilda, lisandra, [camadas, hidratacao], FRI, "10:00"),
    booked("apt-cre-solo", cremilda, lisandra, hidratacao, TUE, "15:00")] });
  const lone = () => studio({ appointments: [combo("apt-cre-combo", cremilda, lisandra, [camadas, hidratacao], FRI, "10:00")] });
  const cre = (salon: MemorySalon, servico: E2aOrigin["servico"], message: string) => locate(salon, cremilda.id, e2aOrigin({ servico }), message);
  it("the combo plus a lone appointment of its second service: both hold the named service, so the owner is asked with both", async () => {
    const result = await cre(both(), e2aService("a hidratação", ["Hidratação capilar"]), "A hidratação da Cremilda vai pra quarta às 15h");
    expect(result.state).toBe("several");
    expect(optionsOf(result)).toEqual(["apt-cre-combo", "apt-cre-solo"]);
  });
  it("a lone combo named by its second service is bound (no question); named by its first, too", async () => {
    expect(idOf(await cre(lone(), e2aService("a hidratação", ["Hidratação capilar"]), "A hidratação da Cremilda vai pra quarta às 15h"))).toBe("apt-cre-combo");
    expect(idOf(await cre(lone(), e2aService("o corte", ["Corte em camadas"]), "O corte da Cremilda vai pra quarta às 15h"))).toBe("apt-cre-combo");
  });
  it("a service the combo does not hold still matches nothing; with the combo plus a solo, its first service picks only the combo", async () => {
    expect((await cre(lone(), e2aService("a escova", ["Escova modelada"]), "A escova da Cremilda vai pra quarta")).state).toBe("none");
    expect(idOf(await cre(both(), e2aService("o corte", ["Corte em camadas"]), "O corte da Cremilda vai pra quarta"))).toBe("apt-cre-combo");
  });
});

describe("E2-A review FLOW-1: `among` resolves an answer only among the asked question's options", () => {
  const options = [`apt-fi-${FRI}`, `apt-fi-${SAT}`];
  it("the answer's own hint picks one option; a hint matching none of them is none, listing exactly those options", async () => {
    const one = await locate(studio(), filomeno.id, e2aOrigin({ dia: e2aDay("sabado", "o de sábado") }), "é o de sábado", at(), options);
    expect(one).toMatchObject({ state: "one", used: ["dia"] });
    expect(idOf(one)).toBe(`apt-fi-${SAT}`);
    const none = await locate(studio(), filomeno.id, e2aOrigin({ dia: e2aDay("domingo", "o de domingo") }), "é o de domingo", at(), options);
    expect(none.state).toBe("none");
    expect(optionsOf(none)).toEqual(options.slice().sort());
  });
  it("no hint from the answer: every option stays (several), nothing used", async () => {
    const result = await locate(studio(), filomeno.id, e2aOrigin(), "esse mesmo", at(), options);
    expect(result).toMatchObject({ state: "several", used: [] });
    expect(optionsOf(result)).toEqual(options.slice().sort());
  });
  it("options that are no longer future appointments of hers leave the resolution to all her appointments, listed as none", async () => {
    const result = await locate(studio(), filomeno.id, e2aOrigin({ dia: e2aDay("sabado", "o de sábado") }), "é o de sábado", at(), ["apt-gone"]);
    expect(result.state).toBe("none");
    expect(optionsOf(result)).toHaveLength(7);
  });
});
