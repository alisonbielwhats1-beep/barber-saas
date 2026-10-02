import { describe, expect, it } from "vitest";
import { resolveAppointment, resolveCustomer, resolveProfessional, type PilotIdentity, type PilotPerson, type PilotProfessionalRow,
  type PilotServiceRow } from "../secretary-pilot-resolver";
import { decodePilotInterpretation, decodePilotInterpretationArguments, PilotContractError, PILOT_RESCHEDULE_PARAMETERS, PILOT_RESCHEDULE_TOOL,
  type PilotInterpretation, type PilotOrigin } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";

/** Reschedule pilot, E1 unit tests written before the code (docs/c5-spike/12-piloto-remarcacao.md §2, §3, §7 "Unidade"): the customer resolver in
 * its six states, the appointment (0, 1 or several, position in the day, the narrow provenance check), the professional (manter, nomeado,
 * qualquer; decision 15), properties (case, accents and context words never change an identity; the contract has no place for words Luna did not
 * put in a mention) and the strict §2 contract. In-memory reader of one synthetic esthetics studio; received_at is Monday 2031-03-10, 09:00 in
 * São Paulo. Invented names, services and sentences; no network, database or model. */
const limpeza: PilotServiceRow = { id: "srv-limpeza", name: "Limpeza de pele", durationMin: 50, priceCents: 12000 };
const sobrancelha: PilotServiceRow = { id: "srv-sobrancelha", name: "Design de sobrancelha", durationMin: 30, priceCents: 5500 };
const drenagem: PilotServiceRow = { id: "srv-drenagem", name: "Drenagem linfática", durationMin: 45, priceCents: 14000 };
const carlos: PilotProfessionalRow = { id: "pro-carlos", name: "Carlos Imbiriba", serviceIds: [limpeza.id, sobrancelha.id, drenagem.id] };
const dalva: PilotProfessionalRow = { id: "pro-dalva", name: "Dalva Nascimento", serviceIds: [limpeza.id, sobrancelha.id] };
const kaito: PilotProfessionalRow = { id: "pro-kaito", name: "Kaito Arruda", serviceIds: [drenagem.id] };
const person = (id: string, name: string): PilotPerson => ({ id, name });
const anaQ = person("cli-ana-quaresma", "Ana Quaresma"), anaB = person("cli-ana-bezerra", "Ana Bezerra"), bento = person("cli-bento", "Bento Ximenes");
const leopoldina = person("cli-leopoldina", "Leopoldina Siqueira"), iracema = person("cli-iracema", "Iracema Toledo"), wanderley = person("cli-wanderley", "Wanderley Brito");
const dores = person("cli-dores", "Maria das Dores Pinheiro"), jaeWon = person("cli-jae-won", "Jae-Won Kim");
const MON = "2031-03-10", TUE = "2031-03-11", WED = "2031-03-12", THU = "2031-03-13", FRI = "2031-03-14";
const iracemaRows = [
  booked("apt-ira-old", iracema, carlos, limpeza, "2031-03-03", "10:00"),
  booked("apt-ira-early", iracema, dalva, sobrancelha, MON, "08:00"),
  booked("apt-ira-cancelled", iracema, carlos, limpeza, TUE, "10:00", "CANCELLED"),
  booked("apt-ira-completed", iracema, dalva, sobrancelha, TUE, "15:00", "COMPLETED"),
  booked("apt-ira-wed", iracema, carlos, limpeza, WED, "10:00"),
  booked("apt-ira-thu", iracema, dalva, sobrancelha, THU, "14:00", "PENDING"),
];
const wanderleyRows = [
  booked("apt-wan-wed-am", wanderley, carlos, drenagem, WED, "09:00"),
  booked("apt-wan-wed-pm", wanderley, dalva, sobrancelha, WED, "16:00"),
  booked("apt-wan-fri", wanderley, carlos, limpeza, FRI, "10:00"),
];
const studio = (over: MemorySalon = {}): MemorySalon => ({
  customers: [anaQ, bento, leopoldina, iracema, wanderley, dores, jaeWon], team: [carlos, dalva, kaito], catalog: [limpeza, sobrancelha, drenagem],
  appointments: [...iracemaRows, ...wanderleyRows, booked("apt-bento", bento, dalva, limpeza, THU, "11:00"), booked("apt-leo-old", leopoldina, carlos, limpeza, "2031-03-05", "10:00")],
  hours: { [carlos.id]: everyDay(["09:00", "18:00"]), [dalva.id]: everyDay(["09:00", "18:00"]), [kaito.id]: everyDay(["09:00", "18:00"]) }, ...over });
