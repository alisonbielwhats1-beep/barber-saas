import { describe, expect, it } from "vitest";
import { resolveProfessional, type PilotPerson, type PilotProfessionalRow, type PilotProfessionalResolution, type PilotServiceRow } from "../secretary-pilot-resolver";
import { booked, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { e2bRandom, wire, type E2bProfessional } from "../../test/secretary-pilot-e2b";

/** Reschedule pilot E2-B, the delegated professional (docs/c5-spike/12-piloto-remarcacao.md §11.2, decision 15; Adendo 11), written BEFORE the
 * implementation, with ADVERSARIAL TWINS. Luna only marks the delegation ("qualquer": whoever is free, the current one included; "outro":
 * someone other than the current one); the resolver applies decision 15 to facts:
 *  - candidates: who performs the service and is free for the WHOLE duration at the destination (the appointment being moved is set aside);
 *  - the current professional leaves when the mode is "outro", or when the destination is the origin's own day AND clock (a fact: otherwise
 *    nothing would change);
 *  - tie-break: the fewest appointments that day (blocks are not appointments; the moved appointment does not count), then the name order;
 *    NO preference for the current professional any more;
 *  - nobody left: nobody_free (the orchestrator asks PROFESSIONAL_NOBODY_FREE);
 *  - "manter" and "nomeado" are unchanged; tenant-scoped (only the injected reader is read).
 * New context key (E2-B): `origin`, the appointment's own { date, time }. In-memory studio; Thursday 2031-03-13 is the day; invented names. */
const reflexo: PilotServiceRow = { id: "srv-reflexo", name: "Reflexologia podal", durationMin: 50, priceCents: 9000 };
const cera: PilotServiceRow = { id: "srv-cera", name: "Banho de parafina", durationMin: 30, priceCents: 4000 };
const abelardo: PilotProfessionalRow = { id: "pro-abelardo", name: "Abelardo Juruena", serviceIds: [reflexo.id] };
const bernadete: PilotProfessionalRow = { id: "pro-bernadete", name: "Bernadete Quixadá", serviceIds: [reflexo.id, cera.id] };
const cassiano: PilotProfessionalRow = { id: "pro-cassiano", name: "Cassiano Urubatã", serviceIds: [reflexo.id] };
/** Free all day, never busy, but does not perform the service: never a candidate. */
const dagoberto: PilotProfessionalRow = { id: "pro-dagoberto", name: "Dagoberto Jaraguá", serviceIds: [cera.id] };
const gerusa: PilotPerson = { id: "cli-gerusa", name: "Gerusa Tabajara" }, clodoaldo: PilotPerson = { id: "cli-clodoaldo", name: "Clodoaldo Mendanha" };
const THU = "2031-03-13", FRI = "2031-03-14";
const TEAM = [abelardo, bernadete, cassiano, dagoberto];
/** Another customer's appointment (load, or a taken slot) of `pro` at a local day and clock. */
const fill = (id: string, pro: PilotProfessionalRow, date: string, clock: string) => booked(id, clodoaldo, pro, reflexo, date, clock);
/** Gerusa's appointment being moved: `current` at Thursday 10:00 (50 min). */
const moving = (current: PilotProfessionalRow = bernadete) => booked("apt-ger", gerusa, current, reflexo, THU, "10:00");
const studio = (extra: ReturnType<typeof booked>[] = [], over: MemorySalon = {}, current: PilotProfessionalRow = bernadete): MemorySalon => ({
  customers: [gerusa, clodoaldo], team: TEAM, catalog: [reflexo, cera], appointments: [moving(current), ...extra],
  hours: Object.fromEntries(TEAM.map(pro => [pro.id, everyDay(["08:00", "20:00"])])), ...over });
const ctx = (slot: { date: string; time: string } | null, current: PilotProfessionalRow = bernadete) =>
  wire<Parameters<typeof resolveProfessional>[2]>({ current: { id: current.id, name: current.name }, appointmentId: "apt-ger", serviceId: reflexo.id,
    durationMin: reflexo.durationMin, slot, origin: { date: THU, time: "10:00" } });
const resolve = (salon: MemorySalon, profissional: E2bProfessional, slot: { date: string; time: string } | null, current: PilotProfessionalRow = bernadete) =>
  resolveProfessional(memoryReader(salon), wire(profissional), ctx(slot, current));
const chosen = (result: PilotProfessionalResolution) => result.state === "chosen" ? result.id : result.state;
const ANY: E2bProfessional = { modo: "qualquer", mencao: null }, OTHER: E2bProfessional = { modo: "outro", mencao: null };
const LATER = { date: THU, time: "16:00" }, SAME = { date: THU, time: "10:00" };

describe("§11.2 'manter' and 'nomeado' are unchanged (controls)", () => {
  it("manter, or nothing said: the current professional, inherited", async () => {
    for (const modo of ["manter", null] as const)
      expect(await resolve(studio(), { modo, mencao: null }, LATER)).toEqual({ state: "kept", id: bernadete.id, name: bernadete.name, provenance: "inherited" });
  });
  it("nomeado: the named member, explicit, whatever the loads (the agenda checks the slot)", async () => {
    const busy = studio([fill("x-c1", cassiano, THU, "12:00"), fill("x-c2", cassiano, THU, "14:00")]);
    expect(await resolve(busy, { modo: "nomeado", mencao: "Cassiano" }, LATER)).toMatchObject({ state: "partial", id: cassiano.id, provenance: "explicit" });
  });
});

describe("§11.2 'qualquer': decision 15 with no preference for the current professional", () => {
  it("the current one is a candidate like any other: the fewest appointments that day wins (control)", async () => {
    const loads = studio([fill("x-a1", abelardo, THU, "13:00"), fill("x-c1", cassiano, THU, "12:00"), fill("x-c2", cassiano, THU, "14:00")]);
    expect(await resolve(loads, ANY, LATER)).toEqual({ state: "chosen", id: bernadete.id, name: bernadete.name, provenance: "derived" });
  });
  it("TWINS, a tie with the current one: the name order decides (Abelardo), never the current one; one more appointment for Abelardo → the current one (fewest)", async () => {
    expect(chosen(await resolve(studio([fill("x-c1", cassiano, THU, "12:00")]), ANY, LATER))).toBe(abelardo.id);
    expect(chosen(await resolve(studio([fill("x-c1", cassiano, THU, "12:00"), fill("x-a1", abelardo, THU, "13:00")]), ANY, LATER))).toBe(bernadete.id);
  });
  it("the appointment being moved never counts for the current one's load, and a block is not an appointment", async () => {
    // Bernadete: only the moved one (0); Abelardo: a block only (0); Cassiano: one appointment (1) → tie at 0 → the name order: Abelardo.
    const salon = studio([fill("x-c1", cassiano, THU, "12:00")], { blocks: [{ professionalId: abelardo.id, startLocal: `${THU}T13:00`, endLocal: `${THU}T14:00` }] });
    expect(chosen(await resolve(salon, ANY, LATER))).toBe(abelardo.id);
  });
});

describe("§11.2 the current professional leaves: mode 'outro', or the destination is the origin's own slot (a fact)", () => {
  const loads = () => [fill("x-a1", abelardo, THU, "13:00"), fill("x-c1", cassiano, THU, "12:00"), fill("x-c2", cassiano, THU, "14:00")];
  it("TWINS, same loads (Bernadete 0, Abelardo 1, Cassiano 2): 'qualquer' → Bernadete; 'outro' → Abelardo", async () => {
    expect(chosen(await resolve(studio(loads()), ANY, LATER))).toBe(bernadete.id);
    expect(await resolve(studio(loads()), OTHER, LATER)).toEqual({ state: "chosen", id: abelardo.id, name: abelardo.name, provenance: "derived" });
  });
  it("'outro' when only the current one is free: nobody_free (TWIN 'qualquer': the current one)", async () => {
    const onlyCurrent = studio([fill("x-a1", abelardo, THU, "16:00"), fill("x-c1", cassiano, THU, "16:30")]);
    expect(await resolve(onlyCurrent, OTHER, LATER)).toEqual({ state: "nobody_free", provenance: "unresolved" });
    expect(chosen(await resolve(onlyCurrent, ANY, LATER))).toBe(bernadete.id);
  });
  it("TWINS, 'qualquer' at the origin's own day and clock excludes the current one (Cassiano, fewest of the others); at 10:30 the current one stays a candidate", async () => {
    const salon = studio([fill("x-a1", abelardo, THU, "13:00")]);
    expect(await resolve(salon, ANY, SAME)).toEqual({ state: "chosen", id: cassiano.id, name: cassiano.name, provenance: "derived" });
    expect(chosen(await resolve(salon, ANY, { date: THU, time: "10:30" }))).toBe(bernadete.id);
  });
  it("the same clock on another day is not the origin's slot: the current one stays a candidate (and wins on load)", async () => {
    const salon = studio([fill("x-a1", abelardo, FRI, "13:00"), fill("x-c1", cassiano, FRI, "13:00")]);
    expect(chosen(await resolve(salon, ANY, { date: FRI, time: "10:00" }))).toBe(bernadete.id);
  });
  it("'qualquer' at the origin's slot with every other one busy: nobody_free; TWIN, a filler that ends exactly at 10:00 does not overlap → that one", async () => {
    const taken = studio([fill("x-a1", abelardo, THU, "10:00"), fill("x-c1", cassiano, THU, "10:20")]);
    expect(await resolve(taken, ANY, SAME)).toEqual({ state: "nobody_free", provenance: "unresolved" });
    const touching = studio([fill("x-a1", abelardo, THU, "10:00"), fill("x-c1", cassiano, THU, "09:10")]);
    expect(chosen(await resolve(touching, ANY, SAME))).toBe(cassiano.id);
  });
});

describe("§11.2 candidates: who performs the service and is free for the whole duration", () => {
  it("a block over the end, or hours that end before it, exclude; one who does not perform the service is never chosen even when idle → nobody_free", async () => {
    const salon = studio([], {
      blocks: [{ professionalId: abelardo.id, startLocal: `${THU}T16:40`, endLocal: `${THU}T17:00` }],
      hours: { ...Object.fromEntries(TEAM.map(pro => [pro.id, everyDay(["08:00", "20:00"])])), [cassiano.id]: { [THU]: [{ start: 8 * 60, end: 16 * 60 + 30 }] } } });
    expect(await resolve(salon, OTHER, LATER)).toEqual({ state: "nobody_free", provenance: "unresolved" });
  });
  it("TWIN at the boundaries: a block from 16:50 and hours until 16:50 both fit a 16:00–16:50 slot → the name order among the free (Abelardo)", async () => {
    const salon = studio([], {
      blocks: [{ professionalId: abelardo.id, startLocal: `${THU}T16:50`, endLocal: `${THU}T17:00` }],
      hours: { ...Object.fromEntries(TEAM.map(pro => [pro.id, everyDay(["08:00", "20:00"])])), [cassiano.id]: { [THU]: [{ start: 8 * 60, end: 16 * 60 + 50 }] } } });
    expect(chosen(await resolve(salon, OTHER, LATER))).toBe(abelardo.id);
  });
  it("tenant scope: only the injected reader is read (team, hours, busy); a failing team read is unavailable, never a choice", async () => {
    const reader = memoryReader(studio());
    await resolveProfessional(reader, wire(ANY), ctx(LATER));
    expect([...new Set(reader.calls.map(call => call.method))].sort()).toEqual(["busy", "team", "workingWindows"].sort());
    expect((await resolve(studio([], { fail: { team: true } }), ANY, LATER)).state).toBe("unavailable");
    expect((await resolve(studio([], { fail: { busy: true } }), OTHER, LATER)).state).toBe("unavailable");
  });
  it("before the day and the clock are known it waits (both delegated modes)", async () => {
    for (const mode of [ANY, OTHER]) expect(await resolve(studio(), mode, null), String(mode.modo)).toEqual({ state: "waiting", provenance: "unresolved" });
  });
});

describe("§11.2 property: random loads, team order, current professional, mode and slot → exactly decision 15 as amended", () => {
  it("80 seeded rounds (adversarial: the current one often has the fewest; team order shuffled; some others busy at the slot)", async () => {
    const random = e2bRandom(20311302), pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
    const performers = [abelardo, bernadete, cassiano];
    for (let round = 0; round < 80; round++) {
      const current = pick(performers), mode = pick([ANY, OTHER]), same = random() < 0.5, slot = same ? SAME : { date: THU, time: "16:30" };
      const extra: ReturnType<typeof booked>[] = [], load = new Map<string, number>(), busyAtSlot = new Set<string>();
      for (const pro of performers) {
        const count = pro === current && random() < 0.5 ? 0 : Math.floor(random() * 4);
        ["12:00", "13:00", "14:00"].slice(0, count).forEach((clock, index) => extra.push(fill(`x-${round}-${pro.id}-${index}`, pro, THU, clock)));
        let total = count;
        if (pro !== current && random() < 0.25) { extra.push(fill(`x-${round}-${pro.id}-slot`, pro, THU, slot.time)); busyAtSlot.add(pro.id); total += 1; }
        load.set(pro.id, total);
      }
      const team = [...TEAM].sort(() => random() - 0.5);
      const salon: MemorySalon = { ...studio(extra, {}, current), team };
      const candidates = performers.filter(pro => !busyAtSlot.has(pro.id) && !(pro === current && (mode === OTHER || same)))
        .sort((a, b) => load.get(a.id)! - load.get(b.id)! || a.name.localeCompare(b.name, "pt-BR"));
      const expected = candidates.length ? candidates[0].id : "nobody_free";
      const label = JSON.stringify({ round, current: current.id, mode: mode.modo, same, load: Object.fromEntries(load), busy: [...busyAtSlot] });
      expect(chosen(await resolveProfessional(memoryReader(salon), wire(mode), ctx(slot, current))), label).toBe(expected);
    }
  });
});
