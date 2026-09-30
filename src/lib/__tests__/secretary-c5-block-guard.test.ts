import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** C5 (flag SALON_SECRETARY_BLOCK_OVERLAP_GUARD; owner rule 10 of 30/09) through the real scheduling adapter and draft journal: a block
 * whose interval holds a committed appointment of that professional is never proposed directly; the owner picks on a card of real
 * options (a free interval, or the whole block keeping the appointments), and each pick is rechecked against fresh rows. The block
 * snapshot is computed from the fake agenda (the same `affected` rule as the domain: PENDING/CONFIRMED/IN_PROGRESS overlapping the
 * interval). A studio of massage and aesthetics; diverse synthetic names (no gender inferred from a name). No DB, no network, no model. */
type Appt = { id: string; salonId: string; customer: string; professional_ref: string; start_local: string; end_local: string; status: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown, rows: [] as Record<string, unknown>[], appointments: [] as Appt[], proposals: 0 }));
const utc = (local: string) => new Date(Date.parse(`${local}:00Z`) + 3 * 3600_000);
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: unknown) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined,
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, input: { query?: string }) => [{ id: "p-iara", name: "Iara Quintana" }, { id: "p-davi", name: "Davi Okada" }]
    .filter(row => !input.query || row.name.toLowerCase().includes(input.query.toLowerCase())),
  schedulingSelfProfessional: async () => undefined }));
vi.mock("../scheduling-mutations", async original => {
  const real = await original<typeof import("../scheduling-mutations")>();
  return { ...real, authorizeSchedulingOperation: async () => "OWNER",
    schedulingActionSnapshot: async (_tx: unknown, actor: { salonId: string }, operation: string, f: Record<string, string>) => {
      if (operation !== "schedule.block") throw Error("UNEXPECTED_OPERATION");
      const startLocal = `${f.date}T${f.time}`, endLocal = `${f.end_date ?? f.date}T${f.end_time}`;
      const affected = db.appointments.filter(a => a.salonId === actor.salonId && a.professional_ref === f.professional_ref && ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(a.status) &&
        a.start_local < endLocal && a.end_local > startLocal).map(a => ({ id: a.id, version: 1, name: a.customer, startLocal: a.start_local }));
      return real.actionSnapshot.parse({ kind: operation, professional_ref: f.professional_ref, professional_name: "Iara Quintana", timezone: "America/Sao_Paulo", startLocal, endLocal,
        services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected });
    } };
});
vi.mock("../scheduling-actions", async original => ({ ...await original<object>(),
  proposeSchedulingAction: vi.fn(async (_tx: unknown, _actor: unknown, input: object) => { db.proposals++; return { ...input, proposal_ref: "pppppppp-pppp-4ppp-8ppp-pppppppppppp", payload_hash: "h", preview: "BLOQUEAR AGENDA" }; }) }));
vi.mock("../scheduling-entity-mentions", async original => ({ ...await original<object>(), validateSchedulingEntityMentions: async () => undefined }));
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";
import { freeIntervals } from "../secretary-block-guard";

const studio = { salonId: "studio-bruma", userId: "dona-bruma" }, other = { salonId: "studio-vizinho", userId: "dono-vizinho" };
const day = (value: Partial<DayComponent> & Pick<DayComponent, "kind">): DayComponent => ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const TOMORROW = day({ kind: "RELATIVE_DAY", offset: 1 });
const clock = (hour: number, minute = 0): ClockComponent => ({ hour, minute, daypart: "UNSPECIFIED" });
const evidence = (from: string, to: string, fromClock: ClockComponent, toClock: ClockComponent) => [{ field: "date", text: "amanhã", component: TOMORROW },
  { field: "time", text: from, component: fromClock }, { field: "end_time", text: to, component: toClock }];
const fresh = (): SchedulingState => ({ ...schedulingState(), operation: "schedule.block" });
const block = (state: SchedulingState, from: string, to: string, a: ClockComponent, b: ClockComponent, message: string) =>
  applySchedulingInterpretation(studio, state, { operation: "schedule.block", professional_name: "Iara", temporal_evidence: evidence(from, to, a, b) } as never, message);