const ids = (rows: readonly { id: string }[]) => rows.map(row => row.id).sort();
const bound = (result: PilotIdentity) => result.state === "exact" || result.state === "partial" ? result.id : null;
const ORIGIN: PilotOrigin = { dia: null, hora: null, profissional_mencao: null, servico_mencao: null, posicao: null };
const origin = (over: Partial<PilotOrigin>): PilotOrigin => ({ ...ORIGIN, ...over });
const weekdayHint = (dia_semana: number, mencao: string) => ({ tipo: "dia_semana" as const, dia_semana, qualificador: null, mencao });
const clockHint = (hora: number, mencao: string, minuto = 0) => ({ tipo: "relogio" as const, hora, minuto, periodo: null, mencao });
const locate = (salon: MemorySalon, customerId: string, origem: PilotOrigin, message: string) => resolveAppointment(memoryReader(salon), { customerId, origem, message }, clockAt());

describe("§3.1 customer: the six states", () => {
  it("exact: the mention's tokens equal the record's, in any order, accents and name particles aside; bound as explicit", async () => {
    const reader = memoryReader(studio());
    for (const mencao of ["Ana Quaresma", "quaresma ana"])
      expect(await resolveCustomer(reader, mencao)).toEqual({ state: "exact", id: anaQ.id, name: "Ana Quaresma", mencao, provenance: "explicit" });
    for (const mencao of ["Maria das Dores Pinheiro", "maria dores pinheiro"]) expect(await resolveCustomer(reader, mencao)).toMatchObject({ state: "exact", id: dores.id });
    expect(await resolveCustomer(reader, "jae won kim")).toMatchObject({ state: "exact", id: jaeWon.id, name: "Jae-Won Kim" });
  });
  it("partial: the mention's tokens are contained in ONE record, bound with the registered full name for the proposal", async () => {
    const reader = memoryReader(studio());
    expect(await resolveCustomer(reader, "Ana")).toEqual({ state: "partial", id: anaQ.id, name: "Ana Quaresma", mencao: "Ana", provenance: "explicit" });
    expect(await resolveCustomer(reader, "Quaresma")).toMatchObject({ state: "partial", id: anaQ.id, name: "Ana Quaresma" });
    expect(await resolveCustomer(reader, "Maria Pinheiro")).toMatchObject({ state: "partial", id: dores.id, name: "Maria das Dores Pinheiro" });
    expect(await resolveCustomer(reader, "Jae-Won")).toMatchObject({ state: "partial", id: jaeWon.id });
  });
  it("ambiguous: two or more records hold every token: asked with those real records, never a pick (a longer homonym of an exact name too)", async () => {
    const twoAnas = await resolveCustomer(memoryReader(studio({ customers: [anaQ, anaB, bento] })), "Ana");
    expect(twoAnas).toMatchObject({ state: "ambiguous", mencao: "Ana", provenance: "unresolved" });
    expect(twoAnas.state === "ambiguous" && ids(twoAnas.options)).toEqual(ids([anaQ, anaB]));
    expect(bound(twoAnas)).toBeNull();
    const longer = person("cli-ana-quaresma-lins", "Ana Quaresma Lins");
    const homonym = await resolveCustomer(memoryReader(studio({ customers: [anaQ, longer, bento] })), "Ana Quaresma");
    expect(homonym.state).toBe("ambiguous");
    expect(homonym.state === "ambiguous" && ids(homonym.options)).toEqual(ids([anaQ, longer]));
  });
  it("contradictory: the only record sharing the first name lacks the written surname: asked, never substituted", async () => {
    const reader = memoryReader(studio());
    const result = await resolveCustomer(reader, "Leopoldina Arantes");
    expect(result).toEqual({ state: "contradictory", candidate: leopoldina, mencao: "Leopoldina Arantes", provenance: "unresolved" });
    expect(bound(result)).toBeNull();
    expect(await resolveCustomer(reader, "Iracema Paiva")).toMatchObject({ state: "contradictory", candidate: iracema });
  });
  it("not found: nothing compatible is asked, with tolerant suggestions of real records when there are any; never bound", async () => {
    const reader = memoryReader(studio());
    expect(await resolveCustomer(reader, "Hermenegildo Castro")).toEqual({ state: "not_found", suggestions: [], mencao: "Hermenegildo Castro", provenance: "unresolved" });
    const typo = await resolveCustomer(reader, "Leopoldna");
    expect(typo.state).toBe("not_found");
    expect(typo.state === "not_found" && typo.suggestions.map(row => row.id)).toContain(leopoldina.id);
    expect(bound(typo)).toBeNull();
  });
  it("unavailable: a failing search is a safe error, never 'does not exist'", async () => {
    const result = await resolveCustomer(memoryReader(studio({ fail: { customers: true } })), "Ana Quaresma");
    expect(result).toEqual({ state: "unavailable", mencao: "Ana Quaresma", provenance: "unresolved" });
  });
});

