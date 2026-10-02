import { describe, expect, it } from "vitest";
import { resolveTargetDate, resolveTargetTime, type PilotProfessionalRow } from "../secretary-pilot-resolver";
import type { PilotTempoDia, PilotTempoHora, PilotWeekday } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { clockAt, everyDay, memoryReader } from "../../test/secretary-pilot-reader";

/** Reschedule pilot, E1 unit tests written before the code (docs/c5-spike/12-piloto-remarcacao.md §3.3, §3.4, §7 "Unidade"): every day and
 * clock operator computed from the frozen received_at in the salon's timezone (never the server's), decision 27 (a weekday with two plausible
 * readings asks with both dates; "este" takes the first) and decision 18 (a bare hour 1-11: the readings h and h+12 filtered by that day's
 * working hours; one left is used and shown as derived, two or none are asked). received_at: Monday 2031-03-10, 09:00 in São Paulo. No network,
 * database or model. */
const MON = "2031-03-10", WED = "2031-03-12", FRI = "2031-03-14", NEXT_MON = "2031-03-17", NEXT_FRI = "2031-03-21";
const day = (tempo: PilotTempoDia | null, originDate = WED, at?: string) => resolveTargetDate(tempo, { date: originDate }, clockAt(at));
const data = (dia: number, mes: number | null = null): PilotTempoDia => ({ tipo: "data", dia, mes, mencao: mes ? `${dia}/${mes}` : `dia ${dia}` });
const weekday = (dia_semana: PilotWeekday, qualificador: "este" | "proximo" | null = null): PilotTempoDia => ({ tipo: "dia_semana", dia_semana, qualificador, mencao: `dia ${dia_semana}` });
/** E2-B §11.1: a day counted from today is the offset anchored on "hoje" (it replaces the E2-A operator; derived, shown in the proposal). */
const relative = (dias: number): PilotTempoDia => ({ tipo: "deslocamento", quantidade: dias, unidade: "dias", ancoras: ["hoje"], data_citada: null, mencao: `daqui ${dias}` });

describe("§3.3 target day: every operator from the frozen received_at, in the salon's timezone", () => {
  it("data without a month: the next occurrence from today on (today counts); a day the month lacks goes to the next month that has it", () => {
    expect(day(data(14))).toEqual({ state: "one", date: FRI, provenance: "explicit", mencao: "dia 14" });
    expect(day(data(10))).toMatchObject({ state: "one", date: MON, provenance: "explicit" });
    expect(day(data(3))).toMatchObject({ state: "one", date: "2031-04-03" });
    expect(day(data(31))).toMatchObject({ state: "one", date: "2031-03-31" });
    expect(day(data(31), WED, "2031-04-10T12:00:00.000Z")).toMatchObject({ state: "one", date: "2031-05-31" });
  });
  it("data with a month: that day this year, or next year once it has passed; a date that does not exist is invalid", () => {
    expect(day(data(20, 4))).toMatchObject({ state: "one", date: "2031-04-20", provenance: "explicit" });
    expect(day(data(5, 1))).toMatchObject({ state: "one", date: "2032-01-05", provenance: "explicit" });
    expect(day(data(31, 2))).toEqual({ state: "invalid", reason: "NO_SUCH_DATE", mencao: "31/2" });
  });
  it("a day offset anchored on today (§11.1): today + n, counted on the salon's local day (23:30 in São Paulo is still that day); derived", () => {
    expect(day(relative(0))).toMatchObject({ state: "one", date: MON, provenance: "derived" });
    expect(day(relative(1))).toMatchObject({ state: "one", date: "2031-03-11", provenance: "derived" });
    expect(day(relative(3))).toMatchObject({ state: "one", date: "2031-03-13" });
    const lateEvening = "2031-03-11T02:30:00.000Z";
    expect(day(relative(1), WED, lateEvening)).toMatchObject({ state: "one", date: "2031-03-11" });
    expect(day(data(10), WED, lateEvening)).toMatchObject({ state: "one", date: MON });
  });
  it("mesmo_da_origem is the original day (inherited); an offset anchored on the origin adds to it (derived); a day not said keeps the original (inherited)", () => {
    expect(day({ tipo: "mesmo_da_origem", mencao: "no mesmo dia" })).toEqual({ state: "one", date: WED, provenance: "inherited", mencao: "no mesmo dia" });
    expect(day({ tipo: "deslocamento", quantidade: 7, unidade: "dias", ancoras: ["origem"], data_citada: null, mencao: "uma semana pra frente" })).toEqual({ state: "one", date: "2031-03-19", provenance: "derived", mencao: "uma semana pra frente" });
    expect(day({ tipo: "deslocamento", quantidade: 2, unidade: "dias", ancoras: ["origem"], data_citada: null, mencao: "dois dias depois" }, FRI)).toMatchObject({ state: "one", date: "2031-03-16", provenance: "derived" });
    expect(day(null)).toEqual({ state: "one", date: WED, provenance: "inherited" });
  });
});