const booked = (id: string, customer: string, start: string, end: string, salonId = studio.salonId, status = "CONFIRMED"): Appt =>
  ({ id, salonId, customer, professional_ref: "p-iara", start_local: `2026-09-30T${start}`, end_local: `2026-09-30T${end}`, status });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday, 12h in São Paulo; "amanhã" = qua, 30/09
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true"); vi.stubEnv("SALON_SECRETARY_BLOCK_OVERLAP_GUARD", "true");
  db.rows = []; db.proposals = 0;
  db.appointments = [booked("a-moana", "Moana Freitas", "18:00", "19:00"), booked("a-zeca", "Zeca Andrade", "10:00", "10:30"), booked("a-vizinho", "Nair Lopes", "17:00", "19:00", other.salonId)];
  const find = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), membership: { findFirstOrThrow: async () => ({ role: "OWNER" }) },
    appointment: { findMany: async ({ where }: { where: { salonId: string; id?: { in: string[] } } }) =>
      db.appointments.filter(a => a.salonId === where.salonId && (!where.id || where.id.in.includes(a.id))).map(a => ({ id: a.id, startAt: utc(a.start_local), endAt: utc(a.end_local) })) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.rows.push(structuredClone(data)); return data; }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)), findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)[0] ?? null) } } as unknown as Tx;
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(db.rows.filter(row => row.action === "CONFIRMED")).toEqual([]); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("C5 block guard (owner rule 10): a block over appointments is asked, never proposed", () => {
  const eveningBlock = (state: SchedulingState) => block(state, "das 17h", "às 19h", clock(17), clock(19), "fecha a agenda da Iara amanhã das 17h às 19h");
  it("the appointment inside the block is shown and nothing is proposed; the card offers the free interval or the whole block", async () => {
    const state = fresh(), codes = await eveningBlock(state);
    expect(state.proposal).toBeUndefined(); expect(db.proposals).toBe(0); expect(codes).toContain("BLOCK_OVERLAP_ASKED");
    expect(state.candidates).toEqual({ kind: "block_overlap_ref", items: [
      { id: "block-free:2026-09-30T17:00|2026-09-30T18:00", name: "Só o horário livre: qua, 30/09 às 17h–18h" },
      { id: "block-all", name: "Período todo: qua, 30/09 às 17h–19h, mantendo 1 agendamento marcado" }] });
    expect(state.message).toBe("Nesse período, Iara Quintana tem um agendamento: Moana Freitas às 18h. Nada foi bloqueado. Bloqueio só o horário livre ou o período todo, mantendo os agendamentos marcados? Selecione uma opção real.");
  });
  it("picking the free interval proposes 17h–18h (backend values from real rows), with no appointment inside", async () => {
    const state = fresh(); await eveningBlock(state);
    await selectScheduling(studio, state, "block-free:2026-09-30T17:00|2026-09-30T18:00");
    expect(state.fields).toMatchObject({ date: "2026-09-30", time: "17:00", end_time: "18:00", professional_ref: "p-iara" });
    expect(state.proposal).toBeDefined(); expect(state.draft!.action_snapshot).toMatchObject({ startLocal: "2026-09-30T17:00", endLocal: "2026-09-30T18:00", affected: [] });
  });
  it("picking the whole block proposes 17h–19h keeping the appointment (the owner's explicit choice)", async () => {
    const state = fresh(); await eveningBlock(state);
    await selectScheduling(studio, state, "block-all");
    expect(state.proposal).toBeDefined(); expect(state.draft!.action_snapshot).toMatchObject({ startLocal: "2026-09-30T17:00", endLocal: "2026-09-30T19:00" });
    expect(state.draft!.action_snapshot!.affected.map(row => row.id)).toEqual(["a-moana"]);
  });
  it("an appointment at the start (OV60 structure): the free interval begins after it (16h30–18h)", async () => {
    db.appointments.push(booked("a-caue", "Cauê Nogueira", "16:00", "16:30"));
    const state = fresh(); await block(state, "das 16h", "às 18h", clock(16), clock(18), "fecha a agenda da Iara amanhã das 16h às 18h");
    expect(state.candidates!.items[0]).toEqual({ id: "block-free:2026-09-30T16:30|2026-09-30T18:00", name: "Só o horário livre: qua, 30/09 às 16h30–18h" });
    await selectScheduling(studio, state, state.candidates!.items[0].id);
    expect(state.fields).toMatchObject({ time: "16:30", end_time: "18:00" }); expect(state.proposal).toBeDefined();
  });
  it("several appointments: each free interval is an option (never the one the model or the backend prefers)", async () => {
    db.appointments.push(booked("a-caue", "Cauê Nogueira", "15:00", "15:30"));
    const state = fresh(); await block(state, "das 14h", "às 19h", clock(14), clock(19), "fecha a agenda da Iara amanhã das 14h às 19h");
    expect(state.candidates!.items.map(item => item.id)).toEqual(["block-free:2026-09-30T14:00|2026-09-30T15:00", "block-free:2026-09-30T15:30|2026-09-30T18:00", "block-all"]);
    expect(state.message).toContain("tem 2 agendamentos: Cauê Nogueira às 15h e Moana Freitas às 18h."); expect(state.proposal).toBeUndefined();
  });
  it("no free time inside the block: only the whole block is offered, and the question says so", async () => {
    const state = fresh(); await block(state, "das 18h", "às 19h", clock(18), clock(19), "fecha a agenda da Iara amanhã das 18h às 19h");
    expect(state.candidates!.items.map(item => item.id)).toEqual(["block-all"]); expect(state.message).toContain("Esse período não tem horário livre.");
  });
  it("control: a block with no appointment inside is proposed directly (the guard never asks without a reason)", async () => {
    const state = fresh(); await block(state, "das 14h", "às 16h", clock(14), clock(16), "fecha a agenda da Iara amanhã das 14h às 16h");
    expect(state.candidates).toBeUndefined(); expect(state.proposal).toBeDefined();
  });
  it("control: another salon's appointment at the same time never enters (tenant isolation)", async () => {
    db.appointments = db.appointments.filter(a => a.id !== "a-moana");
    const state = fresh(); await eveningBlock(state);
    expect(state.candidates).toBeUndefined(); expect(state.proposal).toBeDefined();
  });
  it("adversarial: a stale option (the appointment moved after the card) is refused, never applied", async () => {
    const state = fresh(); await eveningBlock(state);
    db.appointments.find(a => a.id === "a-moana")!.start_local = "2026-09-30T17:30";
    await expect(selectScheduling(studio, state, "block-free:2026-09-30T17:00|2026-09-30T18:00")).rejects.toThrow("SELECTION_INVALID");
    expect(state.proposal).toBeUndefined();
  });
  it("adversarial: an option id the card never published is refused", async () => {
    const state = fresh(); await eveningBlock(state);
    await expect(selectScheduling(studio, state, "block-free:2026-09-30T17:00|2026-09-30T19:00")).rejects.toThrow("SELECTION_INVALID");
  });
  it("flag off: the historical proposal over the appointment stays as it was", async () => {
    vi.stubEnv("SALON_SECRETARY_BLOCK_OVERLAP_GUARD", "false");
    const state = fresh(); await eveningBlock(state);
    expect(state.candidates).toBeUndefined(); expect(state.proposal).toBeDefined(); expect(state.draft!.action_snapshot!.affected.map(row => row.id)).toEqual(["a-moana"]);
  });
});

describe("freeIntervals", () => {
  const d = (clock_: string) => `2026-09-30T${clock_}`;
  it("splits around busy intervals, merges overlaps and ignores what lies outside", () => {
    expect(freeIntervals(d("14:00"), d("19:00"), [{ start: d("17:00"), end: d("18:00") }, { start: d("15:00"), end: d("15:30") }, { start: d("15:15"), end: d("16:00") }]))
      .toEqual([{ start: d("14:00"), end: d("15:00") }, { start: d("16:00"), end: d("17:00") }, { start: d("18:00"), end: d("19:00") }]);
    expect(freeIntervals(d("14:00"), d("16:00"), [{ start: d("13:00"), end: d("14:30") }, { start: d("15:30"), end: d("17:00") }])).toEqual([{ start: d("14:30"), end: d("15:30") }]);
    expect(freeIntervals(d("14:00"), d("16:00"), [{ start: d("13:00"), end: d("17:00") }])).toEqual([]);
    expect(freeIntervals(d("14:00"), d("16:00"), [])).toEqual([{ start: d("14:00"), end: d("16:00") }]);
  });
});