describe("§3.2 appointment: located once, among the customer's future appointments", () => {
  it("only her PENDING or CONFIRMED appointments from received_at on are candidates (past, earlier today, cancelled and completed never)", async () => {
    const result = await locate(studio(), iracema.id, ORIGIN, "Muda a Iracema pra outro dia");
    expect(result).toMatchObject({ state: "several", provenance: "unresolved" });
    expect(result.state === "several" && ids(result.options)).toEqual(["apt-ira-thu", "apt-ira-wed"]);
  });
  it("0: nothing left is asked showing her next appointments; with none ahead, an empty list", async () => {
    const none = await locate(studio(), leopoldina.id, ORIGIN, "Passa a Leopoldina pra sexta");
    expect(none).toMatchObject({ state: "none", upcoming: [], provenance: "unresolved" });
    const message = "A da sexta da Iracema vai pro sábado";
    const wrongDay = await locate(studio(), iracema.id, origin({ dia: weekdayHint(6, "da sexta") }), message);
    expect(wrongDay.state).toBe("none");
    expect(wrongDay.state === "none" && ids(wrongDay.upcoming)).toEqual(["apt-ira-thu", "apt-ira-wed"]);
  });
  it("1: the single future appointment is bound as derived (shown in the proposal)", async () => {
    const result = await locate(studio(), bento.id, ORIGIN, "Bento vai pra sexta às 15h");
    expect(result).toMatchObject({ state: "one", provenance: "derived" });
    expect(result.state === "one" && result.appointment.id).toBe("apt-bento");
  });
  it("several: two or more left are asked with the real options", async () => {
    const result = await locate(studio(), wanderley.id, ORIGIN, "Empurra o Wanderley pra outra data");
    expect(result.state).toBe("several");
    expect(result.state === "several" && ids(result.options)).toEqual(["apt-wan-fri", "apt-wan-wed-am", "apt-wan-wed-pm"]);
  });
  it("position in the day: the day said narrows to that day, then first or last picks by start", async () => {
    const message = "Adia o último do Wanderley na quarta pra sexta";
    const last = await locate(studio(), wanderley.id, origin({ dia: weekdayHint(4, "na quarta"), posicao: "ultimo" }), message);
    expect(last.state === "one" && last.appointment.id).toBe("apt-wan-wed-pm");
    const first = await locate(studio(), wanderley.id, origin({ dia: weekdayHint(4, "na quarta"), posicao: "primeiro" }), "Adia o primeiro do Wanderley na quarta pra sexta");
    expect(first.state === "one" && first.appointment.id).toBe("apt-wan-wed-am");
    const sameDay = studio({ appointments: wanderleyRows.slice(0, 2) });
    const onlyPosition = await locate(sameDay, wanderley.id, origin({ posicao: "primeiro" }), "Adia o primeiro do Wanderley pra sexta");
    expect(onlyPosition.state === "one" && onlyPosition.appointment.id).toBe("apt-wan-wed-am");
  });
  it("narrow provenance: a professional hint chooses among 2+ only when its mention is in the message; absent, it is ignored and asked", async () => {
    const present = await locate(studio(), iracema.id, origin({ profissional_mencao: "Carlos" }), "Joga o horário da Iracema com o Carlos pra sexta de manhã");
    expect(present).toMatchObject({ state: "one", provenance: "derived" });
    expect(present.state === "one" && present.appointment.id).toBe("apt-ira-wed");
    expect(present.state === "one" && present.used).toContain("profissional");
    const absent = await locate(studio(), iracema.id, origin({ profissional_mencao: "Carlos" }), "Joga o horário da Iracema pra sexta de manhã");
    expect(absent.state).toBe("several");
    expect(absent.state === "several" && ids(absent.options)).toEqual(["apt-ira-thu", "apt-ira-wed"]);
    expect(absent.state === "several" && absent.ignored).toContain("profissional");
  });
  it("narrow provenance applies to day, clock (both readings of a bare hour) and service hints alike; the search is normalized", async () => {
    const day = await locate(studio(), iracema.id, origin({ dia: weekdayHint(5, "da quinta") }), "A da quinta da Iracema vai pro sábado às 10h");
    expect(day.state === "one" && day.appointment.id).toBe("apt-ira-thu");
    const dayAbsent = await locate(studio(), iracema.id, origin({ dia: weekdayHint(5, "da quinta") }), "A Iracema vai pro sábado às 10h");
    expect(dayAbsent.state === "several" && dayAbsent.ignored).toContain("dia");
    const bareHour = await locate(studio(), iracema.id, origin({ hora: clockHint(2, "das 2") }), "A das 2 da Iracema passa pro sábado");
    expect(bareHour.state === "one" && bareHour.appointment.id).toBe("apt-ira-thu");
    const service = await locate(studio(), iracema.id, origin({ servico_mencao: "Sobrancelha" }), "A SOBRANCELHA da Iracema fica pro sábado");
    expect(service.state === "one" && service.appointment.id).toBe("apt-ira-thu");
    const accents = await locate(studio(), wanderley.id, origin({ servico_mencao: "drenagem linfática" }), "A DRENAGEM LINFATICA do Wanderley sobe pra sexta");
    expect(accents.state === "one" && accents.appointment.id).toBe("apt-wan-wed-am");
  });
  it("the check never drops the action nor changes a value: an ignored hint leaves every real option asked", async () => {
    const result = await locate(studio(), iracema.id, origin({ profissional_mencao: "Dalva", servico_mencao: "sobrancelha" }), "Troca a Iracema de dia");
    expect(result.state).toBe("several");
    expect(result.state === "several" && ids(result.options)).toEqual(["apt-ira-thu", "apt-ira-wed"]);
    expect(result.state === "several" && [...result.ignored].sort()).toEqual(["profissional", "servico"]);
  });
  it("unavailable: a failing read is a safe error", async () => {
    expect(await locate(studio({ fail: { appointmentsOf: true } }), iracema.id, ORIGIN, "Muda a Iracema pra outro dia")).toEqual({ state: "unavailable", provenance: "unresolved" });
  });
});

