import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** C4 polarity through the real scheduling adapter with a fake tenant transaction (no network, no database):
 * proven excluded clocks reach the alternative generators, an exclusion-only reply retires the value it names
 * with its own notice, and every outcome is telemetry codes only. Flag SALON_SECRETARY_TEMPORAL_POLARITY. */
const io = vi.hoisted(() => ({ draft: vi.fn(), availability: vi.fn(), move: vi.fn(), locate: vi.fn() }));
const tx = {
  $queryRaw: vi.fn(async (parts: readonly string[]) => parts.join("?").includes('"Membership"') ? [{ role: "OWNER" }] : [{ accessStatus: "APPROVED" }]),
  auditLog: { create: vi.fn() },
};
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, work: (t: object) => unknown) => work(tx) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), searchSalonCustomer: async () => [{ id: "amanda", name: "Amanda Lima", phone: null }] }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), schedulingTimezone: async () => "America/Sao_Paulo",
  listSchedulingServices: async () => [{ id: "corte", name: "Corte Feminino", durationMin: 30, priceCents: 5000, priceType: "FIXED" }],
  listSchedulingProfessionals: async () => [{ id: "pro-tatiana", name: "Tatiana Rocha" }],
  getSchedulingAvailability: io.availability, listUpcomingCustomerAppointments: async () => [] }));
vi.mock("../scheduling-actions", async original => ({ ...await original<object>(), upsertSchedulingDraft: io.draft }));
vi.mock("../scheduling-mutations", async original => ({ ...await original<object>(), authorizeSchedulingOperation: async () => "OWNER",
  locateSchedulingAppointments: io.locate, inspectSchedulingMove: io.move }));
import { applySchedulingInterpretation, schedulingState, type SchedulingState } from "../secretary-scheduling";

const actor = { salonId: "ours", userId: "owner" };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-28T12:00:00Z")); // Monday 09:00 in the salon
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  io.availability.mockResolvedValue({ plan: null, alternatives: [{ startLocal: "2026-09-29T15:00", endLocal: "2026-09-29T15:30", professional_ref: "pro-tatiana" }], timezone: "America/Sao_Paulo" });
  io.move.mockResolvedValue({ current: {}, result: { violation: "SLOT_TAKEN" }, alternatives: [{ startLocal: "2026-09-29T12:00", endLocal: "2026-09-29T12:30", professional_ref: "pro-tatiana" }] });
  io.locate.mockResolvedValue([{ appointment_ref: "appt-1" }]);
  io.draft.mockImplementation(async (_tx: unknown, _actor: unknown, input: { operation: string; fields: Record<string, unknown>; draft_ref?: string; expected_revision?: number }) =>
    ({ draft_ref: input.draft_ref ?? "dddddddd-dddd-4ddd-8ddd-dddddddddddd", draft_revision: (input.expected_revision ?? 0) + 1, operation: input.operation,
      fields: structuredClone(input.fields), expires_at: "2026-09-28T12:30:00Z", status: "NEEDS_INPUT", missing_fields: [], temporal_conflicts: [] }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const polarity = (on: boolean) => vi.stubEnv("SALON_SECRETARY_TEMPORAL_POLARITY", on ? "true" : "false");
const run = (operation: string, fields: Record<string, unknown>, message: string, state: SchedulingState = { ...schedulingState(), operation: operation as SchedulingState["operation"] }) =>
  applySchedulingInterpretation(actor, state, { operation: operation as never, ...fields }, message).then(codes => ({ state, codes }));

describe("proven excluded clocks are never offered", () => {
  const read = { customer_name: undefined, service_name: "Corte Feminino", professional_name: "Tatiana Rocha", day_offset: 1,
    temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "menos 14h", excluded: "14:00" }] };
  const message = "Quais horários a Tatiana tem para Corte Feminino amanhã, qualquer horário menos 14h";
  it("availability.get: 'qualquer horário menos 14h' reaches the alternative generator; codes only", async () => {
    polarity(true);
    const { state, codes } = await run("availability.get", read, message);
    expect(state.fields.date).toBe("2026-09-29");
    expect(io.availability).toHaveBeenCalledTimes(1); expect([...io.availability.mock.calls[0][5]]).toEqual(["14:00"]);
    expect(codes).toEqual(["TEMPORAL_EXCLUSION_VERIFIED"]);
    expect(JSON.stringify(codes)).not.toMatch(/14|amanh|Tatiana/);
  });
  it("flag off: the same interpretation passes no exclusion and reports nothing", async () => {
    polarity(false);
    const { codes } = await run("availability.get", read, message);
    expect(io.availability.mock.calls[0][5]).toBeUndefined(); expect(codes).toEqual([]);
  });
  // Review migration (backup: .demo/agenda-core/contract-migration/secretary-temporal-polarity-adapter.test.before-ownership-review.ts):
  // the unpunctuated 'às 11h não às 10h' reads both ways and is asked; the comma settles the attachment.
  it("a move to a taken slot: the excluded clock is skipped when alternatives are generated", async () => {
    polarity(true);
    const { state, codes } = await run("appointment.change", { customer_name: "Amanda", day_offset: 1, time: "11:00",
      temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 11h" }, { field: "time", text: "não às 10h", excluded: "10:00" }] },
      "passa a Amanda pra amanhã às 11h, não às 10h");
    expect(state.fields).toMatchObject({ date: "2026-09-29", time: "11:00", appointment_ref: "appt-1" });
    expect(io.move).toHaveBeenCalledTimes(1); expect([...io.move.mock.calls[0][5]]).toEqual(["10:00"]);
    expect(state.message).toContain("Esse horário está indisponível"); expect(codes).toEqual(["TEMPORAL_EXCLUSION_VERIFIED"]);
  });
  it("review: without the comma the 'não' is not owned: the clock (and the day) are asked, never moved", async () => {
    polarity(true);
    const { state, codes } = await run("appointment.change", { customer_name: "Amanda", day_offset: 1, time: "11:00",
      temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 11h" }, { field: "time", text: "não às 10h", excluded: "10:00" }] },
      "passa a Amanda pra amanhã às 11h não às 10h");
    expect(state.fields.time).toBeUndefined(); expect(io.move).not.toHaveBeenCalled(); expect(state.proposal).toBeUndefined();
    expect(codes).toEqual(["TEMPORAL_EXCLUSION_VERIFIED", "TEMPORAL_EXCLUSION_UNOWNED"]);
  });
});

describe("an exclusion-only reply retires the value it names", () => {
  it("the accepted 10h is removed and asked with its own notice; the day and nothing else stays", async () => {
    polarity(true);
    const state: SchedulingState = { ...schedulingState(), operation: "appointment.change", fields: { customer_name: "Amanda", date: "2026-09-29", time: "10:00" } };
    const { codes } = await run("appointment.change", { temporal_evidence: [{ field: "time", text: "não 10h", excluded: "10:00" }] }, "não 10h", state);
    expect(state.fields.time).toBeUndefined(); expect(state.fields.date).toBe("2026-09-29");
    expect(state.message).toBe("Retirei o horário que você descartou. Preciso confirmar horário de destino. Pode informar?");
    expect(codes).toEqual(["TEMPORAL_EXCLUSION_VERIFIED", "TEMPORAL_EXCLUDED_AFFIRMED"]);
    expect(io.move).not.toHaveBeenCalled();
  });
});