describe("decision 27: a weekday with two plausible readings is asked, never chosen in silence", () => {
  it("no qualifier: the first after today and the first after the original day; equal → that day, explicit; different → both asked", () => {
    expect(day(weekday("sexta"), WED)).toMatchObject({ state: "one", date: FRI, provenance: "explicit" });
    expect(day(weekday("sexta"), NEXT_MON)).toEqual({ state: "ask", options: [FRI, NEXT_FRI], reason: "TWO_READINGS", mencao: "dia sexta" });
    expect(day(weekday("sexta"), FRI)).toEqual({ state: "ask", options: [FRI, NEXT_FRI], reason: "TWO_READINGS", mencao: "dia sexta" });
  });
  it("'este' takes the first reading; 'proximo' asks as no qualifier does when the readings differ", () => {
    expect(day(weekday("sexta", "este"), NEXT_MON)).toMatchObject({ state: "one", date: FRI, provenance: "explicit" });
    expect(day(weekday("sexta", "proximo"), WED)).toMatchObject({ state: "one", date: FRI });
    expect(day(weekday("sexta", "proximo"), NEXT_MON)).toMatchObject({ state: "ask", options: [FRI, NEXT_FRI] });
  });
  it("'after today' never means today; the weekday is the typed name (E2-A enum, segunda … domingo)", () => {
    expect(day(weekday("segunda"), WED)).toMatchObject({ state: "one", date: NEXT_MON });
    expect(day(weekday("domingo"), WED)).toMatchObject({ state: "one", date: "2031-03-16" });
    expect(day(weekday("sabado"), WED)).toMatchObject({ state: "one", date: "2031-03-15" });
    expect(day(weekday("quarta"), WED)).toEqual({ state: "ask", options: [WED, "2031-03-19"], reason: "TWO_READINGS", mencao: "dia quarta" });
  });
});

const carlos: PilotProfessionalRow = { id: "pro-carlos", name: "Carlos Imbiriba", serviceIds: [] };
const dalva: PilotProfessionalRow = { id: "pro-dalva", name: "Dalva Nascimento", serviceIds: [] };
const kaito: PilotProfessionalRow = { id: "pro-kaito", name: "Kaito Arruda", serviceIds: [] };
const salon = () => memoryReader({ team: [carlos, dalva, kaito], hours: {
  [carlos.id]: { ...everyDay(["09:00", "18:00"]), "6": [{ start: 480, end: 720 }] },
  [dalva.id]: everyDay(["08:00", "21:00"]),
  [kaito.id]: everyDay(["09:00", "12:00"], ["14:00", "18:00"]) } });
const relogio = (hora: number, minuto = 0, periodo: "manha" | "tarde" | "noite" | null = null): PilotTempoHora => ({ tipo: "relogio", hora, minuto, periodo, mencao: `${hora}h${minuto || ""}` });
const time = (hora: PilotTempoHora | null, professionalId: string | null = carlos.id, date = FRI, reader = salon()) =>
  resolveTargetTime(reader, hora, { origin: { date: WED, time: "10:00" }, date, professionalId });