describe("§3.5 professional: manter, nomeado, qualquer (decision 15)", () => {
  const appointment = iracemaRows[4];
  const context = (slot: { date: string; time: string } | null = { date: FRI, time: "10:00" }) =>
    ({ current: { id: carlos.id, name: carlos.name }, appointmentId: appointment.id, serviceId: limpeza.id, durationMin: limpeza.durationMin, slot });
  it("manter or not said: the current professional, inherited", async () => {
    for (const modo of ["manter", null] as const)
      expect(await resolveProfessional(memoryReader(studio()), { modo, mencao: null }, context())).toEqual({ state: "kept", id: carlos.id, name: carlos.name, provenance: "inherited" });
  });
  it("nomeado: resolved in the team with the customer's states (bound as explicit)", async () => {
    const reader = memoryReader(studio({ team: [carlos, dalva, kaito, { id: "pro-carlos-p", name: "Carlos Peçanha", serviceIds: [limpeza.id] }] }));
    expect(await resolveProfessional(reader, { modo: "nomeado", mencao: "Dalva Nascimento" }, context())).toMatchObject({ state: "exact", id: dalva.id, provenance: "explicit" });
    expect(await resolveProfessional(reader, { modo: "nomeado", mencao: "dalva" }, context())).toMatchObject({ state: "partial", id: dalva.id, name: dalva.name, provenance: "explicit" });
    expect(await resolveProfessional(reader, { modo: "nomeado", mencao: "Carlos" }, context())).toMatchObject({ state: "ambiguous", provenance: "unresolved" });
    expect(await resolveProfessional(reader, { modo: "nomeado", mencao: "Dalva Pires" }, context())).toMatchObject({ state: "contradictory", candidate: { id: dalva.id } });
    expect(await resolveProfessional(reader, { modo: "nomeado", mencao: "Zuleide" }, context())).toMatchObject({ state: "not_found" });
    expect(await resolveProfessional(memoryReader(studio({ fail: { team: true } })), { modo: "nomeado", mencao: "Dalva" }, context())).toMatchObject({ state: "unavailable" });
  });
  it("qualquer: who performs the service and is free for its whole duration, the fewest appointments that day; derived", async () => {
    const day = (extra: ReturnType<typeof booked>[]) => studio({ appointments: [...iracemaRows, ...extra] });
    const busier = day([booked("x-c1", bento, carlos, limpeza, FRI, "13:00"), booked("x-c2", wanderley, carlos, limpeza, FRI, "15:00"), booked("x-d1", bento, dalva, sobrancelha, FRI, "16:00")]);
    expect(await resolveProfessional(memoryReader(busier), { modo: "qualquer", mencao: null }, context())).toEqual({ state: "chosen", id: dalva.id, name: dalva.name, provenance: "derived" });
    const dalvaOverlaps = day([booked("x-c1", bento, carlos, limpeza, FRI, "13:00"), booked("x-d1", bento, dalva, sobrancelha, FRI, "10:30")]);
    expect(await resolveProfessional(memoryReader(dalvaOverlaps), { modo: "qualquer", mencao: null }, context())).toMatchObject({ state: "chosen", id: carlos.id });
    // Kaito is free all day but does not perform the service: never chosen.
    const nobody = day([booked("x-c1", bento, carlos, drenagem, FRI, "10:30"), booked("x-d1", wanderley, dalva, sobrancelha, FRI, "09:45")]);
    expect(await resolveProfessional(memoryReader(nobody), { modo: "qualquer", mencao: null }, context())).toEqual({ state: "nobody_free", provenance: "unresolved" });
  });
  it("qualquer: the appointment being moved never blocks its own slot; before the day and clock are known it waits", async () => {
    const sameDay = studio({ appointments: [...iracemaRows, booked("x-d1", bento, dalva, sobrancelha, WED, "13:00"), booked("x-d2", wanderley, dalva, sobrancelha, WED, "15:00")] });
    expect(await resolveProfessional(memoryReader(sameDay), { modo: "qualquer", mencao: null }, context({ date: WED, time: "10:30" }))).toMatchObject({ state: "chosen", id: carlos.id });
    expect(await resolveProfessional(memoryReader(studio()), { modo: "qualquer", mencao: null }, context(null))).toEqual({ state: "waiting", provenance: "unresolved" });
  });
});

