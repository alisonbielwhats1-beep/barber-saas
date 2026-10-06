import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C5 V27: a move into the slot a pending cancellation of the same plan releases is CHECKED (preparation only) on a view of
 * the agenda without that appointment; the executor never passes it (the committed agenda is re-checked under its locks). */
const seen = vi.hoisted(() => ({ agendas: [] as unknown[] }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertSchedulingAccess: async () => undefined,
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, status: "CONFIRMED", start_at: "2099-01-01T12:00:00.000Z",
    start_local: "2026-09-30T10:00", end_local: "2026-09-30T11:00", customer_ref: "c-fabio", customer_name: "Fábio Santos", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha",
    revision: 1, timezone: "America/Sao_Paulo", priceCents: 8000 }) }));
vi.mock("../appointment-service", async importOriginal => ({ ...await importOriginal<object>(),
  inspectAppointmentAvailabilityWithServiceSnapshots: async (agenda: Tx, input: { startLocal: string }) => {
    seen.agendas.push(agenda);
    // The engine's own query: the released appointment is Amanda's 29/09 15h.
    const clash = await agenda.appointment.findFirst({ where: { professionalId: "pro-tatiana", id: { not: "a-fabio" } } });
    return { violation: clash ? "SLOT_TAKEN" : null, startAt: new Date(`${input.startLocal}:00-03:00`), endAt: new Date(`${input.startLocal}:00-03:00`), timezone: "America/Sao_Paulo", services: [], conflicts: [] };
  } }));
import { releasedAgendaView } from "../scheduling-released-slot";
import { inspectSchedulingMove, schedulingActionSnapshot } from "../scheduling-mutations";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
const calls: { model: string; method: string; args: unknown }[] = [];
const delegate = (model: string, rows: (where: unknown) => unknown) => Object.fromEntries(["findFirst", "findFirstOrThrow", "findMany", "findUniqueOrThrow", "count"].map(method =>
  [method, async (args: { where?: unknown } = {}) => { calls.push({ model, method, args }); return rows(args.where); }])) as Record<string, (args?: unknown) => Promise<unknown>>;
/** An appointment table holding Amanda's appointment; a row is returned unless the query excludes it. */
const excludes = (where: unknown): boolean => JSON.stringify(where).includes('"not":"a-amanda"') || JSON.stringify(where).includes('"notIn"');
function fakeTx(): Tx {
  const tx = {
    appointment: delegate("appointment", where => excludes(where) ? null : { id: "a-amanda" }),
    resourceBooking: delegate("resourceBooking", () => []),
    timeOff: delegate("timeOff", () => null),
    waitlistEntry: delegate("waitlistEntry", () => []),
    membership: delegate("membership", () => ({ role: "OWNER" })),
    salon: delegate("salon", () => ({ timezone: "America/Sao_Paulo" })),
    $queryRaw: async function (this: unknown, strings: TemplateStringsArray) { calls.push({ model: "$queryRaw", method: strings.join("?"), args: this === tx }); return [{ has_account: false }]; },
  };
  return tx as unknown as Tx;
}
beforeEach(() => { calls.length = 0; seen.agendas.length = 0; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z")); });

describe("releasedAgendaView", () => {
  it("appointment and resource-booking reads leave the released appointment out; everything else is untouched", async () => {
    const tx = fakeTx(), view = releasedAgendaView(tx, "a-amanda");
    await view.appointment.findFirst({ where: { professionalId: "p" } });
    await view.appointment.findMany({ where: { status: { in: ["CONFIRMED"] } } });
    await view.resourceBooking.findFirst({ where: { resourceId: { in: ["r"] } } });
    await view.timeOff.findFirst({ where: { professionalId: "p" } });
    await view.$queryRaw`SELECT 1`;
    expect(calls.slice(0, 4).map(call => call.args)).toEqual([
      { where: { AND: [{ professionalId: "p" }, { id: { not: "a-amanda" } }] } },
      { where: { AND: [{ status: { in: ["CONFIRMED"] } }, { id: { not: "a-amanda" } }] } },
      { where: { AND: [{ resourceId: { in: ["r"] } }, { appointmentId: { not: "a-amanda" } }] } },
      { where: { professionalId: "p" } },
    ]);
    expect(calls[4]).toMatchObject({ model: "$queryRaw", args: true });
    // The committed transaction itself is never changed.
    await tx.appointment.findFirst({ where: { professionalId: "p" } });
    expect(calls.at(-1)!.args).toEqual({ where: { professionalId: "p" } });
  });
});

describe("inspectSchedulingMove / schedulingActionSnapshot with a released appointment", () => {
  const withOwnRelations = (tx: Tx) => { (tx.appointment as unknown as Record<string, unknown>).findFirstOrThrow = async () => ({ dependentId: null, products: [],
    service: { id: "s", name: "Corte", durationMin: 60, priceCents: 8000, priceType: "FIXED", priceNote: null, processingMin: 0, finishingMin: 0 }, serviceItems: [] }); return tx; };
  it("without it the destination is checked on the committed agenda (Amanda's appointment takes it)", async () => {
    const tx = withOwnRelations(fakeTx());
    const move = await inspectSchedulingMove(tx, actor, "a-fabio", "2026-09-29", "15:00");
    expect(move.result.violation).toBe("SLOT_TAKEN");
    expect(seen.agendas.every(agenda => agenda === tx)).toBe(true);
  });
  it("with it the check reads a view without that appointment; the moved appointment itself is never 'released'", async () => {
    const tx = withOwnRelations(fakeTx());
    const move = await inspectSchedulingMove(tx, actor, "a-fabio", "2026-09-29", "15:00", undefined, "a-amanda");
    expect(move.result.violation).toBeNull();
    expect(seen.agendas.length).toBeGreaterThan(0); expect(seen.agendas.every(agenda => agenda !== tx)).toBe(true);
    seen.agendas.length = 0;
    await inspectSchedulingMove(tx, actor, "a-fabio", "2026-09-29", "15:00", undefined, "a-fabio");
    expect(seen.agendas.every(agenda => agenda === tx)).toBe(true);
  });
  it("the proposal snapshot threads it; without it a change into the taken slot is refused", async () => {
    const tx = withOwnRelations(fakeTx()), fields = { appointment_ref: "a-fabio", date: "2026-09-29", time: "15:00" };
    await expect(schedulingActionSnapshot(tx, actor, "appointment.change", fields)).rejects.toThrow("SLOT_CONFLICT");
    const snapshot = await schedulingActionSnapshot(tx, actor, "appointment.change", fields, "a-amanda");
    expect(snapshot).toMatchObject({ kind: "appointment.change", appointment_ref: "a-fabio", before_start: "2026-09-30T10:00" });
  });
});