describe("§3.4 target clock", () => {
  it("12-23 is the hour said; a period says which half of the day, never filtered by the hours", async () => {
    expect(await time(relogio(15))).toEqual({ state: "one", time: "15:00", provenance: "explicit", mencao: "15h" });
    expect(await time(relogio(12))).toMatchObject({ state: "one", time: "12:00", provenance: "explicit" });
    expect(await time(relogio(16, 45))).toMatchObject({ state: "one", time: "16:45", provenance: "explicit" });
    expect(await time(relogio(3, 0, "tarde"))).toMatchObject({ state: "one", time: "15:00", provenance: "explicit" });
    expect(await time(relogio(9, 0, "manha"))).toMatchObject({ state: "one", time: "09:00", provenance: "explicit" });
    expect(await time(relogio(8, 0, "noite"))).toMatchObject({ state: "one", time: "20:00", provenance: "explicit" });
  });
  it("decision 18, one reading inside the professional's hours that day: used and shown as derived", async () => {
    expect(await time(relogio(4))).toEqual({ state: "one", time: "16:00", provenance: "derived", mencao: "4h" });
    expect(await time(relogio(10))).toMatchObject({ state: "one", time: "10:00", provenance: "derived" });
    expect(await time(relogio(2, 30))).toMatchObject({ state: "one", time: "14:30", provenance: "derived" });
  });
  it("decision 18, both readings inside the hours: asked with both; none inside (a break included): asked too", async () => {
    expect(await time(relogio(8), dalva.id)).toEqual({ state: "ask", options: ["08:00", "20:00"], reason: "TWO_READINGS", mencao: "8h" });
    expect(await time(relogio(1), kaito.id)).toEqual({ state: "none", readings: ["01:00", "13:00"], reason: "NO_READING_IN_HOURS", mencao: "1h" });
    expect(await time(relogio(7), carlos.id)).toMatchObject({ state: "none", readings: ["07:00", "19:00"] });
  });
  it("decision 18 reads the hours of THAT professional on THAT day, or the salon's (all professionals) when none is set", async () => {
    const reader = salon();
    expect(await time(relogio(9), carlos.id, "2031-03-15", reader)).toMatchObject({ state: "one", time: "09:00", provenance: "derived" });
    const reads = reader.calls.filter(call => call.method === "workingWindows");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read.args).toEqual([carlos.id, "2031-03-15"]);
    expect(await time(relogio(8), null)).toMatchObject({ state: "ask", options: ["08:00", "20:00"] });
    expect(await time(relogio(8), carlos.id)).toMatchObject({ state: "none" });
  });
  it("mesmo_da_origem is the original clock (inherited); a clock offset anchored on the origin adds to it (derived); a_definir asks", async () => {
    expect(await time({ tipo: "mesmo_da_origem", mencao: "mesmo horário" })).toEqual({ state: "one", time: "10:00", provenance: "inherited", mencao: "mesmo horário" });
    expect(await time({ tipo: "deslocamento", minutos: 150, ancoras: ["origem"], mencao: "150 min mais tarde" })).toEqual({ state: "one", time: "12:30", provenance: "derived", mencao: "150 min mais tarde" });
    expect(await time({ tipo: "a_definir", mencao: "num horário a ver" })).toMatchObject({ state: "ask", reason: "TO_DEFINE", options: [] });
  });
  it("a clock not said: the original one on the original day (inherited); on a new day it is asked (decision 2)", async () => {
    expect(await time(null, carlos.id, WED)).toEqual({ state: "one", time: "10:00", provenance: "inherited" });
    expect(await time(null, carlos.id, FRI)).toEqual({ state: "ask", options: [], reason: "NOT_SAID" });
  });
});