/** Deterministic pseudo-random source (mulberry32) for the property tests. */
function random(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ACCENTED: Record<string, string> = { a: "áàâã", e: "éê", i: "í", o: "óôõ", u: "úü", c: "ç" };
/** The same mention with case changed and accents added or removed at random (never another letter). */
function respell(text: string, next: () => number) {
  return [...text.normalize("NFD").replace(/\p{M}/gu, "")].map(char => {
    const lower = char.toLowerCase(), marks = ACCENTED[lower];
    const letter = marks && next() < 0.4 ? marks[Math.floor(next() * marks.length)] : lower;
    return next() < 0.5 ? letter.toUpperCase() : letter;
  }).join("");
}
/** A run of pseudo-words that contains none of the given mentions (context words Luna did not copy into a mention). */
function noise(next: () => number, avoid: readonly string[]) {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  for (;;) {
    const words = Array.from({ length: 1 + Math.floor(next() * 4) }, () => Array.from({ length: 3 + Math.floor(next() * 6) }, () => String.fromCharCode(97 + Math.floor(next() * 26))).join(""));
    const text = words.join(" ");
    if (!avoid.some(mention => fold(text).includes(fold(mention)))) return text;
  }
}

describe("properties: identity changes only when the mention really changes", () => {
  it("case and accents of a mention never change the state or the record, in every state", async () => {
    const next = random(20311003), reader = memoryReader(studio({ customers: [anaQ, anaB, bento, leopoldina, dores, jaeWon] }));
    for (const mencao of ["Ana Quaresma", "Quaresma", "Ana", "Leopoldina Arantes", "Maria Dores", "Jae-Won Kim", "Hermenegildo"]) {
      const expected = await resolveCustomer(reader, mencao);
      for (let round = 0; round < 12; round++) {
        const variant = respell(mencao, next), got = await resolveCustomer(reader, variant);
        expect({ ...got, mencao }, `${mencao} → ${variant}`).toEqual(expected);
      }
    }
    const team = memoryReader(studio());
    for (const mencao of ["Dalva", "Carlos Imbiriba", "Dalva Pires"]) {
      const expected = await resolveProfessional(team, { modo: "nomeado", mencao }, { current: carlos, appointmentId: "apt-ira-wed", serviceId: limpeza.id, durationMin: 50, slot: null });
      for (let round = 0; round < 8; round++) {
        const variant = respell(mencao, next);
        const got = await resolveProfessional(team, { modo: "nomeado", mencao: variant }, { current: carlos, appointmentId: "apt-ira-wed", serviceId: limpeza.id, durationMin: 50, slot: null });
        expect({ ...got, ...("mencao" in got ? { mencao } : {}) }, `${mencao} → ${variant}`).toEqual(expected);
      }
    }
  });
  it("a mention that really changes resolves to the record it names", async () => {
    const reader = memoryReader(studio({ customers: [anaQ, anaB, bento] }));
    expect(bound(await resolveCustomer(reader, "Ana Quaresma"))).toBe(anaQ.id);
    expect(bound(await resolveCustomer(reader, "Ana Bezerra"))).toBe(anaB.id);
    expect(bound(await resolveCustomer(reader, "Ana"))).toBeNull();
  });
  it("context words Luna did not copy into a mention change nothing: the appointment and the provenance check stay the same", async () => {
    const next = random(77031), cases = [
      { origem: origin({ profissional_mencao: "Carlos" }), message: "Joga o horário da Iracema com o Carlos pra sexta de manhã" },
      { origem: origin({ profissional_mencao: "Carlos" }), message: "Joga o horário da Iracema pra sexta de manhã" },
      { origem: origin({ dia: weekdayHint(5, "da quinta") }), message: "A da quinta da Iracema vai pro sábado às 10h" },
    ];
    for (const { origem, message } of cases) {
      const expected = await locate(studio(), iracema.id, origem, message);
      const mentions = [origem.profissional_mencao, origem.dia?.mencao].filter((value): value is string => !!value);
      for (let round = 0; round < 10; round++) {
        const wrapped = `${noise(next, mentions)} ${message} ${noise(next, mentions)}`;
        expect(await locate(studio(), iracema.id, origem, wrapped), wrapped).toEqual(expected);
      }
    }
  });
});

/** A full payload of the §2 contract (every key present; null states absence). */
const payload = (over: Partial<PilotInterpretation> = {}): PilotInterpretation => ({
  tipo: "remarcar", resposta_a: null, desistir: false, cliente: { mencao: "Ana" },
  origem: { dia: { tipo: "data", dia: 12, mes: 3, mencao: "do dia 12" }, hora: { tipo: "relogio", hora: 10, minuto: 0, periodo: "manha", mencao: "das 10 da manhã" },
    profissional_mencao: "Carlos", servico_mencao: "limpeza", posicao: "primeiro" },
  destino: { dia: { tipo: "dia_semana", dia_semana: 6, qualificador: "este", mencao: "nesta sexta" }, hora: { tipo: "origem_mais_minutos", minutos: 150, mencao: "150 min mais tarde" },
    profissional: { modo: "nomeado", mencao: "Dalva" } },
  fora_do_escopo: [{ tipo: "mensagem", mencao: "avisa ela" }], ...over });
const verdict = (decode: () => unknown) => {
  try { decode(); return "ACCEPTED"; } catch (error) { return error instanceof PilotContractError && error.reasons.length > 0 ? "REJECTED" : `OTHER:${(error as Error).message}`; }
};
type Node = Record<string, unknown>;
const objects = (schema: unknown): Node[] => !schema || typeof schema !== "object" ? [] : Array.isArray(schema) ? schema.flatMap(objects)
  : [...((schema as Node).type === "object" || (Array.isArray((schema as Node).type) && ((schema as Node).type as unknown[]).includes("object")) ? [schema as Node] : []),
    ...Object.values(schema as Node).flatMap(objects)];

describe("§2 contract: interpretar_remarcacao", () => {
  it("the published wire is strict at every level: every property required, nothing else admitted", () => {
    expect(PILOT_RESCHEDULE_TOOL).toBe("interpretar_remarcacao");
    const nodes = objects(PILOT_RESCHEDULE_PARAMETERS);
    expect(nodes.length).toBeGreaterThanOrEqual(15);
    for (const node of nodes) {
      expect(node.additionalProperties).toBe(false);
      expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as Node).sort());
    }
    expect(Object.keys((PILOT_RESCHEDULE_PARAMETERS as Node).properties as Node)).toEqual(["tipo", "resposta_a", "desistir", "cliente", "origem", "destino", "fora_do_escopo"]);
  });
  it("a valid payload decodes to itself, as an object and as the call's arguments; every day and clock operator is accepted", () => {
    const full = payload();
    expect(decodePilotInterpretation(structuredClone(full))).toEqual(full);
    expect(decodePilotInterpretationArguments(JSON.stringify(full))).toEqual(full);
    const days = [{ tipo: "data", dia: 3, mes: null, mencao: "dia 3" }, { tipo: "dia_semana", dia_semana: 1, qualificador: null, mencao: "domingo" },
      { tipo: "relativo_hoje", dias: 1, mencao: "amanhã" }, { tipo: "mesmo_da_origem", mencao: "no mesmo dia" }, { tipo: "origem_mais_dias", dias: 7, mencao: "uma semana pra frente" }] as const;
    const clocks = [{ tipo: "relogio", hora: 23, minuto: 59, periodo: null, mencao: "23h59" }, { tipo: "mesmo_da_origem", mencao: "mesmo horário" },
      { tipo: "origem_mais_minutos", minutos: 30, mencao: "meia hora depois" }, { tipo: "a_definir", mencao: "num horário a combinar" }] as const;
    for (const dia of days) expect(verdict(() => decodePilotInterpretation(payload({ destino: { ...payload().destino, dia } }))), dia.tipo).toBe("ACCEPTED");
    for (const hora of clocks) expect(verdict(() => decodePilotInterpretation(payload({ destino: { ...payload().destino, hora } }))), hora.tipo).toBe("ACCEPTED");
    const empty = payload({ tipo: "conversa", cliente: { mencao: null }, origem: ORIGIN, destino: { dia: null, hora: null, profissional: { modo: null, mencao: null } }, fora_do_escopo: [] });
    expect(decodePilotInterpretation(empty)).toEqual(empty);
    expect(decodePilotInterpretation(payload({ tipo: "resposta", resposta_a: "q12" })).resposta_a).toBe("q12");
  });
  it("the contract has no place for anything else: an extra key at any level is rejected", () => {
    const full = payload() as unknown as Node;
    const extra = (path: string[]) => { const copy = structuredClone(full); let node = copy; for (const key of path) node = node[key] as Node; node.contexto = "palavras de fora"; return copy; };
    for (const path of [[], ["cliente"], ["origem"], ["origem", "dia"], ["origem", "hora"], ["destino"], ["destino", "dia"], ["destino", "hora"], ["destino", "profissional"], ["fora_do_escopo", "0"]])
      expect(verdict(() => decodePilotInterpretation(extra(path))), path.join(".") || "(root)").toBe("REJECTED");
  });
  it("missing keys, values out of range, another operator's fields, a bad question id or invalid JSON are rejected", () => {
    const { desistir: _missing, ...noWithdraw } = payload(); void _missing;
    const bad: unknown[] = [noWithdraw,
      payload({ destino: { ...payload().destino, dia: { tipo: "data", dia: 32, mes: null, mencao: "dia 32" } } }),
      payload({ destino: { ...payload().destino, dia: { tipo: "data", dia: 10, mes: 13, mencao: "10 do 13" } } }),
      payload({ destino: { ...payload().destino, dia: { tipo: "dia_semana", dia_semana: 0, qualificador: null, mencao: "dia zero" } } }),
      payload({ destino: { ...payload().destino, dia: { tipo: "dia_semana", dia_semana: 8, qualificador: null, mencao: "dia oito" } } }),
      payload({ destino: { ...payload().destino, hora: { tipo: "relogio", hora: 24, minuto: 0, periodo: null, mencao: "24h" } } }),
      payload({ destino: { ...payload().destino, hora: { tipo: "relogio", hora: 10, minuto: 60, periodo: null, mencao: "10h60" } } }),
      { ...payload(), destino: { ...payload().destino, dia: { tipo: "data", dia_semana: 3, mencao: "quarta" } } },
      { ...payload(), destino: { ...payload().destino, hora: { tipo: "a_definir", minutos: 10, mencao: "depois" } } },
      { ...payload(), tipo: "cancelar" }, { ...payload(), resposta_a: "pergunta-1" }, { ...payload(), cliente: { mencao: "" } },
      { ...payload(), fora_do_escopo: [{ tipo: "excluir", mencao: "apaga" }] }, { ...payload(), desistir: "sim" }];
    for (const [index, raw] of bad.entries()) expect(verdict(() => decodePilotInterpretation(raw)), String(index)).toBe("REJECTED");
    expect(verdict(() => decodePilotInterpretationArguments("{\"tipo\":"))).toBe("REJECTED");
  });
});
